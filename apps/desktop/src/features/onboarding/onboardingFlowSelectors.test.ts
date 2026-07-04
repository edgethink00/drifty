import { describe, expect, it } from "vitest";
import { blockedHintForStep, canAdvanceOnboarding } from "./onboardingFlowSelectors";

const baseAdvanceState = {
  accessibilityReady: true,
  accessibilityRecheckPending: false,
  accountConnected: true,
  apiKeyIsValid: false,
  connectionPhase: "idle",
  customEndpointIsValid: false,
  isCustomEndpointSetup: false,
  isManagedProviderSetup: false,
  managedLocalStarted: false,
  setupChoice: "simple",
  step: "permissions",
} as const;

describe("canAdvanceOnboarding (managed local download)", () => {
  it("lets a started managed download advance before it finishes", () => {
    expect(canAdvanceOnboarding({
      ...baseAdvanceState,
      isManagedProviderSetup: true,
      setupChoice: "local_ai",
      step: "connect_server",
      managedLocalStarted: true,
    })).toBe(true);
    expect(canAdvanceOnboarding({
      ...baseAdvanceState,
      isManagedProviderSetup: true,
      setupChoice: "local_ai",
      step: "connect_server",
      managedLocalStarted: false,
    })).toBe(false);
  });
});

describe("onboardingFlowSelectors", () => {
  it("requires Accessibility readiness on the combined permissions step", () => {
    expect(canAdvanceOnboarding({
      ...baseAdvanceState,
      accessibilityReady: false,
    })).toBe(false);
    expect(canAdvanceOnboarding({
      ...baseAdvanceState,
      accessibilityReady: true,
      accessibilityRecheckPending: true,
    })).toBe(false);
    expect(canAdvanceOnboarding(baseAdvanceState)).toBe(true);
  });

  it("explains the permissions block with the Accessibility hint", () => {
    expect(blockedHintForStep({
      accessibilityRecheckPending: false,
      canAdvance: false,
      connectionPhase: "idle",
      customEndpointBaseUrlIssue: null,
      customEndpointModelIssue: null,
      isCustomEndpointSetup: false,
      isManagedProviderSetup: false,
      step: "permissions",
    })).toBe("Enable Accessibility to continue.");
  });
});
