import { beforeEach, describe, expect, it, vi } from "vitest";

import { testLocalAiConnection, testOpenAiCompatibleConnection } from "./aiConnectionTest";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import { managedLocalAiQueue } from "../classification/managedLocalAiQueue";

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

  it("does not touch the runtime when a queued connection test becomes stale", async () => {
    let finish!: () => void;
    const active = managedLocalAiQueue.run("analysis", () => true, () => new Promise<void>(resolve => { finish = resolve; }));
    let current = true;
    const pending = testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP, driftyRoute: "local",
      managedLocalBaseUrl: "http://127.0.0.1:39217/v1", managedLocalModel: "local-four",
    }, () => current);
    current = false;
    finish();
    const result = await pending;
    await active;
    expect(result.kind).toBe("error");
    expect(invokeMock).not.toHaveBeenCalled();
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
      detail: { httpStatus: null, responseKind: "unreachable" },
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

  it("uses the optional shared custom-endpoint key for Classification", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}",
      latencyMs: 19,
    });

    await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "self_hosted",
      selfHostedBaseUrl: "https://models.example/v1",
      selfHostedApiKey: "custom-session-key",
      selfHostedModel: "classification-model",
    });

    expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", {
      request: expect.objectContaining({
        baseUrl: "https://models.example/v1",
        apiKey: "custom-session-key",
        model: "classification-model",
      }),
    });
  });

  it("tests an Intelligence custom endpoint through the shared protocol path", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}",
      latencyMs: 18,
    });

    const result = await testOpenAiCompatibleConnection({
      baseUrl: "  https://models.example/v1/  ",
      apiKey: "  shared-session-key  ",
      model: "  intelligence-model  ",
    });

    expect(result).toEqual({ kind: "success", message: "Connected in 18 ms." });
    expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", {
      request: expect.objectContaining({
        baseUrl: "https://models.example/v1",
        apiKey: "shared-session-key",
        model: "intelligence-model",
      }),
    });
  });

  it("does not invoke native chat for an invalid custom endpoint URL", async () => {
    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "self_hosted",
      selfHostedBaseUrl: "not-a-valid-url",
      selfHostedModel: "classification-model",
    });

    expect(result).toEqual({
      kind: "error",
      issueKind: "provider",
      message: "Complete the selected provider settings before testing.",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("labels the built-in browser preview response as simulated", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}",
      latencyMs: 0,
      previewMock: true,
    });

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "self_hosted",
      selfHostedBaseUrl: "https://preview-ai.drifty.invalid/v1",
      selfHostedModel: "drifty-preview-fast",
    });

    expect(result).toEqual({ kind: "success", message: "Preview connection simulated." });
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

    expect(result).toEqual({ kind: "error", issueKind, message, detail: { httpStatus: status, responseKind: "http_error" } });
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
      detail: { httpStatus: 400, responseKind: "http_error" },
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
      detail: { httpStatus: 429, responseKind: "http_error" },
    });
  });
});

