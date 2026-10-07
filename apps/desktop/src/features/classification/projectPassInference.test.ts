import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { localAiProviderConfigFromSetup } from "../settings/localAiClassificationOptions";
import { DEFAULT_LOCAL_AI_SETUP } from "../settings/localAiSetup";
import { toLocalProviderRequest, type MinimizedActivityPayload } from "./localAiProviderRequest";
import { createProjectPassInference } from "./projectPassInference";

const cloudAuth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({ supabase: { auth: cloudAuth } }));

const OUTPUT_JSON = JSON.stringify({ assignments: [{ id: "r0", projectId: "p1", confidence: 0.9 }], corrections: [] });

const CLASSIFICATION_PAYLOAD: MinimizedActivityPayload = {
  segmentId: "segment-1",
  inputFingerprint: "fingerprint-1",
  startedAt: "2026-09-05T09:00:00.000Z",
  endedAt: "2026-09-05T09:05:00.000Z",
  durationSeconds: 300,
  appName: "Code",
  bundleId: "com.microsoft.VSCode",
  browserName: null,
  siteDomain: null,
  siteUrl: null,
  siteTitle: null,
  windowTitle: "Shared connection routing contract",
  youtubeTitle: null,
  youtubeChannelName: null,
  youtubeCategory: null,
  youtubeIsShorts: null,
};

