import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
const webview = vi.hoisted(() => ({ listener: null as null | ((event: { payload: unknown }) => void), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: (event: { payload: unknown }) => void) => {
      webview.listener = listener;
      return webview.unlisten;
    },
  }),
}));

import { invoke } from "@tauri-apps/api/core";

import { ChatAttachmentReadError } from "./chatAttachments";
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

  it("reports files dropped on the app window and reads each one only when asked", async () => {
    const client = createChatClient(true, undefined, false);
    expect(createChatClient(false, "1", true).watchFileDrops).toBeUndefined();
    const onDragging = vi.fn();
    const onDrop = vi.fn();
    const stop = client.watchFileDrops?.({ onDragging, onDrop });
    await vi.waitFor(() => expect(webview.listener).not.toBeNull());
    webview.listener?.({ payload: { type: "enter", paths: ["/Users/me/notes.txt"], position: { x: 1, y: 1 } } });
    webview.listener?.({ payload: { type: "leave" } });
    expect(onDragging.mock.calls).toEqual([[true], [false]]);
    webview.listener?.({ payload: { type: "drop", paths: ["/Users/me/notes.txt", "C:\\Users\\me\\회의 메모.md"], position: { x: 1, y: 1 } } });
    const dropped = onDrop.mock.calls[0][0] as Array<{ name: string; read: () => Promise<File> }>;
    expect(dropped.map((file) => file.name)).toEqual(["notes.txt", "회의 메모.md"]);
    expect(invoke).not.toHaveBeenCalled();

    vi.mocked(invoke).mockResolvedValueOnce(new Uint8Array([104, 105]).buffer);
    const file = await dropped[0].read();
    expect(invoke).toHaveBeenCalledWith("chat_read_dropped_file", { path: "/Users/me/notes.txt" });
    expect([file.name, file.size]).toEqual(["notes.txt", 2]);
    vi.mocked(invoke).mockRejectedValueOnce("tooLarge");
    await expect(dropped[1].read()).rejects.toEqual(new ChatAttachmentReadError("tooLarge"));
    vi.mocked(invoke).mockRejectedValueOnce("notDropped");
    await expect(dropped[1].read()).rejects.toMatchObject({ reason: "unreadable" });

    stop?.();
    expect(webview.unlisten).toHaveBeenCalledTimes(1);
  });
});

