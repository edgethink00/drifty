import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProjectPassPrompt, buildProjectPassAnalysisWindows, type ProjectPassPromptInput, type ActivitySegment } from "@drifty/domain";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { ManagedLocalAiChatTimeoutError } from "./managedLocalAiChat";
import { createProjectPassInference } from "./projectPassInference";
import { createActivityLabelInference } from "../activity-labels/activityLabelInference";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("../../lib/supabase/client", () => ({ supabase: null }));

const local = { modelId: "drifty-qwen3-5-4b-default", baseUrl: "http://127.0.0.1:39217/v1", model: "drifty-qwen3.5-4b-local" };
const setup = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "managed_local" as const, managedLocal: local };
const answer = (content: unknown) => ({ status: 200, body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }) });

beforeEach(() => {
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "managed_ai_status") return { state: "running", selectedModelId: local.modelId, ...local };
    throw new Error(`Unexpected native command: ${command}`);
  });
});

describe("Local Intelligence delivery", () => {
  it("uses the managed lifecycle, a keyless local request and the task parser", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => answer({ assignments: [{ id: "w0", projectId: null, confidence: 0.9 }], corrections: [] }));
    const result = await createProjectPassInference(setup, { invokeChat })("project evidence");
    expect(result.output?.assignments).toHaveLength(1);
    expect(result.usage).toMatchObject({ provider: "managed_local", tokensIn: 12 });
    expect(native.invoke).toHaveBeenCalledWith("managed_ai_status");
    expect(invokeChat.mock.calls[0]?.[0]).toMatchObject({ baseUrl: local.baseUrl, model: local.model, reasoningFormat: "none", maxTokens: 768 });
    expect(invokeChat.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
  });

  it("does not fall back to Cloud after a definite local rejection", async () => {
    const invokeChat = vi.fn(async () => ({ status: 404, body: '{"error":{"code":"model_not_found"}}' }));
    const cloud = vi.fn();
    const inference = createProjectPassInference(setup, { invokeChat, invokeCloud: cloud, canFallbackToCloud: () => true });
    expect((await inference("evidence")).output).toBeNull();
    expect((await inference("more evidence")).output).toBeNull();
    expect(cloud).not.toHaveBeenCalled();
  });

  it("retries a context-limited project chunk as smaller complete core sets", async () => {
    const segments = Array.from({ length: 2 }, (_, i) => ({ id: `s${i}`, startedAt: new Date(Date.UTC(2026, 9, 20, 9, i * 3)).toISOString(), endedAt: new Date(Date.UTC(2026, 9, 20, 9, (i + 1) * 3)).toISOString(), durationSeconds: 180, appName: "Code", windowTitle: "Project work" } as ActivitySegment));
    const input: ProjectPassPromptInput = { coreWindows: buildProjectPassAnalysisWindows(segments), beforeContextWindows: [], afterContextWindows: [], projects: [], workProfile: null };
    expect(input.coreWindows).toHaveLength(2);
    const invokeChat = vi.fn().mockResolvedValueOnce({ status: 400, body: 'context size exceeded' })
      .mockResolvedValueOnce(answer({ assignments: [{ id: input.coreWindows[0]!.id, projectId: null, confidence: 0.9 }], corrections: [] }))
      .mockResolvedValueOnce(answer({ assignments: [{ id: input.coreWindows[1]!.id, projectId: null, confidence: 0.9 }], corrections: [] }));
    const result = await createProjectPassInference(setup, { invokeChat })(buildProjectPassPrompt(input), input);
    expect(result.output?.assignments.map(a => a.id)).toEqual(input.coreWindows.map(w => w.id));
    expect(invokeChat).toHaveBeenCalledTimes(3);
    expect(result.usage.tokensIn).toBe(24);
    expect(result.usage.model).toBe(local.model);
  });

  it("splits a large project request before sending and keeps only each part's core ids", async () => {
    const segments = Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, startedAt: new Date(Date.UTC(2026, 9, 20, 9, i * 3)).toISOString(), endedAt: new Date(Date.UTC(2026, 9, 20, 9, (i + 1) * 3)).toISOString(), durationSeconds: 180, appName: "Code", windowTitle: "Project work" } as ActivitySegment));
    const input: ProjectPassPromptInput = { coreWindows: buildProjectPassAnalysisWindows(segments), beforeContextWindows: [], afterContextWindows: [], projects: [], workProfile: null };
    const invokeChat = vi.fn(async (request: Record<string, unknown>) => {
      const prompt = JSON.stringify(request.messages);
      const ids = input.coreWindows.filter(w => prompt.includes(w.id)).map(w => w.id);
      return answer({ assignments: ids.map(id => ({ id, projectId: null, confidence: 0.9 })), corrections: [] });
    });
    const result = await createProjectPassInference(setup, { invokeChat })(buildProjectPassPrompt(input), input);
    expect(invokeChat.mock.calls.length).toBeGreaterThan(1);
    expect(result.usage.model).toBe(local.model);
    expect(result.output?.assignments.map(a => a.id)).toEqual(input.coreWindows.map(w => w.id));
    for (const [request] of invokeChat.mock.calls) {
      expect(input.coreWindows.filter(w => JSON.stringify(request.messages).includes(w.id)).length).toBeLessThan(input.coreWindows.length);
      expect((request.messages as {content: string}[]).every(m => new TextEncoder().encode(m.content).byteLength <= 6000)).toBe(true);
    }
  });

  it("retries a timed out structured local request with smaller input", async () => {
    const segments = Array.from({ length: 2 }, (_, i) => ({ id: `s${i}`, startedAt: new Date(Date.UTC(2026, 9, 20, 9, i * 3)).toISOString(), endedAt: new Date(Date.UTC(2026, 9, 20, 9, (i + 1) * 3)).toISOString(), durationSeconds: 180, appName: "Code", windowTitle: "Project work" } as ActivitySegment));
    const input: ProjectPassPromptInput = { coreWindows: buildProjectPassAnalysisWindows(segments), beforeContextWindows: [], afterContextWindows: [], projects: [], workProfile: null };
    const invokeChat = vi.fn().mockRejectedValueOnce(new ManagedLocalAiChatTimeoutError())
      .mockResolvedValueOnce(answer({ assignments: [{ id: input.coreWindows[0]!.id, projectId: null, confidence: 0.9 }], corrections: [] }))
      .mockResolvedValueOnce(answer({ assignments: [{ id: input.coreWindows[1]!.id, projectId: null, confidence: 0.9 }], corrections: [] }));
    const result = await createProjectPassInference(setup, { invokeChat })(buildProjectPassPrompt(input), input);
    expect(result.output?.assignments.map(a => a.id)).toEqual(input.coreWindows.map(w => w.id));
    expect(invokeChat).toHaveBeenCalledTimes(3);
  });

  it("does not persist a partial timeline window when a smaller request also fails", async () => {
    const invokeChat = vi.fn().mockResolvedValueOnce({ status: 400, body: 'context limit exceeded' })
      .mockResolvedValueOnce(answer({ cards: [] })).mockResolvedValueOnce({ status: 500, body: 'unavailable' });
    const input = { promptVersion: "test", language: "en" as const, recordedSeconds: 240, untitledSeconds: 0,
      records: [["r1", "09:00", "09:02", 120, "Code", null, "Work"], ["r2", "09:02", "09:04", 120, "Code", null, "Work"]] as const };
    const result = await createActivityLabelInference(setup, { invokeChat })("timeline evidence", input);
    expect(result.output).toBeNull();
    expect(invokeChat).toHaveBeenCalledTimes(3);
  });
});

