import { describe, expect, it, vi } from "vitest";
import { createActivityLabelInference } from "../activity-labels/activityLabelInference";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { createProjectPassInference, type ProjectPassInferenceDeps } from "./projectPassInference";

vi.mock("../../lib/supabase/client", () => ({ supabase: null }));

const PROJECT_JSON = JSON.stringify({
  assignments: [{ id: "window-1", projectId: "project-1", confidence: 0.9 }],
  corrections: [],
});
const CARD_JSON = JSON.stringify({
  cards: [{ start_ref: "r1", end_ref: "r1", status: "ready", title: "Release checklist", description: "", refs: ["r1"] }],
});

function response(content: unknown, tokensIn = 100, tokensOut = 20, latencyMs = 17) {
  return {
    status: 200,
    latencyMs,
    body: JSON.stringify({
      model: "claude-sonnet-5",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: tokensIn, output_tokens: tokensOut },
    }),
  };
}

describe.each([
  { kind: "project", json: PROJECT_JSON, expected: { assignments: [{ id: "window-1", projectId: "project-1", confidence: 0.9 }], corrections: [] } },
  { kind: "card", json: CARD_JSON, expected: [{ startRef: "r1", endRef: "r1", status: "ready", title: "Release checklist", description: "", refs: ["r1"] }] },
] as const)("Anthropic $kind content blocks", ({ kind, json, expected }) => {
  function inference(invokeAnthropicChat: NonNullable<ProjectPassInferenceDeps["invokeAnthropicChat"]>) {
    const setup = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic" as const, anthropicApiKey: "test-key", anthropicModel: "claude-sonnet-5" };
    const deps = { invokeAnthropicChat, canFallbackToCloud: () => false };
    return kind === "project" ? createProjectPassInference(setup, deps) : createActivityLabelInference(setup, deps);
  }

  it("preserves an ordinary text-only answer and usage", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(response([{ type: "text", text: json }]));

    const result = await inference(invoke)("prompt");

    expect(result.output).toEqual(expected);
    expect(result.usage).toEqual({ provider: "anthropic", model: "claude-sonnet-5", tokensIn: 100, tokensOut: 20, latencyMs: 17 });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reads the answer after a leading thinking block without requesting repair", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(response([{ type: "thinking" }, { type: "text", text: json }]));

    const result = await inference(invoke)("prompt");

    expect(result.output).toEqual(expected);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("joins split JSON text in order without inserting characters inside a string", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(response([
      { type: "text", text: json.slice(0, 3) },
      { type: "text", text: json.slice(3) },
    ]));

    expect((await inference(invoke)("prompt")).output).toEqual(expected);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("excludes thinking, tool and redacted blocks even when they have text properties", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(response([
      null,
      { type: "thinking", text: "ignored-prefix" },
      { type: "redacted_thinking", text: "ignored-redacted" },
      { type: "text", text: json },
      { type: "tool_use", text: "ignored-suffix" },
      { text: "ignored-untyped" },
      { type: "text", text: 123 },
    ]));

    expect((await inference(invoke)("prompt")).output).toEqual(expected);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps a response without answer text null and does not repair non-text content", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(response([
      { type: "thinking" },
      { type: "tool_use", text: json },
      { type: "redacted_thinking", text: json },
    ]));

    const result = await inference(invoke)("prompt");

    expect(result.output).toBeNull();
    expect(result.usage.tokensIn).toBe(100);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("selects text on the repair turn, excludes non-text from repair input and preserves budget and usage", async () => {
    const malformed = "not JSON";
    const invoke = vi.fn()
      .mockResolvedValueOnce(response([{ type: "thinking", text: "ignored-prefix" }, { type: "text", text: malformed }]))
      .mockResolvedValueOnce(response([{ type: "thinking" }, { type: "text", text: json.slice(0, 3) }, { type: "text", text: json.slice(3) }], 30, 40, 23));

    const result = await inference(invoke)("prompt");

    expect(result.output).toEqual(expected);
    expect(result.usage).toEqual({ provider: "anthropic", model: "claude-sonnet-5", tokensIn: 130, tokensOut: 60, latencyMs: 40 });
    expect(invoke).toHaveBeenCalledTimes(2);
    const originalRequest = invoke.mock.calls[0][0];
    const repairRequest = invoke.mock.calls[1][0];
    expect(originalRequest).toMatchObject({ maxTokens: 8192, timeoutMs: 180_000 });
    expect(repairRequest).toEqual({
      ...originalRequest,
      messages: [
        { role: "user", content: "prompt" },
        { role: "assistant", content: malformed },
        { role: "user", content: expect.stringContaining("valid JSON") },
      ],
    });
  });

  it("stops after one unsuccessful repair with both turns counted", async () => {
    const invoke = vi.fn().mockResolvedValue(response([{ type: "text", text: "not JSON" }]));

    const result = await inference(invoke)("prompt");

    expect(result.output).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.usage).toMatchObject({ tokensIn: 200, tokensOut: 40, latencyMs: 34 });
  });
});
