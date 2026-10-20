import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_AI_SETUP,
  OPENROUTER_RECOMMENDED_MODELS,
  normalizeOpenAiCompatibleBaseUrl,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  shouldPreferLegacyAnalysisCustomConnection,
  toPersistedLocalAiSetup,
} from "./localAiSetup";

describe("OpenRouter setup normalization", () => {
  it("normalizes HTTP endpoint URLs and rejects values that cannot be called", () => {
    expect(normalizeOpenAiCompatibleBaseUrl(" https://models.example/v1/// ")).toBe("https://models.example/v1");
    expect(normalizeOpenAiCompatibleBaseUrl("not a URL")).toBeNull();
    expect(normalizeOpenAiCompatibleBaseUrl("file:///tmp/models")).toBeNull();
  });

  it("never persists the shared custom endpoint API key", () => {
    const persisted = toPersistedLocalAiSetup({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "self_hosted",
      selfHostedApiKey: "custom-session-secret",
      selfHostedBaseUrl: " https://models.example/v1 ",
      selfHostedModel: "qwen2.5:7b",
    });

    expect(persisted).not.toHaveProperty("selfHostedApiKey");
    expect(persisted.selfHostedBaseUrl).toBe("https://models.example/v1");
    expect(JSON.stringify(persisted)).not.toContain("custom-session-secret");
  });

  it("migrates a legacy Intelligence endpoint only over an untouched Classification custom slot", () => {
    expect(shouldPreferLegacyAnalysisCustomConnection(DEFAULT_LOCAL_AI_SETUP)).toBe(true);
    expect(shouldPreferLegacyAnalysisCustomConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      selfHostedBaseUrl: `${DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl}/`,
    })).toBe(true);
    expect(shouldPreferLegacyAnalysisCustomConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      selfHostedBaseUrl: "https://user-entered.example/v1",
    })).toBe(false);
    expect(shouldPreferLegacyAnalysisCustomConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      selfHostedModel: "classification-model",
    })).toBe(false);
  });

  it("keeps existing cleanup behavior when fallbacks include blanks, duplicates, and Auto", () => {
    const primaryModel = normalizeOpenRouterPrimaryModel("deepseek/deepseek-v4-flash");

    const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, [
      "",
      " openrouter/auto ",
      "anthropic/claude-3.5-haiku",
      "anthropic/claude-3.5-haiku",
      " deepseek/deepseek-v4-flash ",
      "google/gemini-flash-1.5",
    ]);

    expect(fallbackModels).toEqual(["anthropic/claude-3.5-haiku", "google/gemini-flash-1.5"]);
  });

  it("recommends exactly the strict-ZDR OpenRouter BYOK catalog", () => {
    expect(OPENROUTER_RECOMMENDED_MODELS.map((model) => model.id)).toEqual([
      "deepseek/deepseek-v4-flash",
      "xiaomi/mimo-v2.5",
      "xiaomi/mimo-v2.5-pro",
      "qwen/qwen3.6-35b-a3b",
      "qwen/qwen3.6-27b",
      "z-ai/glm-4.7-flash",
      "mistralai/mistral-small-2603",
    ]);

    expect(OPENROUTER_RECOMMENDED_MODELS.map((model) => model.id)).not.toEqual(expect.arrayContaining([
      "qwen/qwen3.6-flash",
      "qwen/qwen3.6-plus",
      "qwen/qwen3.6-max-preview",
      "deepseek/deepseek-v4-flash:free",
      "openrouter/free",
    ]));
  });

  it("marks only recommended metadata-supported models with ZDR badges", () => {
    const modelsWithBadges: readonly { readonly id: string; readonly badges?: readonly string[] }[] = OPENROUTER_RECOMMENDED_MODELS;
    expect(modelsWithBadges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "deepseek/deepseek-v4-flash",
          badges: ["Default", "ZDR"],
        }),
      ]),
    );
    for (const model of modelsWithBadges) {
      expect(model.badges).toContain("ZDR");
    }
  });

  it("limits normalized fallbacks so OpenRouter receives at most three total model IDs", () => {
    const fallbackModels = normalizeOpenRouterFallbackModels("deepseek/deepseek-v4-flash", [
      "qwen/qwen3.6-35b-a3b",
      "openrouter/auto",
      "qwen/qwen3.6-27b",
      "z-ai/glm-4.7-flash",
      "mistralai/mistral-small-2603",
    ]);

    expect(["deepseek/deepseek-v4-flash", ...fallbackModels]).toEqual([
      "deepseek/deepseek-v4-flash",
      "qwen/qwen3.6-35b-a3b",
      "qwen/qwen3.6-27b",
    ]);
  });
});

describe("direct provider setup", () => {
  it("never persists OpenAI or Anthropic keys and keeps the chosen models", () => {
    const persisted = toPersistedLocalAiSetup({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "anthropic",
      openaiApiKey: "sk-openai-secret",
      openaiModel: " gpt-6-luna ",
      anthropicApiKey: "sk-ant-secret",
      anthropicModel: "claude-sonnet-5",
    });
    expect(persisted).not.toHaveProperty("openaiApiKey");
    expect(persisted).not.toHaveProperty("anthropicApiKey");
    expect(JSON.stringify(persisted)).not.toMatch(/sk-openai-secret|sk-ant-secret/);
    expect(persisted).toMatchObject({ provider: "anthropic", openaiModel: "gpt-6-luna", anthropicModel: "claude-sonnet-5" });
  });

  it("falls back to the default models when a model is blank", () => {
    const persisted = toPersistedLocalAiSetup({ ...DEFAULT_LOCAL_AI_SETUP, openaiModel: " ", anthropicModel: "" });
    expect(persisted.openaiModel).toBe(DEFAULT_LOCAL_AI_SETUP.openaiModel);
    expect(persisted.anthropicModel).toBe(DEFAULT_LOCAL_AI_SETUP.anthropicModel);
  });
});
