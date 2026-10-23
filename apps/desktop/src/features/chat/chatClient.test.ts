import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

import { __testing, createChatClient, parseChatRuntimeStatus } from "./chatClient";

function streamOf(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      // Split mid-line to prove the client reassembles NDJSON chunks.
      const text = lines.join("\n") + "\n";
      controller.enqueue(encoder.encode(text.slice(0, 7)));
      controller.enqueue(encoder.encode(text.slice(7)));
      controller.close();
    },
  });
}

describe("Chat client", () => {
  it("reads runtime status defensively", () => {
    expect(parseChatRuntimeStatus({ providers: [{ provider: "codex", installed: true, version: "codex-cli 1" }, { provider: "other" }], toolsAvailable: true })).toEqual({
      providers: [{ provider: "codex", installed: true, version: "codex-cli 1" }],
      toolsAvailable: true,
      toolsMessage: null,
    });
    expect(() => parseChatRuntimeStatus(null)).toThrow();
  });

  it("chooses the native app, the dev preview bridge, or nothing", () => {
    expect(createChatClient(true, undefined, false).kind).toBe("native");
    expect(createChatClient(false, "1", true).kind).toBe("preview");
    expect(createChatClient(false, "1", false).kind).toBe("unavailable");
    expect(createChatClient(false, undefined, true).kind).toBe("unavailable");
  });

  it("streams preview bridge lines until the exit record", async () => {
    const fetcher = vi.fn(async () => new Response(streamOf([
      JSON.stringify({ kind: "line", line: "{\"type\":\"turn.started\"}" }),
      "not json",
      JSON.stringify({ kind: "exit", code: 0, cancelled: false, stderrTail: "" }),
    ])));
    const client = __testing.previewClient(fetcher as unknown as typeof fetch);
    const lines: string[] = [];
    const exit = await client.send({ requestId: "turn-1", provider: "codex", detail: "safe", instructions: "i", prompt: "p" }, (line) => lines.push(line));
    expect(lines).toEqual(["{\"type\":\"turn.started\"}"]);
    expect(exit).toEqual({ code: 0, cancelled: false, stderrTail: "" });
    expect(fetcher).toHaveBeenCalledWith("/__drifty_preview/chat/send", expect.objectContaining({ method: "POST" }));
  });
});

