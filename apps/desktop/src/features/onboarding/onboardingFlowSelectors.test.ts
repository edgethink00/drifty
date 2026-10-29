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
  workContextProvided: true,
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
  it("requires at least one source of work context on the job step", () => {
    expect(canAdvanceOnboarding({
      ...baseAdvanceState,
      step: "job",
      workContextProvided: false,
    })).toBe(false);
    expect(canAdvanceOnboarding({
      ...baseAdvanceState,
      step: "job",
      workContextProvided: true,
    })).toBe(true);
  });

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
      isCustomEndpointSetup: false,
      isManagedProviderSetup: false,
      step: "permissions",
    })).toBe("Enable Accessibility to continue.");
  });

  it("names the page Device Control and Data Access on macOS 27", () => {
    const blocked = {
      accessibilityPaneIsDeviceControl: true,
      canAdvance: false,
      connectionPhase: "idle" as const,
      isCustomEndpointSetup: false,
      isManagedProviderSetup: false,
      step: "permissions" as const,
    };
    expect(blockedHintForStep({ ...blocked, accessibilityRecheckPending: false })).toBe("Enable Device Control and Data Access to continue.");
    expect(blockedHintForStep({ ...blocked, accessibilityRecheckPending: true })).toBe("Checking Device Control and Data Access.");
  });
});

describe("local model blocked hint", () => {
  const localBlock = {
    accessibilityRecheckPending: false,
    canAdvance: false,
    connectionPhase: "idle" as const,
    isCustomEndpointSetup: false,
    isManagedProviderSetup: true,
    step: "connect_server" as const,
  };

  it("asks for a download when an installable model exists", () => {
    expect(blockedHintForStep({ ...localBlock, hasInstallableLocalModel: true }))
      .toBe("Start a local model download to continue.");
  });

  it("sends the user to Cloud when no local model can run", () => {
    expect(blockedHintForStep({ ...localBlock, hasInstallableLocalModel: false }))
      .toBe("No local model can run on this device. Switch to Cloud to continue.");
  });
});
