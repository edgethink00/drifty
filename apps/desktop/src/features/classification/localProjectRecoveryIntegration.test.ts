import { describe, expect, it, vi } from "vitest";
import { buildProjectPassSegmentUnits, type ProjectPassPromptInput } from "@drifty/domain";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { createProjectPassInference } from "./projectPassInference";

vi.mock("../../lib/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock("./managedLocalAiChat", () => ({
  ManagedLocalAiChatTimeoutError: class extends Error {},
  invokeOpenAiChatWithManagedLocalRetry: (request: Record<string, unknown>, _local: unknown, _current: unknown, options: { invokeChat: (request: Record<string, unknown>) => unknown }) => options.invokeChat(request),
}));
const coreWindows = buildProjectPassSegmentUnits([{ id: "s1", startedAt: "2026-11-15T10:00:00Z", endedAt: "2026-11-15T10:02:00Z", durationSeconds: 120, appName: "Calculator", platform: "macos", source: "accessibility" }]);
const input: ProjectPassPromptInput = { beforeContextWindows: [], coreWindows, afterContextWindows: [], workProfile: null,
  projects: [{ id: "project-uuid", name: "calculator practice", description: "arithmetic exercises", anchors: [] }] };
const body = (content: string) => ({ status: 200, latencyMs: 20, body: JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
const model = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "managed_local" as const,
  managedLocal: { modelId: "drifty-qwen3-5-2b-economy", model: "drifty-qwen3.5-2b-local", baseUrl: "http://127.0.0.1:39217/v1" } };

describe("managed local project name recovery", () => {
  it("checks a name response locally and counts both calls", async () => {
    const invokeChat = vi.fn().mockResolvedValueOnce(body(JSON.stringify({ assignments: [{ id: coreWindows[0].id, projectId: "calculator practice", confidence: 0.9 }], corrections: [] })))
      .mockResolvedValueOnce(body('{"answer":"YES","confidence":0.95}'));
    const inference = createProjectPassInference(model, { invokeChat });
    const result = await inference("original prompt", input);
    expect(result.output?.assignments[0]).toMatchObject({ id: coreWindows[0].id, projectId: "project-uuid", confidence: 0.9 });
    expect(result.usage).toMatchObject({ provider: "managed_local", tokensIn: 20, tokensOut: 10, latencyMs: 40 });
    expect(invokeChat).toHaveBeenCalledTimes(2);
  });
  it("keeps invalid output invalid when the verification is uncertain", async () => {
    const invokeChat = vi.fn().mockResolvedValueOnce(body(JSON.stringify({ assignments: [{ id: coreWindows[0].id, projectId: "calculator practice", confidence: 0.9 }], corrections: [] })))
      .mockResolvedValueOnce(body('{"answer":"YES","confidence":0.5}'));
    const result = await createProjectPassInference(model, { invokeChat })("original prompt", input);
    expect(result.output?.assignments[0].projectId).toBe("calculator practice");
  });
  it("checks even a syntactically valid project id and fails closed on uncertain verification", async () => {
    const answer = body(JSON.stringify({ assignments: [{ id: coreWindows[0].id, projectId: "project-uuid", confidence: 0.9 }], corrections: [] }));
    const veto = vi.fn().mockResolvedValueOnce(answer).mockResolvedValueOnce(body('{"answer":"NO","confidence":0.95}'));
    expect((await createProjectPassInference(model, { invokeChat: veto })("original", input)).output?.assignments[0].projectId).toBeNull();
    const uncertain = vi.fn().mockResolvedValueOnce(answer).mockResolvedValueOnce(body('{"answer":"YES","confidence":0.5}'));
    expect((await createProjectPassInference(model, { invokeChat: uncertain })("original", input)).output).toBeNull();
  });
  it("rechecks an all-null response when the user's manual anchor matches", async () => {
    const anchored = { ...input, projects: [{ ...input.projects[0], anchors: [{ kind: "app" as const, value: "Calculator", source: "manual" as const }] }] };
    const invokeChat = vi.fn().mockResolvedValueOnce(body(JSON.stringify({ assignments: [{ id: coreWindows[0].id, projectId: null, confidence: 0.9 }], corrections: [] })))
      .mockResolvedValueOnce(body('{"answer":"YES","confidence":0.95}'));
    const result = await createProjectPassInference(model, { invokeChat })("original", anchored);
    expect(result.output?.assignments[0].projectId).toBe("project-uuid");
    expect(invokeChat).toHaveBeenCalledTimes(2);
  });
  it("discards an in-flight local verification when the request is cancelled and permits a fresh retry", async () => {
    let current = true;
    let finish!: (value: ReturnType<typeof body>) => void;
    const answer = body(JSON.stringify({ assignments: [{ id: coreWindows[0].id, projectId: "project-uuid", confidence: 0.9 }], corrections: [] }));
    const invokeChat = vi.fn().mockResolvedValueOnce(answer)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(answer)
      .mockResolvedValueOnce(body('{"answer":"YES","confidence":0.95}'));
    const inference = createProjectPassInference(model, { invokeChat, isRequestCurrent: () => current });
    const pending = inference("original", input);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    current = false;
    finish(body('{"answer":"YES","confidence":0.95}'));
    await expect(pending).rejects.toThrow("settings changed");
    current = true;
    expect((await inference("original", input)).output?.assignments[0].projectId).toBe("project-uuid");
    expect(invokeChat).toHaveBeenCalledTimes(4);
  });
});
