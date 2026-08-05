import { describe, expect, it } from "vitest";

import {
  aiConnectionIssueKindFromMessage,
  isEstablishedLocalAiDisconnect,
  localAiProviderLabel,
  localAiSetupFingerprint,
  nextLocalAiConnectionCheck,
  type LocalAiConnectionCheck,
} from "./aiConnectionHealth";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "../settings/localAiSetup";

describe("aiConnectionIssueKindFromMessage", () => {
  it("classifies offline and connection failures as network issues", () => {
    expect(aiConnectionIssueKindFromMessage("TypeError: Failed to fetch")).toBe("network");
    expect(aiConnectionIssueKindFromMessage("network unavailable")).toBe("network");
    expect(aiConnectionIssueKindFromMessage("Connection refused")).toBe("network");
  });

  it("classifies HTTP provider failures as provider issues", () => {
    expect(aiConnectionIssueKindFromMessage("Provider returned HTTP 401.")).toBe("provider");
    expect(aiConnectionIssueKindFromMessage("Quota exceeded")).toBe("provider");
  });

  it.each([
    ["OpenRouter rejected the API key.", "authentication"],
    ["OpenRouter credits are required.", "credits"],
    ["OpenRouter blocked this request.", "access"],
    ["The selected OpenRouter model is unavailable.", "model_unavailable"],
    ["OpenRouter is rate limiting requests.", "rate_limited"],
    ["OpenRouter has no available provider for this request.", "unavailable"],
  ] as const)("preserves the typed OpenRouter transport reason: %s", (message, expected) => {
    expect(aiConnectionIssueKindFromMessage(message)).toBe(expected);
  });
});

describe("localAiSetupFingerprint", () => {
  it("does not mark an incomplete selected provider as configured", () => {
    expect(localAiSetupFingerprint(DEFAULT_LOCAL_AI_SETUP)).toBeNull();
  });

  it("changes when an OpenRouter key changes without exposing the raw key", () => {
    const firstSetup = openRouterSetup("sk-or-v1-first-secret");
    const secondSetup = openRouterSetup("sk-or-v1-second-secret");

    const firstFingerprint = localAiSetupFingerprint(firstSetup);
    const secondFingerprint = localAiSetupFingerprint(secondSetup);

    expect(firstFingerprint).not.toBeNull();
    expect(secondFingerprint).not.toBeNull();
    expect(firstFingerprint).not.toBe(secondFingerprint);
    expect(firstFingerprint).not.toContain("sk-or-v1-first-secret");
    expect(secondFingerprint).not.toContain("sk-or-v1-second-secret");
  });
});

describe("localAiProviderLabel", () => {
  it("uses the selected managed local model name for local Drifty routing", () => {
    expect(localAiProviderLabel({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "managed_local",
      driftyRoute: "local",
      managedLocalModelId: "drifty-gemma-4-12b-local",
      managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
      managedLocalModel: "drifty-gemma-4-12b-local",
    })).toBe("Gemma 4 12B");
  });

  it("uses Drifty Cloud when the managed provider routes to cloud", () => {
    expect(localAiProviderLabel({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "managed_local",
      driftyRoute: "cloud",
    })).toBe("Drifty Cloud");
  });

  it("uses the custom endpoint model for self-hosted local routing", () => {
    expect(localAiProviderLabel({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "self_hosted",
      selfHostedModel: "llama3.2",
    })).toBe("llama3.2");
  });

  it("uses the recommended OpenRouter model label for BYOK routing", () => {
    expect(localAiProviderLabel({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "openrouter_byok",
      openRouterModel: "deepseek/deepseek-v4-flash",
    })).toBe("DeepSeek V4 Flash BYOK");
  });
});

