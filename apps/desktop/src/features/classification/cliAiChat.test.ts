import { describe, expect, it, vi } from "vitest";
import { invokeCliAiChat, CliAiChatError } from "./cliAiChat";
import type { ChatClient } from "../chat/chatClient";

function client(send: ChatClient["send"]): ChatClient {
  return { kind: "native", send, cancel: vi.fn(async () => {}), getStatus: vi.fn(), runTool: vi.fn() };
}
describe("CLI classification transport", () => {
  it("uses the final completed JSON and supplies no record tools", async () => {
    const send = vi.fn<ChatClient["send"]>(async (_, line) => {
      line(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Checking the supplied sample." } }));
      line(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"results":[]}' } }));
      line('{"type":"turn.completed"}');
      return { code: 0, cancelled: false, stderrTail: "" };
    });
    const response = await invokeCliAiChat({ cliProvider: "codex", messages: [{ role: "user", content: "minimized sample" }] }, () => true, "classification", client(send));
    expect(JSON.parse(String(response.body)).choices[0].message.content).toBe('{"results":[]}');
    expect(send.mock.calls[0]?.[0]).toMatchObject({ withoutTools: true, provider: "codex", detail: "safe" });
    expect(send.mock.calls[0]?.[0].prompt).not.toContain("tracker.sqlite");
  });
  it("rejects malformed or unfinished output instead of accepting a connection", async () => {
    const connection = client(async (_, line) => {
      line(JSON.stringify({ type: "result", subtype: "success", result: "not JSON" }));
      return { code: 0, cancelled: false, stderrTail: "" };
    });
    await expect(invokeCliAiChat({ cliProvider: "claude", messages: [{}] }, () => true, "analysis", connection)).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("classifies a provider refusal without exposing its stderr or credentials", async () => {
    const connection = client(async () => ({ code: 1, cancelled: false, stderrTail: "OAuth token private-value expired. Please sign in." }));
    const error = await invokeCliAiChat({ cliProvider: "codex", messages: [{}] }, () => true, "classification", connection).catch(error => error);
    expect(error).toBeInstanceOf(CliAiChatError);
    expect(error.reason).toBe("authentication");
    expect(error.message).not.toContain("private-value");
  });
  it("reports a CLI that is not on this computer as not installed", async () => {
    const connection = client(async () => { throw new Error("claude is not installed or not on this computer's PATH."); });
    await expect(invokeCliAiChat({ cliProvider: "claude", messages: [{}] }, () => true, "classification", connection)).rejects.toMatchObject({ reason: "not_installed" });
  });
  it("does not start a request after its settings scope changes", async () => {
    const connection = client(vi.fn());
    await expect(invokeCliAiChat({ cliProvider: "codex", messages: [{}] }, () => false, "analysis", connection)).rejects.toThrow(/cancelled/);
    expect(connection.send).not.toHaveBeenCalled();
  });
  it("cancels an active CLI when the user switches connections", async () => {
    vi.useFakeTimers();
    try {
      let current = true;
      const connection = client(async () => new Promise(() => {}));
      const run = invokeCliAiChat({ cliProvider: "codex", messages: [{}] }, () => current, "analysis", connection);
      const rejected = expect(run).rejects.toMatchObject({ reason: "cancelled" });
      current = false;
      await vi.advanceTimersByTimeAsync(250);
      await rejected;
      expect(connection.cancel).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("works in a private HTTP browser review where randomUUID is unavailable", async () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: original.getRandomValues.bind(original) });
    try {
      const send = vi.fn<ChatClient["send"]>(async (_, line) => {
        line('{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}');
        line('{"type":"turn.completed"}');
        return { code: 0, cancelled: false, stderrTail: "" };
      });
      await invokeCliAiChat({ cliProvider: "codex", messages: [{}] }, () => true, "analysis", client(send));
      expect(send.mock.calls[0]?.[0].requestId).toMatch(/^inference-[a-z0-9-]{1,54}$/);
    } finally { vi.unstubAllGlobals(); }
  });
});
