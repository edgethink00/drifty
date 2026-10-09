import type { CustomEndpointDraft } from "./OnboardingCustomEndpointSetup";
import type { TranslationKey } from "../localization/translations";

export type OnboardingStep =
  | "welcome"
  | "choose_setup"
  | "account"
  | "job"
  | "permissions"
  | "nudges"
  | "ready"
  | "connect_server"
  | "test_connection"
  | "self_data_review";

export type OnboardingStepDef = { id: OnboardingStep; label: string };
export type OnboardingStepsOptions = { readonly skipAccountStep?: boolean };
export type SetupChoice = "simple" | "local_ai" | "byok" | "custom_endpoint";
export type ConnectionCheckStatus = "pending" | "loading" | "success" | "error";
export type ConnectionPhase = "idle" | "testing" | "success" | "failed";
export type ConnectionCheck = { id: string; labelKey: TranslationKey };
/** A failed connection test: either local input validation or the provider's own message. */
export type ConnectionFailure =
  | { readonly kind: "local"; readonly key: TranslationKey }
  | { readonly kind: "remote"; readonly message: string };
export type NotificationPermissionState = "unknown" | "checking" | "granted" | "denied" | "unavailable";

/**
 * The first screen pairs the product picture with sign-in. It is the "account" step while an
 * account is still required, and the "welcome" step when sign-in is already settled for this
 * run (an active Pro pass on a connected account, or the development auth bypass); both render
 * the same entry screen. Neither counts as a setup step in the progress dots.
 */
const ENTRY_STEP: OnboardingStepDef = { id: "account", label: "Account" };
const SETTLED_ENTRY_STEP: OnboardingStepDef = { id: "welcome", label: "Welcome" };

const SHARED_STEPS: OnboardingStepDef[] = [
  { id: "job", label: "Work" },
  { id: "choose_setup", label: "Setup" },
];

const SIMPLE_SETUP_STEPS: OnboardingStepDef[] = [
  { id: "permissions", label: "Permissions" },
  { id: "ready", label: "Ready" },
];

const LOCAL_AI_STEPS: OnboardingStepDef[] = [
  { id: "connect_server", label: "Connect" },
  { id: "self_data_review", label: "Data" },
  { id: "permissions", label: "Permissions" },
  { id: "ready", label: "Ready" },
];

const BYOK_STEPS: OnboardingStepDef[] = [
  { id: "connect_server", label: "Connect" },
  { id: "test_connection", label: "Test" },
  { id: "self_data_review", label: "Data" },
  { id: "permissions", label: "Permissions" },
  { id: "ready", label: "Ready" },
];

const CUSTOM_ENDPOINT_STEPS: OnboardingStepDef[] = [
  { id: "connect_server", label: "Connect" },
  { id: "test_connection", label: "Test" },
  { id: "self_data_review", label: "Data" },
  { id: "permissions", label: "Permissions" },
  { id: "ready", label: "Ready" },
];

export function getOnboardingSteps(setupChoice: SetupChoice | null, options: OnboardingStepsOptions = {}): OnboardingStepDef[] {
  const baseSteps = [options.skipAccountStep ? SETTLED_ENTRY_STEP : ENTRY_STEP, ...SHARED_STEPS];
  if (setupChoice === "simple") return [...baseSteps, ...SIMPLE_SETUP_STEPS];
  if (setupChoice === "local_ai") return [...baseSteps, ...LOCAL_AI_STEPS];
  if (setupChoice === "byok") return [...baseSteps, ...BYOK_STEPS];
  if (setupChoice === "custom_endpoint") return [...baseSteps, ...CUSTOM_ENDPOINT_STEPS];
  return baseSteps;
}

export function isOnboardingEntryStep(step: OnboardingStep): boolean {
  return step === "account" || step === "welcome";
}

/** The setup steps after the entry screen; the progress dots and Back count only these. */
export function onboardingSetupSteps(steps: readonly OnboardingStepDef[]): OnboardingStepDef[] {
  return steps.filter((step) => !isOnboardingEntryStep(step.id));
}

export function remapOnboardingStepForSetupChoice(
  step: OnboardingStep,
  fromChoice: SetupChoice | null,
  toChoice: SetupChoice,
  options: OnboardingStepsOptions = {},
): OnboardingStep {
  const nextSteps = getOnboardingSteps(toChoice, options);
  if (nextSteps.some((item) => item.id === step)) return step;
  const previousSteps = getOnboardingSteps(fromChoice, options);
  const previousIndex = previousSteps.findIndex((item) => item.id === step);
  if (previousIndex < 0) return nextSteps[0]?.id ?? "welcome";
  return nextSteps[Math.min(previousIndex, nextSteps.length - 1)]?.id ?? "welcome";
}

export const PRIVACY_RECORDED = [
  "App name",
  "Window title",
  "Active time",
  "Idle time",
  "Browser/site context",
  "YouTube metadata",
  "Focus/Drift classification",
  "AI tool token usage summary",
];

export const PRIVACY_NOT_RECORDED = [
  "Keystrokes",
  "Screenshots",
  "Screen recordings",
  "File contents",
  "Passwords",
  "Message bodies",
];

const BYOK_CONNECTION_CHECKS: ReadonlyArray<ConnectionCheck> = [
  { id: "key", labelKey: "onboarding.test.check.key" },
  { id: "provider", labelKey: "onboarding.test.check.provider" },
  { id: "classifier", labelKey: "onboarding.test.check.classifier" },
];

const CUSTOM_ENDPOINT_CONNECTION_CHECKS: ReadonlyArray<ConnectionCheck> = [
  { id: "url", labelKey: "onboarding.test.check.url" },
  { id: "model", labelKey: "onboarding.test.check.model" },
  { id: "classifier", labelKey: "onboarding.test.check.route" },
];

export const CUSTOM_ENDPOINT_DEFAULT_DRAFT: CustomEndpointDraft = {
  baseUrl: "http://localhost:11434/v1",
  model: "",
};

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  const last4 = trimmed.slice(-4);
  return `sk-or-••••••${last4}`;
}

export function customEndpointBaseUrlError(baseUrl: string): TranslationKey | null {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) return "onboarding.connection.baseUrlMissing";
  if (!/^https?:\/\/\S+$/u.test(trimmedBaseUrl)) return "onboarding.connection.baseUrlScheme";
  return null;
}

export function customEndpointModelError(model: string): TranslationKey | null {
  return model.trim() ? null : "onboarding.connection.modelMissing";
}

export function connectionChecksForSetup(setupChoice: SetupChoice | null): ReadonlyArray<ConnectionCheck> {
  switch (setupChoice) {
    case "byok":
      return BYOK_CONNECTION_CHECKS;
    case "custom_endpoint":
      return CUSTOM_ENDPOINT_CONNECTION_CHECKS;
    case "simple":
    case "local_ai":
    case null:
      return BYOK_CONNECTION_CHECKS;
    default:
      return assertNeverSetupChoice(setupChoice);
  }
}

class SetupChoiceError extends Error {
  constructor(readonly setupChoice: string) {
    super(`Unhandled onboarding setup choice: ${setupChoice}`);
    this.name = "SetupChoiceError";
  }
}

function assertNeverSetupChoice(value: never): never {
  throw new SetupChoiceError(String(value));
}