function chatBody(content: string, promptTokens = 100, completionTokens = 20) {
  // The Tauri command returns `body` as a raw JSON string (reqwest text()).
  return { status: 200, latencyMs: 500, body: JSON.stringify({ model: "server-model", choices: [{ message: { content } }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }) };
}

// Anthropic's Messages API shape: content[0].text + usage.input/output_tokens.
function anthropicBody(text: string, inputTokens = 200, outputTokens = 40) {
  return { status: 200, latencyMs: 700, body: JSON.stringify({ model: "claude-sonnet-5", content: [{ type: "text", text }], usage: { input_tokens: inputTokens, output_tokens: outputTokens } }) };
}

describe("createProjectPassInference", () => {
  it("dispatches OpenRouter chat and parses output + usage", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter", openRouterApiKey: "sk-or-x", openRouterModel: "openai/gpt-5-mini" }, { invokeChat });
    const result = await inference("prompt");
    expect(result.output?.assignments[0]).toMatchObject({ id: "r0", projectId: "p1" });
    expect(result.usage).toMatchObject({ provider: "openrouter", tokensIn: 100, tokensOut: 20, latencyMs: 500 });
    const request = invokeChat.mock.calls[0][0];
    expect(request).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-or-x", provider: { zdr: true } });
  });

  it("repairs a malformed OpenRouter JSON response once and aggregates retry usage", async () => {
    const invokeChat = vi
      .fn()
      .mockResolvedValueOnce(chatBody('{"assignments":[', 90, 10))
      .mockResolvedValueOnce(chatBody(OUTPUT_JSON, 30, 20));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter", openRouterApiKey: "sk-or-x", openRouterModel: "openai/gpt-5-mini" }, { invokeChat });

    const result = await inference("prompt");

    expect(result.output?.assignments[0]).toMatchObject({ id: "r0", projectId: "p1" });
    expect(result.usage).toMatchObject({ provider: "openrouter", tokensIn: 120, tokensOut: 30, latencyMs: 1000 });
    expect(invokeChat).toHaveBeenCalledTimes(2);
    const retryRequest = invokeChat.mock.calls[1][0];
    expect(retryRequest.messages).toEqual([
      { role: "user", content: "prompt" },
      { role: "assistant", content: '{"assignments":[' },
      { role: "user", content: expect.stringContaining("valid JSON") },
    ]);
  });

  it("dispatches OpenAI direct chat through the OpenAI-compatible path", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openai", openaiApiKey: "sk-openai", openaiModel: "gpt-5-mini" }, { invokeChat });
    const result = await inference("prompt");
    expect(result.output?.assignments[0]).toMatchObject({ id: "r0", projectId: "p1" });
    expect(result.usage).toMatchObject({ provider: "openai", tokensIn: 100, tokensOut: 20 });
    const request = invokeChat.mock.calls[0][0];
    expect(request).toMatchObject({ baseUrl: "https://api.openai.com/v1", apiKey: "sk-openai", model: "gpt-5-mini" });
    // Direct OpenAI carries no OpenRouter privacy provider preferences.
    expect(request).not.toHaveProperty("provider");
  });

  it("returns null output without an OpenAI key", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openai", openaiApiKey: "", openaiModel: "gpt-5-mini" }, { invokeChat });
    const result = await inference("prompt");
    expect(result.output).toBeNull();
    expect(invokeChat).not.toHaveBeenCalled();
  });

  it("dispatches Anthropic chat through the native command and maps its Messages-API shape", async () => {
    const invokeAnthropicChat = vi.fn(async (_request: Record<string, unknown>) => anthropicBody(OUTPUT_JSON));
    const inference = createProjectPassInference(
      { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic", anthropicApiKey: "sk-ant", anthropicModel: "claude-sonnet-5" },
      { invokeAnthropicChat },
    );
    const result = await inference("prompt");
    expect(result.output?.assignments[0]).toMatchObject({ id: "r0", projectId: "p1" });
    expect(result.usage).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5", tokensIn: 200, tokensOut: 40, latencyMs: 700 });
    const request = invokeAnthropicChat.mock.calls[0][0];
    expect(request).toMatchObject({ apiKey: "sk-ant", model: "claude-sonnet-5" });
    expect(request.messages).toEqual([{ role: "user", content: "prompt" }]);
  });

  it("returns null output without an Anthropic key and never calls the native command", async () => {
    const invokeAnthropicChat = vi.fn(async (_request: Record<string, unknown>) => anthropicBody(OUTPUT_JSON));
    const inference = createProjectPassInference(
      { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic", anthropicApiKey: "", anthropicModel: "claude-sonnet-5" },
      { invokeAnthropicChat },
    );
    const result = await inference("prompt");
    expect(result.output).toBeNull();
    expect(invokeAnthropicChat).not.toHaveBeenCalled();
  });

  it("treats a non-2xx Anthropic response as no output", async () => {
    const invokeAnthropicChat = vi.fn(async (_request: Record<string, unknown>) => ({ status: 401, latencyMs: 5, body: JSON.stringify({ error: { message: "invalid x-api-key" } }) }));
    const inference = createProjectPassInference(
      { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic", anthropicApiKey: "sk-bad", anthropicModel: "claude-sonnet-5" },
      { invokeAnthropicChat },
    );
    const result = await inference("prompt");
    expect(result.output).toBeNull();
    expect(result.usage.provider).toBe("anthropic");
  });

  it("returns null output without an OpenRouter key", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter", openRouterApiKey: "" }, { invokeChat });
    const result = await inference("prompt");
    expect(result.output).toBeNull();
    expect(invokeChat).not.toHaveBeenCalled();
  });

  it("treats a non-2xx chat response as no output", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => ({ status: 500, body: {} }));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "self_hosted", selfHostedBaseUrl: "http://localhost:11434/v1", selfHostedModel: "qwen" }, { invokeChat });
    const result = await inference("prompt");
    expect(result.output).toBeNull();
  });

  it("sends self-hosted without OpenRouter privacy headers", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "self_hosted", selfHostedBaseUrl: "http://localhost:11434/v1", selfHostedModel: "qwen", selfHostedApiKey: "" }, { invokeChat });
    await inference("prompt");
    const request = invokeChat.mock.calls[0][0];
    expect(request).not.toHaveProperty("provider");
    expect(request).toMatchObject({ baseUrl: "http://localhost:11434/v1", model: "qwen" });
  });

  it("reuses one custom connection while routing Classification and Intelligence to independent models", async () => {
    const sharedConnection = {
      selfHostedBaseUrl: "https://models.example/v1",
      selfHostedApiKey: "shared-session-key",
    };
    const classificationOptions = localAiProviderConfigFromSetup({
      ...DEFAULT_LOCAL_AI_SETUP,
      ...sharedConnection,
      provider: "self_hosted",
      selfHostedModel: "classification-fast-model",
    });
    expect(classificationOptions).not.toBeNull();
    const classificationRequest = classificationOptions
      ? toLocalProviderRequest(classificationOptions.localProvider, [CLASSIFICATION_PAYLOAD], null)
      : null;

    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => chatBody(OUTPUT_JSON));
    const intelligenceInference = createProjectPassInference({
      ...DEFAULT_ANALYSIS_AI_SETUP,
      ...sharedConnection,
      provider: "self_hosted",
      selfHostedModel: "intelligence-reasoning-model",
    }, { invokeChat });
    await intelligenceInference("project analysis prompt");

    expect(classificationRequest?.request).toMatchObject({
      baseUrl: sharedConnection.selfHostedBaseUrl,
      apiKey: sharedConnection.selfHostedApiKey,
      model: "classification-fast-model",
    });
    expect(invokeChat).toHaveBeenCalledTimes(1);
    expect(invokeChat.mock.calls[0][0]).toMatchObject({
      baseUrl: sharedConnection.selfHostedBaseUrl,
      apiKey: sharedConnection.selfHostedApiKey,
      model: "intelligence-reasoning-model",
    });
    expect(classificationRequest?.request["model"]).not.toBe(invokeChat.mock.calls[0][0]["model"]);
  });

  it("does not invoke the Intelligence model for an invalid shared custom endpoint URL", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference({
      ...DEFAULT_ANALYSIS_AI_SETUP,
      provider: "self_hosted",
      selfHostedBaseUrl: "not-a-valid-url",
      selfHostedModel: "qwen",
    }, { invokeChat });

    const result = await inference("prompt");

    expect(result.output).toBeNull();
    expect(invokeChat).not.toHaveBeenCalled();
  });

  it("routes cloud through the review-activity edge function", async () => {
    const invokeCloud = vi.fn(async () => ({ content: OUTPUT_JSON, model: "cloud-model", tokensIn: 50, tokensOut: 10, latencyMs: null }));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "cloud" }, { invokeCloud });
    const result = await inference("prompt");
    expect(invokeCloud).toHaveBeenCalledWith("prompt");
    expect(result.output?.assignments).toHaveLength(1);
    expect(result.usage).toMatchObject({ provider: "cloud", model: "cloud-model", tokensIn: 50 });
  });

  // Regression: the Tauri command returns `body` as a raw JSON STRING (reqwest
  // text()), not a parsed object. The real OpenRouter 200 response shape must be
  // parsed from that string before choices/usage are readable — treating it as
  // an object silently yielded 0 tokens / 0 assignments in the app.
  it("parses a raw STRING body from the native command (real Rust shape)", async () => {
    const rawStringBody = JSON.stringify({
      model: "openai/gpt-5-mini-2025-08-07",
      choices: [{ message: { content: OUTPUT_JSON } }],
      usage: { prompt_tokens: 8123, completion_tokens: 456, total_tokens: 8579 },
    });
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => ({ status: 200, latencyMs: 1200, body: rawStringBody }));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter", openRouterApiKey: "sk-or-x", openRouterModel: "openai/gpt-5-mini" }, { invokeChat });
    const result = await inference("prompt");
    expect(result.output?.assignments[0]).toMatchObject({ id: "r0", projectId: "p1" });
    expect(result.usage).toMatchObject({ provider: "openrouter", tokensIn: 8123, tokensOut: 456 });
  });

  it("surfaces null output (not a throw) when the native body is a non-JSON string", async () => {
    const invokeChat = vi.fn(async (_request: Record<string, unknown>) => ({ status: 200, latencyMs: 10, body: "upstream gateway timeout" }));
    const inference = createProjectPassInference({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter", openRouterApiKey: "sk-or-x", openRouterModel: "openai/gpt-5-mini" }, { invokeChat });
    const result = await inference("prompt");
    expect(result.output).toBeNull();
    expect(result.usage.tokensIn).toBeNull();
  });
});