describe("nextLocalAiConnectionCheck", () => {
  const target = { provider: "openrouter_byok", fingerprint: "fp-1" } as const;

  it("keeps an established connected state through a single classification transport failure", () => {
    const connected = check({ status: "connected", consecutiveFailures: 0 });
    const next = nextLocalAiConnectionCheck(connected, target, {
      kind: "classification_transport_failure",
      message: "TypeError: Failed to fetch",
    }, 2_000);

    expect(next?.status).toBe("connected");
    expect(next?.consecutiveFailures).toBe(1);
    expect(next?.message).toBe(connected.message);
  });

  it("tears down connected only on the second consecutive classification failure", () => {
    const connected = check({ status: "connected", consecutiveFailures: 0 });
    const afterFirst = nextLocalAiConnectionCheck(connected, target, {
      kind: "classification_transport_failure",
      message: "TypeError: Failed to fetch",
    }, 2_000);
    const afterSecond = nextLocalAiConnectionCheck(afterFirst, target, {
      kind: "classification_transport_failure",
      message: "TypeError: Failed to fetch",
    }, 3_000);

    expect(afterSecond?.status).toBe("failed");
    expect(afterSecond?.issueKind).toBe("network");
    expect(afterSecond?.consecutiveFailures).toBe(2);
  });

  it("fails immediately when a classification error arrives with no established state", () => {
    const next = nextLocalAiConnectionCheck(null, target, {
      kind: "classification_transport_failure",
      message: "Provider returned HTTP 401.",
    }, 1_000);

    expect(next?.status).toBe("failed");
    expect(next?.issueKind).toBe("provider");
    expect(next?.consecutiveFailures).toBe(1);
  });

  it("applies a connection-test verdict immediately in both directions", () => {
    const connected = check({ status: "connected", consecutiveFailures: 0 });
    const failed = nextLocalAiConnectionCheck(connected, target, {
      kind: "connection_test_failure",
      issueKind: "network",
      message: "Connection refused",
    }, 2_000);
    expect(failed?.status).toBe("failed");
    expect(failed?.consecutiveFailures).toBe(1);

    const recovered = nextLocalAiConnectionCheck(failed, target, {
      kind: "connection_test_success",
      message: "Connected in 420 ms.",
    }, 3_000);
    expect(recovered?.status).toBe("connected");
    expect(recovered?.consecutiveFailures).toBe(0);
  });

  it("preserves a typed actionable OpenRouter failure instead of reparsing copy", () => {
    const next = nextLocalAiConnectionCheck(null, target, {
      kind: "connection_test_failure",
      issueKind: "credits",
      message: "OpenRouter credits are required.",
    }, 2_000);

    expect(next).toMatchObject({ status: "failed", issueKind: "credits", consecutiveFailures: 1 });
  });

  it("treats provider contact (including content-level failures) as recovery", () => {
    const failed = check({ status: "failed", consecutiveFailures: 3 });
    const next = nextLocalAiConnectionCheck(failed, target, {
      kind: "provider_contact_ok",
      message: "AI classification returned no usable classifications for 5 unknown segments.",
    }, 2_000);

    expect(next?.status).toBe("connected");
    expect(next?.consecutiveFailures).toBe(0);
  });

  it("does not carry failure history across a provider or fingerprint change", () => {
    const failed = check({ status: "failed", consecutiveFailures: 5 });
    const next = nextLocalAiConnectionCheck(failed, { provider: "self_hosted", fingerprint: "fp-2" }, {
      kind: "classification_transport_failure",
      message: "timed out",
    }, 2_000);

    expect(next?.provider).toBe("self_hosted");
    expect(next?.fingerprint).toBe("fp-2");
    expect(next?.consecutiveFailures).toBe(1);
  });
});

describe("isEstablishedLocalAiDisconnect", () => {
  it("requires a failed status confirmed by repeated probes", () => {
    expect(isEstablishedLocalAiDisconnect(null)).toBe(false);
    expect(isEstablishedLocalAiDisconnect(check({ status: "connected", consecutiveFailures: 0 }))).toBe(false);
    expect(isEstablishedLocalAiDisconnect(check({ status: "failed", consecutiveFailures: 1 }))).toBe(false);
    expect(isEstablishedLocalAiDisconnect(check({ status: "failed", consecutiveFailures: 2 }))).toBe(true);
  });
});

function check(overrides: Partial<LocalAiConnectionCheck>): LocalAiConnectionCheck {
  return {
    provider: "openrouter_byok",
    fingerprint: "fp-1",
    status: "connected",
    issueKind: null,
    message: "Connected in 100 ms.",
    checkedAt: 1_000,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function openRouterSetup(openRouterApiKey: string): LocalAiSetupState {
  return {
    ...DEFAULT_LOCAL_AI_SETUP,
    provider: "openrouter_byok",
    openRouterApiKey,
  };
}
