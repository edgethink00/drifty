import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_AI_SETUP } from "./analysisModelSetup";
import { analysisUnavailableReasonFromHttp, resolveIntelligenceRoute } from "./intelligenceRouting";

describe("Intelligence destination policy", () => {
  const input = { setup: { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic" as const }, credentialState: "missing" as const, cloudReady: true, cloudFallbackAllowed: true };
  it("uses eligible opted-in Cloud for a missing direct key without changing the preference", () => {
    const route = resolveIntelligenceRoute(input);
    expect(route).toMatchObject({ ready: true, fallback: true, setup: { provider: "cloud" } });
    expect(input.setup.provider).toBe("anthropic");
  });
  it.each(["idle", "loading", "error"] as const)("does not infer missing credentials from %s", credentialState => {
    expect(resolveIntelligenceRoute({ ...input, credentialState })).toMatchObject({ ready: false, fallback: false, setup: { provider: "anthropic" }, reason: "checking" });
  });
  it.each([{ cloudReady: false, cloudFallbackAllowed: true }, { cloudReady: true, cloudFallbackAllowed: false }])("requires both Cloud access and prior route selection: %j", cloud => {
    expect(resolveIntelligenceRoute({ ...input, ...cloud })).toMatchObject({ ready: false, fallback: false, setup: { provider: "anthropic" } });
  });
  it("allows a keyless custom endpoint and keeps a usable preferred provider", () => {
    expect(resolveIntelligenceRoute({ ...input, setup: { ...input.setup, provider: "self_hosted", selfHostedBaseUrl: "http://localhost:11434/v1", selfHostedModel: "reasoning" } })).toMatchObject({ ready: true, fallback: false, setup: { provider: "self_hosted" } });
  });
  it("reroutes an invalid URL but does not reroute while restoring a custom key", () => {
    const setup = { ...input.setup, provider: "self_hosted" as const, selfHostedBaseUrl: "invalid", selfHostedModel: "reasoning" };
    expect(resolveIntelligenceRoute({ ...input, setup }).setup.provider).toBe("cloud");
    expect(resolveIntelligenceRoute({ ...input, setup, credentialState: "loading" }).setup.provider).toBe("self_hosted");
  });
  it("uses the confirmed rejection only while that configuration remains rejected", () => {
    const configured = { ...input, credentialState: "ready" as const };
    expect(resolveIntelligenceRoute({ ...configured, confirmedUnavailable: "authentication" }).setup.provider).toBe("cloud");
    expect(resolveIntelligenceRoute(configured).setup.provider).toBe("anthropic");
  });
  it.each([429, 500, 503, 403, 404])("does not reroute ambiguous HTTP %s", status => {
    expect(analysisUnavailableReasonFromHttp(status, "temporary issue")).toBeNull();
  });
  it("distinguishes model and credential rejections from quota and access errors", () => {
    expect(analysisUnavailableReasonFromHttp(401, "")).toBe("authentication");
    expect(analysisUnavailableReasonFromHttp(404, { error: { code: "model_not_found" } })).toBe("model_unavailable");
    expect(analysisUnavailableReasonFromHttp(403, { error: { type: "authentication_error" } })).toBe("authentication");
    expect(analysisUnavailableReasonFromHttp(403, { error: { code: "insufficient_quota" } })).toBeNull();
    expect(analysisUnavailableReasonFromHttp(429, { error: { type: "authentication_error" } })).toBeNull();
  });
});
