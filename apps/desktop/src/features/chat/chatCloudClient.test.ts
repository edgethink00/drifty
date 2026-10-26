import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

import { runChatCloudTurn, type ChatCloudModelKey } from "./chatCloudClient";

const CREDITS = { remaining: 900, granted: 1000, renewsAt: "2026-11-25T07:00:00.000Z" };

async function turnWithThinking(model: ChatCloudModelKey, thinking: string) {
  const bodies: Array<Record<string, unknown>> = [];
  const steps = [
    { content: [{ type: "thinking", thinking, signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "summary", input: { day: "2026-10-25" } }], stopReason: "tool_use", charged: 3, credits: CREDITS },
    { content: [{ type: "text", text: "어제는 1시간 50분이 기록됐어요." }], stopReason: "end_turn", charged: 1.5, credits: CREDITS },
  ];
  const invoke = vi.fn(async (body: Record<string, unknown>) => {
    bodies.push(JSON.parse(JSON.stringify(body)) as Record<string, unknown>);
    return { status: 200, data: steps.shift() };
  });
  const result = await runChatCloudTurn({
    turnId: "turn-1", model, instructions: "Answer from records.", history: [], request: "어제 뭐 했어?", detail: "titles",
    runTool: async () => ({ text: "{\"ok\":true}", isError: false }),
    onProgress: () => undefined, isCancelled: () => false, invoke,
  });
  return { result, bodies };
}

describe("Drifty Cloud turns", () => {
  it("shows Sonnet's updates between lookups but only returns Opus and Fable's thinking to the model", async () => {
    const sonnet = await turnWithThinking("sonnet", "어제 기록을 확인할게요.");
    expect(sonnet.result.notes).toEqual(["어제 기록을 확인할게요."]);
    for (const model of ["opus", "fable"] as const) {
      const { result, bodies } = await turnWithThinking(model, "Yesterday = 2026-10-25 (Sunday).");
      expect(result.notes).toEqual([]);
      expect(result.answer).toBe("어제는 1시간 50분이 기록됐어요.");
      expect(result.charged).toBe(4.5);
      // The signed thinking block still goes back unchanged with the tool result.
      const messages = bodies[1].messages as Array<{ role: string; content: unknown }>;
      expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "thinking", thinking: "Yesterday = 2026-10-25 (Sunday).", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "summary", input: { day: "2026-10-25" } }] });
    }
  });
});