describe("Local project decision completeness", () => {
  function twoWindows(): ProjectPassPromptInput {
    const segments = Array.from({ length: 2 }, (_, i) => ({ id: `s${i}`, startedAt: new Date(Date.UTC(2026, 9, 20, 9, i * 3)).toISOString(), endedAt: new Date(Date.UTC(2026, 9, 20, 9, (i + 1) * 3)).toISOString(), durationSeconds: 180, appName: "Code", windowTitle: "Project work" } as ActivitySegment));
    return { coreWindows: buildProjectPassAnalysisWindows(segments), beforeContextWindows: [], afterContextWindows: [], projects: [{ id: "p1", name: "Work", description: "Project work", anchors: [] }], workProfile: null };
  }
  it("rejects a valid JSON response when a required core decision remains missing", async () => {
    const input = twoWindows();
    const invokeChat = vi.fn(async () => answer({ assignments: [{ id: input.coreWindows[0]!.id, projectId: "p1", confidence: 0.9 }], corrections: [] }));
    const result = await createProjectPassInference(setup, { invokeChat })(buildProjectPassPrompt(input), input);
    expect(result.output).toBeNull();
    expect(invokeChat).toHaveBeenCalledTimes(3);
  });
  it("recovers missing and duplicate core decisions using complete smaller responses", async () => {
    const input = twoWindows();
    const first = { id: input.coreWindows[0]!.id, projectId: "p1", confidence: 0.9 };
    const second = { ...first, id: input.coreWindows[1]!.id, projectId: null };
    const invokeChat = vi.fn().mockResolvedValueOnce(answer({ assignments: [first, first, second], corrections: [] }))
      .mockResolvedValueOnce(answer({ assignments: [first], corrections: [] }))
      .mockResolvedValueOnce(answer({ assignments: [second], corrections: [] }));
    const result = await createProjectPassInference(setup, { invokeChat })(buildProjectPassPrompt(input), input);
    expect(result.output?.assignments).toEqual([first, second]);
    expect(invokeChat).toHaveBeenCalledTimes(3);
  });
  it("keeps the existing empty assignment contract for a corrections-only pass", async () => {
    const input = { ...twoWindows(), projects: [] };
    const invokeChat = vi.fn(async () => answer({ assignments: [], corrections: [] }));
    const result = await createProjectPassInference(setup, { invokeChat })(buildProjectPassPrompt(input), input);
    expect(result.output).toEqual({ assignments: [], corrections: [] });
    expect(invokeChat).toHaveBeenCalledTimes(1);
  });
});
