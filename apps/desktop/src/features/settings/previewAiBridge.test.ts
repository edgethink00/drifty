import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { invokePreviewAwareAiCommand, shouldUsePreviewAiProxy } from "./previewAiBridge";
import { PREVIEW_AI_PROXY_PATH } from "./previewAiContract";

describe("previewAiBridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("enables the preview proxy only for a non-Tauri development preview", () => {
    expect(shouldUsePreviewAiProxy(true, "1", false)).toBe(true);
    expect(shouldUsePreviewAiProxy(true, "1", true)).toBe(false);
    expect(shouldUsePreviewAiProxy(false, "1", false)).toBe(false);
    expect(shouldUsePreviewAiProxy(true, undefined, false)).toBe(false);
  });

  it("routes allowed AI commands through the same-origin preview proxy", async () => {
    vi.stubEnv("VITE_DRIFTY_PREVIEW", "1");
    isTauriMock.mockReturnValue(false);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 200, body: "{}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokePreviewAwareAiCommand("ai_list_openai_models", {
      request: { baseUrl: "http://localhost:11434/v1", apiKey: null },
    })).resolves.toEqual({ status: 200, body: "{}" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(PREVIEW_AI_PROXY_PATH, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        command: "ai_list_openai_models",
        request: { baseUrl: "http://localhost:11434/v1", apiKey: null },
      }),
    }));
  });

  it("keeps native invocation in Tauri even when the preview flag exists", async () => {
    vi.stubEnv("VITE_DRIFTY_PREVIEW", "1");
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ status: 200, body: "native" });

    await expect(invokePreviewAwareAiCommand("ai_list_openai_models", { request: {} })).resolves.toEqual({ status: 200, body: "native" });
    expect(invokeMock).toHaveBeenCalledWith("ai_list_openai_models", { request: {} });
  });

  it("surfaces a readable proxy error", async () => {
    vi.stubEnv("VITE_DRIFTY_PREVIEW", "1");
    isTauriMock.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Endpoint refused the connection." }), { status: 502 })));

    await expect(invokePreviewAwareAiCommand("ai_classification_openai_chat", { request: {} })).rejects.toThrow(
      "Endpoint refused the connection.",
    );
  });
});
