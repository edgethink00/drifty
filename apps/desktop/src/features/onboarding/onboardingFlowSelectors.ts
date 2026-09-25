import type { ConnectionPhase, OnboardingStep, SetupChoice } from "./onboardingFlow";
import type { LocalizationController } from "../localization/LocalizationContext";

type Translate = LocalizationController["t"];

export function canAdvanceOnboarding({
  accessibilityReady,
  accessibilityRecheckPending,
  accountConnected,
  apiKeyIsValid,
  connectionPhase,
  customEndpointIsValid,
  isCustomEndpointSetup,
  isManagedProviderSetup,
  managedLocalStarted,
  setupChoice,
  step,
  workContextProvided,
}: {
  readonly accessibilityReady: boolean;
  readonly accessibilityRecheckPending: boolean;
  readonly accountConnected: boolean;
  readonly apiKeyIsValid: boolean;
  readonly connectionPhase: ConnectionPhase;
  readonly customEndpointIsValid: boolean;
  readonly isCustomEndpointSetup: boolean;
  readonly isManagedProviderSetup: boolean;
  readonly managedLocalStarted: boolean;
  readonly setupChoice: SetupChoice | null;
  readonly step: OnboardingStep;
  readonly workContextProvided: boolean;
}): boolean {
  switch (step) {
    case "welcome":
      return true;
    case "choose_setup":
      return Boolean(setupChoice);
    case "account":
      return accountConnected;
    case "job":
      return workContextProvided;
    case "self_data_review":
    case "nudges":
    case "ready":
      return true;
    case "permissions":
      return accessibilityReady && !accessibilityRecheckPending;
    case "connect_server":
      // A managed download only needs to have started — it finishes in the
      // background and the first-day gate waits for it before classifying.
      if (isManagedProviderSetup) return managedLocalStarted;
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
  hasInstallableLocalModel = true,
  isCustomEndpointSetup,
  isManagedProviderSetup,
  step,
}: {
  readonly accessibilityRecheckPending: boolean;
  readonly canAdvance: boolean;
  readonly connectionPhase: ConnectionPhase;
  readonly hasInstallableLocalModel?: boolean;
  readonly isCustomEndpointSetup: boolean;
  readonly isManagedProviderSetup: boolean;
  readonly step: OnboardingStep;
}, t?: Translate): string | null {
  if (canAdvance) return null;
  switch (step) {
    case "account":
      return t?.("onboarding.block.account") ?? "Connect an account to continue.";
    case "connect_server":
      if (isManagedProviderSetup) {
        return hasInstallableLocalModel
          ? t?.("onboarding.block.localModel") ?? "Start a local model download to continue."
          : t?.("onboarding.block.localModelInsufficient") ?? "No local model can run on this device. Switch to Cloud to continue.";
      }
      // Field-level problems are already shown under each input; the footer
      // only says why Continue is off, so it never repeats the same sentence.
      if (isCustomEndpointSetup) return t?.("onboarding.block.customEndpoint") ?? "Enter your custom endpoint details.";
      return t?.("onboarding.block.openRouter") ?? "Enter an OpenRouter key that starts with sk-or-.";
    case "test_connection":
      if (connectionPhase === "failed") return t?.("onboarding.block.connectionFailed") ?? "Connection failed. Try again or edit your details.";
      return t?.("onboarding.block.checkingConnection") ?? "Checking your connection.";
    case "permissions":
      if (accessibilityRecheckPending) return t?.("onboarding.block.checkingAccessibility") ?? "Checking Accessibility access.";
      return t?.("onboarding.block.enableAccessibility") ?? "Enable Accessibility to continue.";
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
}, t?: Translate): string {
  switch (step) {
    case "welcome":
      return t?.("onboarding.title.welcome") ?? "Welcome to drifty";
    case "choose_setup":
      return t?.("onboarding.title.chooseSetup") ?? "Choose your setup";
    case "account":
      return t?.("onboarding.title.account") ?? "Connect your account";
    case "job":
      return t?.("onboarding.title.job") ?? "What do you usually do?";
    case "connect_server":
      return isByokSetup
        ? t?.("onboarding.title.openRouter") ?? "Add your OpenRouter key"
        : isCustomEndpointSetup
          ? t?.("onboarding.title.customEndpoint") ?? "Add your custom endpoint"
          : t?.("onboarding.title.localAi") ?? "Set up your local AI model";
    case "test_connection":
      return connectionPhase === "success"
        ? t?.("onboarding.title.connectionSuccess") ?? "Connection successful"
        : connectionPhase === "failed"
          ? t?.("onboarding.title.connectionFailed") ?? "Connection failed"
          : t?.("onboarding.title.testingConnection") ?? "Testing connection";
    case "self_data_review":
      return t?.("onboarding.title.dataHandling") ?? "How your data is handled";
    case "permissions":
      return t?.("onboarding.title.permissions") ?? "Set up permissions";
    case "nudges":
      return t?.("onboarding.title.nudges") ?? "How should Drifty support your focus?";
    case "ready":
      return setupChoice === "simple" && accountConnected
        ? t?.("onboarding.title.readyGo") ?? "You're ready to go"
        : t?.("onboarding.title.readyStart") ?? "You're ready to start";
  }
}

export function footerLabelForStep({
  isUserManagedProviderSetup,
  step,
}: {
  readonly isUserManagedProviderSetup: boolean;
  readonly step: OnboardingStep;
}, t?: Translate): string {
  if (step === "ready") return t?.("onboarding.action.startTracking") ?? "Start tracking";
  if (step === "connect_server" && isUserManagedProviderSetup) return t?.("onboarding.action.testConnection") ?? "Test connection";
  return t?.("common.continue") ?? "Continue";
}
