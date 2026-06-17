import { describe, expect, it } from "vitest";

import {
  aiConnectionIssueKindFromMessage,
  localAiSetupFingerprint,
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

function openRouterSetup(openRouterApiKey: string): LocalAiSetupState {
  return {
    ...DEFAULT_LOCAL_AI_SETUP,
    provider: "openrouter_byok",
    openRouterApiKey,
  };
}
