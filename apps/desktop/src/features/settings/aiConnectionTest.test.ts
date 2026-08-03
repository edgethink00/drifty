import { beforeEach, describe, expect, it, vi } from "vitest";

import { testLocalAiConnection } from "./aiConnectionTest";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("testLocalAiConnection", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("preserves native string errors from managed local connection tests", async () => {
    invokeMock.mockRejectedValue("error sending request for url (http://127.0.0.1:39217/v1/chat/completions)");

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "managed_local",
      driftyRoute: "local",
      managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
      managedLocalModel: "drifty-qwen3.5-2b-local",
    });

    expect(result).toEqual({
      kind: "error",
      issueKind: "network",
      message: "error sending request for url (http://127.0.0.1:39217/v1/chat/completions)",
    });
  });

  it("starts the selected managed local model and retries when the stale endpoint is down", async () => {
    invokeMock
      .mockResolvedValueOnce({
        state: "error",
        selectedModelId: "drifty-qwen3-5-4b-default",
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-4b-local",
        message: "Managed local AI runtime is not running.",
        artifactDir: null,
        progress: null,
      })
      .mockResolvedValueOnce({
        state: "running",
        selectedModelId: "drifty-qwen3-5-4b-default",
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-4b-local",
        message: "Managed local AI runtime is running.",
        artifactDir: null,
        progress: null,
      })
      .mockResolvedValueOnce({
        status: 200,
        body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}",
        latencyMs: 24,
      });

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "managed_local",
      driftyRoute: "local",
      managedLocalModelId: "drifty-qwen3-5-4b-default",
      managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
      managedLocalModel: "drifty-qwen3.5-4b-local",
    });

    expect(result).toEqual({ kind: "success", message: "Connected in 24 ms." });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "managed_ai_status");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "managed_ai_start", { modelId: "drifty-qwen3-5-4b-default" });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "ai_classification_openai_chat", {
      request: expect.objectContaining({
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-4b-local",
        maxTokens: 64,
        reasoningFormat: "none",
        chatTemplateKwargs: { enable_thinking: false },
      }),
    });
  });

  it("starts the selected managed local model before testing when another model is running", async () => {
    invokeMock
      .mockResolvedValueOnce({
        state: "running",
        selectedModelId: "drifty-qwen3-5-2b-economy",
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-2b-local",
        message: "Managed local AI runtime is running.",
        artifactDir: null,
        progress: null,
      })
      .mockResolvedValueOnce({
        state: "running",
        selectedModelId: "drifty-qwen3-5-4b-default",
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-4b-local",
        message: "Managed local AI runtime is running.",
        artifactDir: null,
        progress: null,
      })
      .mockResolvedValueOnce({
        status: 200,
        body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}",
        latencyMs: 28,
      });

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "managed_local",
      driftyRoute: "local",
      managedLocalModelId: "drifty-qwen3-5-4b-default",
      managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
      managedLocalModel: "drifty-qwen3.5-4b-local",
    });

    expect(result).toEqual({ kind: "success", message: "Connected in 28 ms." });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "managed_ai_status");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "managed_ai_start", { modelId: "drifty-qwen3-5-4b-default" });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "ai_classification_openai_chat", {
      request: expect.objectContaining({
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-4b-local",
        maxTokens: 64,
        reasoningFormat: "none",
        chatTemplateKwargs: { enable_thinking: false },
      }),
    });
  });

  it("tests OpenRouter BYOK with strict privacy routing and at most three model IDs", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}",
      latencyMs: 31,
    });

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "openrouter_byok",
      openRouterApiKey: "sk-or-v1-test",
      openRouterModel: "deepseek/deepseek-v4-flash",
      openRouterFallbackModels: [
        "qwen/qwen3.6-35b-a3b",
        "qwen/qwen3.6-27b",
        "z-ai/glm-4.7-flash",
      ],
    });

    expect(result).toEqual({ kind: "success", message: "Connected in 31 ms." });
    expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", {
      request: expect.objectContaining({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-v1-test",
        models: [
          "deepseek/deepseek-v4-flash",
          "qwen/qwen3.6-35b-a3b",
          "qwen/qwen3.6-27b",
        ],
        provider: {
          data_collection: "deny",
          zdr: true,
        },
      }),
    });
    const requestArgs = invokeMock.mock.calls[0]?.[1];
    if (!requestArgs || typeof requestArgs !== "object" || !("request" in requestArgs) || !requestArgs.request || typeof requestArgs.request !== "object") {
      throw new Error("OpenRouter connection test should invoke a request object.");
    }
    expect("maxTokens" in requestArgs.request).toBe(false);
  });

  it.each([
    [401, "authentication", "OpenRouter rejected the API key."],
    [402, "credits", "OpenRouter credits are required."],
    [403, "access", "OpenRouter blocked this request."],
    [404, "model_unavailable", "The selected OpenRouter model is unavailable."],
    [429, "rate_limited", "OpenRouter is rate limiting requests."],
    [503, "unavailable", "OpenRouter has no available provider for this request."],
  ] as const)("preserves the structured OpenRouter HTTP %s recovery", async (status, issueKind, message) => {
    invokeMock.mockResolvedValue({ status, body: JSON.stringify({ error: { code: status } }), latencyMs: 20 });

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "openrouter_byok",
      openRouterApiKey: "sk-or-v1-test",
    });

    expect(result).toEqual({ kind: "error", issueKind, message });
  });

  it("prefers OpenRouter canonical error_type when HTTP 400 is otherwise ambiguous", async () => {
    invokeMock.mockResolvedValue({
      status: 400,
      body: JSON.stringify({ error: { code: 400, metadata: { error_type: "not_found" } } }),
      latencyMs: 20,
    });

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "openrouter_byok",
      openRouterApiKey: "sk-or-v1-test",
    });

    expect(result).toEqual({
      kind: "error",
      issueKind: "model_unavailable",
      message: "The selected OpenRouter model is unavailable.",
    });
  });

  it("preserves OpenRouter Retry-After for the automatic recovery scheduler", async () => {
    invokeMock.mockResolvedValue({
      status: 429,
      body: JSON.stringify({ error: { code: 429 } }),
      latencyMs: 20,
      retryAfterMs: 90_000,
    });

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "openrouter_byok",
      openRouterApiKey: "sk-or-v1-test",
    });

    expect(result).toEqual({
      kind: "error",
      issueKind: "rate_limited",
      message: "OpenRouter is rate limiting requests.",
      retryAfterMs: 90_000,
    });
  });
});