describe("testLocalAiConnection direct providers", () => {
  const openAiSetup = { ...DEFAULT_LOCAL_AI_SETUP, provider: "openai" as const, openaiApiKey: " sk-test ", openaiModel: "gpt-6-luna" };
  const anthropicSetup = { ...DEFAULT_LOCAL_AI_SETUP, provider: "anthropic" as const, anthropicApiKey: "sk-ant-test", anthropicModel: "claude-haiku-5-5" };
  const anthropicBody = JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }], stop_reason: "end_turn", usage: { input_tokens: 9, output_tokens: 4 } });

  beforeEach(() => invokeMock.mockReset());

  it("tests OpenAI through its chat API with the reasoning model flags", async () => {
    invokeMock.mockResolvedValue({ status: 200, body: "{\"choices\":[{\"message\":{\"content\":\"{}\"}}]}", latencyMs: 40 });
    await expect(testLocalAiConnection(openAiSetup)).resolves.toEqual({ kind: "success", message: "Connected in 40 ms." });
    expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", {
      request: expect.objectContaining({ baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", model: "gpt-6-luna", omitTemperature: true, useMaxCompletionTokens: true }),
    });
  });

  it("tests Anthropic through the Messages API command and reads its answer", async () => {
    invokeMock.mockResolvedValue({ status: 200, body: anthropicBody, latencyMs: 55 });
    await expect(testLocalAiConnection(anthropicSetup)).resolves.toEqual({ kind: "success", message: "Connected in 55 ms." });
    expect(invokeMock).toHaveBeenCalledWith("ai_classification_anthropic_chat", {
      request: expect.objectContaining({ apiKey: "sk-ant-test", model: "claude-haiku-5-5", maxTokens: 64 }),
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("request.wireFormat");
  });

  it.each([
    [401, "authentication", "OpenAI rejected the API key."],
    [404, "model_unavailable", "The selected OpenAI model is unavailable."],
    [429, "rate_limited", "OpenAI is rate limiting requests."],
    [503, "unavailable", "OpenAI is temporarily unavailable."],
  ] as const)("maps an OpenAI HTTP %i to %s", async (status, issueKind, message) => {
    invokeMock.mockResolvedValue({ status, body: "{}", latencyMs: 5 });
    await expect(testLocalAiConnection(openAiSetup)).resolves.toMatchObject({ kind: "error", issueKind, message });
  });

  it("names Anthropic when its key is rejected and keeps Retry-After", async () => {
    invokeMock.mockResolvedValue({ status: 429, body: "{}", latencyMs: 5, retryAfterMs: 4_000 });
    await expect(testLocalAiConnection(anthropicSetup)).resolves.toEqual({
      kind: "error", issueKind: "rate_limited", message: "Anthropic is rate limiting requests.", retryAfterMs: 4_000,
      detail: { httpStatus: 429, responseKind: "http_error" },
    });
  });

  it("asks for the missing key without calling the provider", async () => {
    await expect(testLocalAiConnection({ ...openAiSetup, openaiApiKey: " " })).resolves.toMatchObject({ kind: "error", message: "Complete the selected provider settings before testing." });
    await expect(testLocalAiConnection({ ...anthropicSetup, anthropicModel: "" })).resolves.toMatchObject({ kind: "error" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});


describe("testLocalAiConnection custom endpoint failures", () => {
  const customSetup = {
    ...DEFAULT_LOCAL_AI_SETUP,
    provider: "self_hosted" as const,
    selfHostedBaseUrl: "http://localhost:10100",
    selfHostedModel: "gpt-6-luna--fast",
  };

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("says the address returned a web page when a proxy answers its web UI with HTTP 200", async () => {
    invokeMock.mockResolvedValue({ status: 200, body: "<!doctype html><html><head><title>OpenCodex</title></head><body></body></html>", latencyMs: 3 });

    await expect(testLocalAiConnection(customSetup)).resolves.toEqual({
      kind: "error",
      issueKind: "provider",
      message: "The endpoint returned a web page instead of an API response. Check the base URL; it usually ends in /v1.",
      detail: { httpStatus: 200, responseKind: "html" },
    });
  });

  it("points a custom endpoint's HTTP 404 at the address and model while keeping the issue kind", async () => {
    invokeMock.mockResolvedValue({ status: 404, body: JSON.stringify({ error: { message: "Not Found" } }), latencyMs: 3 });

    await expect(testLocalAiConnection(customSetup)).resolves.toEqual({
      kind: "error",
      issueKind: "provider",
      message: "The endpoint returned HTTP 404. Check that the base URL ends in /v1 and that the model ID exists.",
      detail: { httpStatus: 404, responseKind: "http_error" },
    });
  });

  it("keeps the shared authentication wording for a custom endpoint's HTTP 401", async () => {
    invokeMock.mockResolvedValue({ status: 401, body: "{}", latencyMs: 3 });

    await expect(testLocalAiConnection(customSetup)).resolves.toMatchObject({
      issueKind: "provider",
      message: "Provider returned HTTP 401.",
      detail: { httpStatus: 401, responseKind: "http_error" },
    });
  });
});
