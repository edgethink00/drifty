import { describe, expect, it } from "vitest";
import {
  modelNeedsMaxCompletionTokens,
  modelRejectsTemperature,
  openAiCompatibleParameterFlags,
} from "./modelParameterSupport";

describe("model parameter support", () => {
  it("drops temperature for OpenAI reasoning models and Claude 5-generation models, bare or vendor-prefixed", () => {
    for (const model of ["gpt-5-mini", "gpt-5", "gpt-6-luna", "openai/gpt-6-luna", "gpt-7", "o3-mini", "o4-mini", "claude-sonnet-5", "claude-haiku-5-5", "anthropic/claude-haiku-5.5", "claude-opus-5", "claude-sonnet-6"]) {
      expect(modelRejectsTemperature(model), model).toBe(true);
    }
  });

  it("keeps temperature for older and non-reasoning models", () => {
    for (const model of ["gpt-4o-mini", "gpt-4.1", "claude-3-5-sonnet-latest", "claude-sonnet-4-5", "claude-haiku-4-5", "deepseek/deepseek-v4-flash", "qwen/qwen3.6-flash", "drifty-qwen3-5-4b-default", "llama3.1:8b"]) {
      expect(modelRejectsTemperature(model), model).toBe(false);
    }
  });

  it("renames the token limit only for OpenAI reasoning models off OpenRouter", () => {
    expect(modelNeedsMaxCompletionTokens("gpt-6-luna")).toBe(true);
    expect(modelNeedsMaxCompletionTokens("claude-sonnet-5")).toBe(false);
    expect(openAiCompatibleParameterFlags(["gpt-6-luna"], { viaOpenRouter: false })).toEqual({ omitTemperature: true, useMaxCompletionTokens: true });
    expect(openAiCompatibleParameterFlags(["openai/gpt-6-luna"], { viaOpenRouter: true })).toEqual({ omitTemperature: true });
    expect(openAiCompatibleParameterFlags(["deepseek/deepseek-v4-flash", "anthropic/claude-haiku-5.5"], { viaOpenRouter: true })).toEqual({ omitTemperature: true });
    expect(openAiCompatibleParameterFlags(["llama3.1:8b"], { viaOpenRouter: false })).toEqual({});
  });
});
