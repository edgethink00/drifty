import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_AI_SETUP, toPersistedAnalysisAiSetup } from "./analysisModelSetup";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import { analysisConnectionLabel, resolveSharedAnalysisSetup } from "./sharedAiConnection";
import { resolveIntelligenceRoute } from "./intelligenceRouting";

const local = { ...DEFAULT_LOCAL_AI_SETUP, driftyRoute: "local" as const, managedLocalBaseUrl: "http://127.0.0.1:50397/v1", managedLocalModel: "local-model" };
describe("shared AI connection", () => {
  it("routes automatic Intelligence to the selected local model without Cloud or credentials", () => {
    const setup = resolveSharedAnalysisSetup(DEFAULT_ANALYSIS_AI_SETUP, local, false);
    expect(setup).toMatchObject({ provider: "managed_local", selectionSource: "automatic", managedLocal: { modelId: local.managedLocalModelId, model: "local-model" } });
    expect(resolveIntelligenceRoute({ setup, credentialState: "error", cloudReady: true, cloudFallbackAllowed: true })).toMatchObject({ ready: true, fallback: false });
    expect(resolveIntelligenceRoute({ setup, credentialState: "ready", cloudReady: true, cloudFallbackAllowed: true, confirmedUnavailable: "model_unavailable" })).toMatchObject({ ready: false, fallback: false, setup: { provider: "managed_local" } });
    expect(toPersistedAnalysisAiSetup(setup)).not.toHaveProperty("managedLocal");
  });
  it("shares the own-model defaults but preserves a manual analysis override", () => {
    const connection = { ...local, provider: "openrouter_byok" as const, openRouterModel: "own-default" };
    expect(resolveSharedAnalysisSetup(DEFAULT_ANALYSIS_AI_SETUP, connection, false).openRouterModel).toBe("own-default");
    const manual = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic" as const, selectionSource: "manual" as const };
    expect(resolveSharedAnalysisSetup(manual, connection, true).provider).toBe("anthropic");
    expect(resolveSharedAnalysisSetup(manual, { ...local, provider: "self_hosted", selfHostedModel: "custom" }, false)).toMatchObject({ provider: "self_hosted", selfHostedModel: "custom" });
  });
});

describe("direct providers in the shared connection", () => {
  it("makes OpenAI and Anthropic the Intelligence model with the connection's model", () => {
    const openai = { ...local, provider: "openai" as const, openaiModel: "gpt-6-luna" };
    const anthropic = { ...local, provider: "anthropic" as const, anthropicModel: "claude-haiku-5-5" };
    expect(resolveSharedAnalysisSetup(DEFAULT_ANALYSIS_AI_SETUP, openai, false)).toMatchObject({ provider: "openai", openaiModel: "gpt-6-luna", selectionSource: "automatic" });
    expect(resolveSharedAnalysisSetup(DEFAULT_ANALYSIS_AI_SETUP, anthropic, false)).toMatchObject({ provider: "anthropic", anthropicModel: "claude-haiku-5-5", selectionSource: "automatic" });
  });

  it("keeps a saved override over a direct provider connection", () => {
    const manual = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter" as const, selectionSource: "manual" as const };
    expect(resolveSharedAnalysisSetup(manual, { ...local, provider: "openai" }, true).provider).toBe("openrouter");
  });

  it("labels the connection with its provider and model", () => {
    expect(analysisConnectionLabel({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openai", openaiModel: "gpt-6-luna" })).toBe("OpenAI · gpt-6-luna");
    expect(analysisConnectionLabel({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic", anthropicModel: "claude-haiku-5-5" })).toBe("Anthropic · claude-haiku-5-5");
  });
});
