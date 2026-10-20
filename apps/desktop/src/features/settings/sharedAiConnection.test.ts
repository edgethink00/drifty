import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_AI_SETUP, toPersistedAnalysisAiSetup } from "./analysisModelSetup";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import { resolveSharedAnalysisSetup } from "./sharedAiConnection";
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
