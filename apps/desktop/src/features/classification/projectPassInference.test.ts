import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { createProjectPassInference } from "./projectPassInference";

const OUTPUT_JSON = JSON.stringify({ assignments: [{ id: "r0", projectId: "p1", confidence: 0.9 }], corrections: [] });

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
