import { beforeEach, describe, expect, it, vi } from "vitest";
import { testAnthropicConnection } from "./anthropicConnectionTest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("testAnthropicConnection", () => {
  beforeEach(() => { invokeMock.mockReset(); });

  it("tests only synthetic content through the existing native Anthropic transport", async () => {
    invokeMock.mockResolvedValue({ status: 200, body: JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }] }), latencyMs: 27 });
    await expect(testAnthropicConnection({ apiKey: " key ", model: " claude-test " })).resolves.toEqual({ kind: "success", message: "Connected in 27 ms." });
    expect(invokeMock).toHaveBeenCalledWith("ai_classification_anthropic_chat", { request: {
      apiKey: "key", model: "claude-test", messages: [{ role: "user", content: 'Reply with compact JSON only: {"ok":true}' }], maxTokens: 64, timeoutMs: 30_000,
    } });
  });

  it.each(["", "{}", '{"content":[]}', '{"content":[{"type":"text","text":" "}]}'])("rejects missing assistant content: %s", async body => {
    invokeMock.mockResolvedValue({ status: 200, body, latencyMs: 10 });
    expect((await testAnthropicConnection({ apiKey: "key", model: "claude-test" })).kind).toBe("error");
  });

  it("keeps response bodies and transport secrets out of errors", async () => {
    invokeMock.mockResolvedValueOnce({ status: 401, body: "private-provider-response" });
    await expect(testAnthropicConnection({ apiKey: "key", model: "claude-test" })).resolves.toEqual({ kind: "error", issueKind: "provider", message: "Provider returned HTTP 401." });
    invokeMock.mockRejectedValueOnce(new Error("private-transport-error"));
    await expect(testAnthropicConnection({ apiKey: "key", model: "claude-test" })).resolves.toEqual({ kind: "error", issueKind: "provider", message: "Connection test failed." });
  });

  it("does not send requests with incomplete credentials", async () => {
    await testAnthropicConnection({ apiKey: " ", model: "claude-test" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
