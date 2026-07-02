import { describe, expect, it } from "vitest";

import {
  OPENROUTER_RECOMMENDED_MODELS,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
} from "./localAiSetup";

describe("OpenRouter setup normalization", () => {
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
