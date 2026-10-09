import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_RECOMMENDED_MODELS,
  DEFAULT_ANALYSIS_AI_SETUP,
  DEFAULT_ANALYSIS_MODEL,
  resolveLegacyAnalysisCustomEndpointConnection,
  resolveInitialAnalysisAiSetup,
  toPersistedAnalysisAiSetup,
} from "./analysisModelSetup";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
}

describe("analysis model setup", () => {
  it("recommends GPT-6 Luna as the eval-backed default", () => {
    expect(DEFAULT_ANALYSIS_MODEL).toBe("openai/gpt-6-luna");
    expect(ANALYSIS_RECOMMENDED_MODELS[0].id).toBe("openai/gpt-6-luna");
    expect(ANALYSIS_RECOMMENDED_MODELS.every((model) => model.supportsZdr)).toBe(true);
  });

  it("omits every direct-provider secret from the persisted shape", () => {
    const persisted = toPersistedAnalysisAiSetup({
      ...DEFAULT_ANALYSIS_AI_SETUP,
      openRouterApiKey: "sk-or-secret",
      selfHostedApiKey: "sk-secret",
      openaiApiKey: "sk-openai-secret",
      anthropicApiKey: "sk-ant-secret",
    });
    expect(persisted).not.toHaveProperty("openRouterApiKey");
    expect(persisted).not.toHaveProperty("selfHostedApiKey");
    expect(persisted).not.toHaveProperty("selfHostedBaseUrl");
    expect(persisted).not.toHaveProperty("openaiApiKey");
    expect(persisted).not.toHaveProperty("anthropicApiKey");
    expect(persisted.provider).toBe("cloud");
  });

  it("persists direct-provider model ids but restores keys as empty", () => {
    stubLocalStorage();
    const persisted = toPersistedAnalysisAiSetup({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic", openaiModel: "gpt-5", anthropicModel: "claude-opus-5" });
    expect(persisted.openaiModel).toBe("gpt-5");
    expect(persisted.anthropicModel).toBe("claude-opus-5");

    window.localStorage.setItem("drifty.analysisAiSetup.v1", JSON.stringify({ ...persisted, openaiApiKey: "leaked", anthropicApiKey: "leaked" }));
    const setup = resolveInitialAnalysisAiSetup();
    expect(setup.provider).toBe("anthropic");
    expect(setup.openaiModel).toBe("gpt-5");
    expect(setup.anthropicModel).toBe("claude-opus-5");
    expect(setup.openaiApiKey).toBe("");
    expect(setup.anthropicApiKey).toBe("");
  });

  it("returns the default when nothing is stored", () => {
    stubLocalStorage();
    expect(resolveInitialAnalysisAiSetup()).toEqual(DEFAULT_ANALYSIS_AI_SETUP);
  });

  it("restores a persisted provider + model but never a key", () => {
    stubLocalStorage({
      "drifty.analysisAiSetup.v1": JSON.stringify({ provider: "openrouter", openRouterModel: "anthropic/claude-sonnet-5", openRouterFallbackModels: [] }),
    });
    const setup = resolveInitialAnalysisAiSetup();
    expect(setup.provider).toBe("openrouter");
    expect(setup.openRouterModel).toBe("anthropic/claude-sonnet-5");
    expect(setup.openRouterApiKey).toBe("");
  });

  it("recovers a customized legacy endpoint even when another provider was last selected", () => {
    stubLocalStorage({
      "drifty.analysisAiSetup.v1": JSON.stringify({
        provider: "openai",
        selfHostedBaseUrl: "https://legacy-custom.example/v1",
      }),
    });

    expect(resolveLegacyAnalysisCustomEndpointConnection()).toEqual({
      baseUrl: "https://legacy-custom.example/v1",
    });
  });
});
