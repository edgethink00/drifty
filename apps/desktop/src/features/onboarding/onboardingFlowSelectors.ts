import type { ConnectionPhase, OnboardingStep, SetupChoice } from "./onboardingFlow";

export function canAdvanceOnboarding({
  accessibilityReady,
  accessibilityRecheckPending,
  accountConnected,
  apiKeyIsValid,
  connectionPhase,
  customEndpointIsValid,
  isCustomEndpointSetup,
  isManagedProviderSetup,
  managedLocalReady,
  setupChoice,
  step,
}: {
  readonly accessibilityReady: boolean;
  readonly accessibilityRecheckPending: boolean;
  readonly accountConnected: boolean;
  readonly apiKeyIsValid: boolean;
  readonly connectionPhase: ConnectionPhase;
  readonly customEndpointIsValid: boolean;
  readonly isCustomEndpointSetup: boolean;
  readonly isManagedProviderSetup: boolean;
  readonly managedLocalReady: boolean;
  readonly setupChoice: SetupChoice | null;
  readonly step: OnboardingStep;
}): boolean {
  switch (step) {
    case "welcome":
      return true;
    case "choose_setup":
      return Boolean(setupChoice);
    case "account":
      return accountConnected;
    case "job":
    case "self_data_review":
    case "nudges":
    case "ready":
      return true;
    case "permissions":
      return accessibilityReady && !accessibilityRecheckPending;
    case "connect_server":
      if (isManagedProviderSetup) return managedLocalReady;
      if (setupChoice === "byok") return apiKeyIsValid;
      if (isCustomEndpointSetup) return customEndpointIsValid;
      return false;
    case "test_connection":
      return connectionPhase === "success";
  }
}

export function blockedHintForStep({
  accessibilityRecheckPending,
  canAdvance,
  connectionPhase,
  customEndpointBaseUrlIssue,
  customEndpointModelIssue,
  isCustomEndpointSetup,
  isManagedProviderSetup,
  managedLocalStarted,
  step,
}: {
  readonly accessibilityRecheckPending: boolean;
  readonly canAdvance: boolean;
  readonly connectionPhase: ConnectionPhase;
  readonly customEndpointBaseUrlIssue: string | null;
  readonly customEndpointModelIssue: string | null;
  readonly isCustomEndpointSetup: boolean;
  readonly isManagedProviderSetup: boolean;
  readonly managedLocalStarted: boolean;
  readonly step: OnboardingStep;
}): string | null {
  if (canAdvance) return null;
  switch (step) {
    case "account":
      return "Connect an account to continue.";
    case "connect_server":
      if (isManagedProviderSetup) {
        return managedLocalStarted
          ? "Wait for the local model download to finish."
          : "Start a local model download to continue.";
      }
      if (isCustomEndpointSetup) return customEndpointBaseUrlIssue ?? customEndpointModelIssue ?? "Enter your custom endpoint details.";
      return "Enter an OpenRouter key that starts with sk-or-.";
    case "test_connection":
      if (connectionPhase === "failed") return "Connection failed. Try again or edit your details.";
      return "Checking your connection.";
    case "permissions":
      if (accessibilityRecheckPending) return "Checking Accessibility access.";
      return "Enable Accessibility to continue.";
    default:
      return null;
  }
}

export function titleForStep({
  accountConnected,
  connectionPhase,
  isByokSetup,
  isCustomEndpointSetup,
  setupChoice,
  step,
}: {
  readonly accountConnected: boolean;
  readonly connectionPhase: ConnectionPhase;
  readonly isByokSetup: boolean;
  readonly isCustomEndpointSetup: boolean;
  readonly setupChoice: SetupChoice | null;
  readonly step: OnboardingStep;
}): string {
  switch (step) {
    case "welcome":
      return "Welcome to drifty";
    case "choose_setup":
      return "Choose your setup";
    case "account":
      return "Connect your account";
    case "job":
      return "What do you usually do?";
    case "connect_server":
      return isByokSetup
        ? "Add your OpenRouter key"
        : isCustomEndpointSetup
          ? "Add your custom endpoint"
          : "Set up your Local AI model";
    case "test_connection":
      return connectionPhase === "success"
        ? "Connection successful"
        : connectionPhase === "failed"
          ? "Connection failed"
          : "Testing connection";
    case "self_data_review":
      return "Review how your data is handled";
    case "permissions":
      return "Set up permissions";
    case "nudges":
      return "Set up drift alerts";
    case "ready":
      return setupChoice === "simple" && accountConnected ? "You're ready to go" : "You're ready to start";
  }
}

export function footerLabelForStep({
  isFinalStep,
  isUserManagedProviderSetup,
  step,
}: {
  readonly isFinalStep: boolean;
  readonly isUserManagedProviderSetup: boolean;
  readonly step: OnboardingStep;
}): string {
  switch (step) {
    case "job":
    case "choose_setup":
    case "test_connection":
    case "self_data_review":
    case "nudges":
      return "Continue";
    case "connect_server":
      return isUserManagedProviderSetup ? "Test connection" : "Continue";
    case "permissions":
      return "Continue";
    case "ready":
      return "Start tracking";
    default:
      return isFinalStep ? "Finish setup" : "Continue";
  }
}
