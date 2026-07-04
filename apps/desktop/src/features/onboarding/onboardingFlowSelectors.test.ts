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
  managedLocalReady: false,
  notificationsReady: false,
  setupChoice: "simple",
  step: "permissions",
  workDomain: null,
  workType: null,
} as const;

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

  it("keeps Notifications recommended rather than required on the permissions step", () => {
    expect(canAdvanceOnboarding({
      ...baseAdvanceState,
      notificationsReady: false,
    })).toBe(true);
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
      managedLocalStarted: false,
      step: "permissions",
    })).toBe("Enable Accessibility to continue.");
  });
});