describe("bounded Intelligence Cloud recovery", () => {
  const setup = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openai" as const, openaiApiKey: "synthetic-key" };
  it("recovers a rejected chunk once, then uses Cloud for remaining chunks in that pass", async () => {
    const invokeChat = vi.fn().mockResolvedValue({ status: 404, body: '{"error":{"code":"model_not_found"}}' });
    const invokeCloud = vi.fn().mockResolvedValue({ content: OUTPUT_JSON });
    const inference = createProjectPassInference(setup, { invokeChat, invokeCloud, canFallbackToCloud: () => true });
    expect((await inference("chunk-a")).usage.provider).toBe("cloud");
    expect((await inference("chunk-b")).usage.provider).toBe("cloud");
    expect(invokeChat).toHaveBeenCalledTimes(1);
    expect(invokeCloud).toHaveBeenCalledTimes(2);
  });
  it("rechecks eligibility after the rejection and before subsequent Cloud chunks", async () => {
    let eligible = true;
    const invokeChat = vi.fn().mockResolvedValue({ status: 401, body: "{}" });
    const invokeCloud = vi.fn().mockResolvedValue({ content: OUTPUT_JSON });
    const inference = createProjectPassInference(setup, { invokeChat, invokeCloud, canFallbackToCloud: () => eligible });
    await inference("chunk-a");
    eligible = false;
    expect((await inference("chunk-b")).output).toBeNull();
    expect(invokeCloud).toHaveBeenCalledTimes(1);
  });
  it.each([403, 404, 429, 500, 503])("does not switch destinations on ambiguous/transient HTTP %s", async status => {
    const invokeCloud = vi.fn();
    const inference = createProjectPassInference(setup, { invokeChat: vi.fn().mockResolvedValue({ status, body: "{}" }), invokeCloud, canFallbackToCloud: () => true });
    expect((await inference("prompt")).output).toBeNull();
    expect(invokeCloud).not.toHaveBeenCalled();
  });
  it("does not duplicate a charged malformed response when its repair gets an auth error", async () => {
    const invokeChat = vi.fn().mockResolvedValueOnce(chatBody('{"assignments":[')).mockResolvedValueOnce({ status: 401, body: "{}" });
    const invokeCloud = vi.fn();
    const inference = createProjectPassInference(setup, { invokeChat, invokeCloud, canFallbackToCloud: () => true });
    expect((await inference("prompt")).output).toBeNull();
    expect(invokeChat).toHaveBeenCalledTimes(2);
    expect(invokeCloud).not.toHaveBeenCalled();
  });
  it("does not reroute an uncertain network/timeout failure", async () => {
    const invokeCloud = vi.fn();
    const inference = createProjectPassInference(setup, { invokeChat: vi.fn().mockRejectedValue(new Error("timeout")), invokeCloud, canFallbackToCloud: () => true });
    await expect(inference("prompt")).rejects.toThrow("timeout");
    expect(invokeCloud).not.toHaveBeenCalled();
  });
});


