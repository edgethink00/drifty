import { describe, expect, it } from "vitest";

import { chatStreamAnswer, EMPTY_CHAT_STREAM, reduceChatStreamLine, type ChatStreamState } from "./chatStream";

function fold(provider: "codex" | "claude", events: readonly unknown[]): ChatStreamState {
  return events.reduce<ChatStreamState>((state, event) => reduceChatStreamLine(state, provider, JSON.stringify(event)), EMPTY_CHAT_STREAM);
}

describe("Codex exec --json lines", () => {
  // Recorded shape from a real Codex turn against the synthetic eval ledger (2026-10-24).
  const turn = [
    { type: "thread.started", thread_id: "t" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "저번 주 수요일 기록을 확인할게요." } },
    { type: "item.started", item: { id: "item_1", type: "mcp_tool_call", server: "drifty", tool: "summary", arguments: { day: "2026-07-29" }, result: null, error: null, status: "in_progress" } },
    { type: "item.completed", item: { id: "item_1", type: "mcp_tool_call", server: "drifty", tool: "summary", arguments: { day: "2026-07-29" }, result: { content: [] }, error: null, status: "completed" } },
    { type: "item.completed", item: { id: "item_3", type: "agent_message", text: "7월 29일 기록은 **4시간 35분**이에요." } },
    { type: "turn.completed", usage: { input_tokens: 1 } },
  ];

  it("turns tool calls into steps and the last message into the answer", () => {
    const state = fold("codex", turn);
    expect(state.tools).toEqual([{ id: "item_1", name: "summary", args: { day: "2026-07-29" }, status: "done" }]);
    expect(state.completed).toBe(true);
    expect(chatStreamAnswer(state)).toEqual({ notes: ["저번 주 수요일 기록을 확인할게요."], answer: "7월 29일 기록은 **4시간 35분**이에요." });
  });

  it("keeps what a tool returned so a recorded chat carries its evidence", () => {
    const state = fold("codex", [
      { type: "item.completed", item: { id: "r", type: "mcp_tool_call", tool: "summary", arguments: { day: "2026-07-29" }, result: { content: [{ type: "text", text: "{\"ok\":true}" }] }, status: "completed" } },
    ]);
    expect(state.tools[0].result).toBe("{\"ok\":true}");
  });

  it("shows a running tool before it completes", () => {
    const state = fold("codex", turn.slice(0, 4));
    expect(state.tools[0].status).toBe("running");
    expect(chatStreamAnswer(state).answer).toBe("저번 주 수요일 기록을 확인할게요.");
  });

  it("records failed tools and failed turns", () => {
    const state = fold("codex", [
      { type: "item.completed", item: { id: "a", type: "mcp_tool_call", tool: "search", arguments: { query: "x" }, status: "failed", error: { message: "boom" } } },
      { type: "turn.failed", error: { message: "You've hit your usage limit." } },
    ]);
    expect(state.tools[0].status).toBe("failed");
    expect(state.error).toBe("You've hit your usage limit.");
    expect(chatStreamAnswer(state).answer).toBe("");
  });

  it("ignores lines that are not JSON objects", () => {
    expect(reduceChatStreamLine(EMPTY_CHAT_STREAM, "codex", "Reading additional input from stdin...")).toBe(EMPTY_CHAT_STREAM);
    expect(reduceChatStreamLine(EMPTY_CHAT_STREAM, "codex", "[1,2]")).toBe(EMPTY_CHAT_STREAM);
  });
});

describe("Claude Code stream-json lines", () => {
  const turn = [
    { type: "system", subtype: "init" },
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "확인해 " } } },
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "볼게요." } } },
    { type: "assistant", message: { content: [
      { type: "text", text: "확인해 볼게요." },
      { type: "tool_use", id: "toolu_1", name: "mcp__drifty__timeline", input: { day: "2026-10-23" } },
    ] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "{}" }] } },
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "어제는 " } } },
    { type: "assistant", message: { content: [{ type: "text", text: "어제는 Figma를 가장 오래 썼어요." }] } },
    { type: "result", subtype: "success", is_error: false, result: "어제는 Figma를 가장 오래 썼어요." },
  ];

  it("streams live text, then settles notes, tools and the final result", () => {
    const live = fold("claude", turn.slice(0, 3));
    expect(chatStreamAnswer(live).answer).toBe("확인해 볼게요.");
    const state = fold("claude", turn);
    expect(state.tools).toEqual([{ id: "toolu_1", name: "timeline", args: { day: "2026-10-23" }, status: "done", result: "{}" }]);
    expect(chatStreamAnswer(state)).toEqual({ notes: ["확인해 볼게요."], answer: "어제는 Figma를 가장 오래 썼어요." });
  });

  it("treats an error result as the turn's error", () => {
    const state = fold("claude", [{ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }]);
    expect(state.error).toBe("Not logged in · Please run /login");
    expect(state.completed).toBe(true);
    expect(chatStreamAnswer(state).answer).toBe("");
  });
});

describe("Claude Code refusals", () => {
  it("treats a usage-limit or sign-in message as the turn's error, not its answer", () => {
    let state = EMPTY_CHAT_STREAM;
    for (const event of [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "text", text: "You've hit your weekly limit · resets Oct 28 at 7pm (Asia/Seoul)" }] }, error: "rate_limit" },
      { type: "result", subtype: "success", is_error: true, result: "You've hit your weekly limit · resets Oct 28 at 7pm (Asia/Seoul)" },
    ]) state = reduceChatStreamLine(state, "claude", JSON.stringify(event));
    expect(chatStreamAnswer(state).answer).toBe("");
    expect(state.error).toBe("You've hit your weekly limit · resets Oct 28 at 7pm (Asia/Seoul)");
  });
});