describe("Intelligence dispatch ownership after async auth", () => {
  const setup = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openai" as const, openaiApiKey: "synthetic-key" };
  const session = (id: string) => ({ data: { session: { access_token: "synthetic-cloud-token", user: { id } } } });
  it.each(["owner", "eligibility"])("cancels Cloud recovery if %s changes while loading the token", async changed => {
    let current = true;
    let eligible = true;
    let finish!: (value: ReturnType<typeof session>) => void;
    cloudAuth.getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const invokeChat = vi.fn().mockResolvedValue({ status: 401, body: "{}" });
    const inference = createProjectPassInference(setup, { invokeChat, isRequestCurrent: () => current, expectedCloudUserId: "account-a", canFallbackToCloud: () => eligible });
    const pending = inference("prompt");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    if (changed === "owner") current = false;
    else eligible = false;
    finish(session("account-a"));
    await expect(pending).rejects.toThrow("settings changed");
    expect(invokeChat).toHaveBeenCalledTimes(1);
  });
  it("rejects another account's session even before React has published its account change", async () => {
    cloudAuth.getSession.mockResolvedValueOnce(session("account-b"));
    const invokeChat = vi.fn().mockResolvedValue({ status: 401, body: "{}" });
    const inference = createProjectPassInference(setup, { invokeChat, isRequestCurrent: () => true, expectedCloudUserId: "account-a", canFallbackToCloud: () => true });
    await expect(inference("prompt")).rejects.toThrow("settings changed");
    expect(invokeChat).toHaveBeenCalledTimes(1);
  });
  it("keeps explicitly selected Cloud usable independently of the Classification fallback choice", async () => {
    cloudAuth.getSession.mockResolvedValueOnce(session("account-a"));
    const invokeChat = vi.fn().mockResolvedValue(chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference(DEFAULT_ANALYSIS_AI_SETUP, { invokeChat, isRequestCurrent: () => true, expectedCloudUserId: "account-a", canFallbackToCloud: () => false });
    expect((await inference("prompt")).usage.provider).toBe("cloud");
    expect(invokeChat).toHaveBeenCalledTimes(1);
  });
  it("does not send a JSON repair after its owner was invalidated during the first response", async () => {
    let current = true;
    const invokeChat = vi.fn().mockImplementationOnce(async () => { current = false; return chatBody('{"assignments":['); });
    const inference = createProjectPassInference(setup, { invokeChat, isRequestCurrent: () => current });
    await expect(inference("prompt")).rejects.toThrow("settings changed");
    expect(invokeChat).toHaveBeenCalledTimes(1);
  });
  it("also rechecks eligibility for Cloud recovery chosen before dispatch because configuration was incomplete", async () => {
    let eligible = true;
    let finish!: (value: ReturnType<typeof session>) => void;
    cloudAuth.getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const invokeChat = vi.fn();
    const inference = createProjectPassInference(DEFAULT_ANALYSIS_AI_SETUP, { invokeChat, cloudRecovery: true, isRequestCurrent: () => true, expectedCloudUserId: "account-a", canFallbackToCloud: () => eligible });
    const pending = inference("prompt");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    eligible = false;
    finish(session("account-a"));
    await expect(pending).rejects.toThrow("settings changed");
    expect(invokeChat).not.toHaveBeenCalled();
  });

  it("uses the same minimized structured Cloud payload and Cloud token during a native recovery", async () => {
    cloudAuth.getSession.mockResolvedValueOnce(session("account-a"));
    const invokeChat = vi.fn().mockResolvedValueOnce({ status: 401, body: "{}" }).mockResolvedValueOnce(chatBody(OUTPUT_JSON));
    const inference = createProjectPassInference(setup, { invokeChat, isRequestCurrent: () => true, expectedCloudUserId: "account-a", canFallbackToCloud: () => true });
    const input = { beforeContextWindows: [], coreWindows: [], afterContextWindows: [], workProfile: null, projects: [] };
    expect((await inference("minimized prompt", input)).usage.provider).toBe("cloud");
    const recovered = invokeChat.mock.calls[1][0];
    expect(recovered).toMatchObject({ apiKey: "synthetic-cloud-token", model: "drifty-cloud" });
    expect(JSON.parse(recovered.messages[0].content)).toEqual({ driftyReviewChunk: input });
    expect(JSON.stringify(recovered)).not.toContain("synthetic-key");
    expect(invokeChat).toHaveBeenCalledTimes(2);
  });

});
