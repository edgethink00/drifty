import type { CustomEndpointDraft } from "./OnboardingCustomEndpointSetup";

export type OnboardingStep =
  | "welcome"
  | "choose_setup"
  | "account"
  | "job"
  | "data_review"
  | "permissions"
  | "nudges"
  | "ready"
  | "connect_server"
  | "test_connection"
  | "self_data_review"
  | "privacy"
  | "work_profile"
  | "accessibility"
  | "notifications";

export type OnboardingStepDef = { id: OnboardingStep; label: string };
export type SetupChoice = "simple" | "local_ai" | "byok" | "custom_endpoint";
export type ConnectionCheckStatus = "pending" | "loading" | "success" | "error";
export type ConnectionPhase = "idle" | "testing" | "success" | "failed";
export type ConnectionCheck = { id: string; label: string };
export type NotificationPermissionState = "unknown" | "checking" | "granted" | "denied" | "unavailable";

const BASE_STEPS: OnboardingStepDef[] = [
  { id: "welcome", label: "Welcome" },
  { id: "account", label: "Account" },
  { id: "job", label: "Work" },
  { id: "permissions", label: "Permissions" },
  { id: "nudges", label: "Nudges" },
  { id: "choose_setup", label: "Setup" },
];

const SIMPLE_SETUP_STEPS: OnboardingStepDef[] = [
  { id: "ready", label: "Ready" },
];

const LOCAL_AI_STEPS: OnboardingStepDef[] = [
  { id: "connect_server", label: "Connect" },
  { id: "self_data_review", label: "Data" },
  { id: "ready", label: "Ready" },
];

const BYOK_STEPS: OnboardingStepDef[] = [
  { id: "connect_server", label: "Connect" },
  { id: "test_connection", label: "Test" },
  { id: "self_data_review", label: "Data" },
  { id: "ready", label: "Ready" },
];

const CUSTOM_ENDPOINT_STEPS: OnboardingStepDef[] = [
  { id: "connect_server", label: "Connect" },
  { id: "test_connection", label: "Test" },
  { id: "self_data_review", label: "Data" },
  { id: "ready", label: "Ready" },
];

export function getOnboardingSteps(setupChoice: SetupChoice | null): OnboardingStepDef[] {
  if (setupChoice === "simple") return [...BASE_STEPS, ...SIMPLE_SETUP_STEPS];
  if (setupChoice === "local_ai") return [...BASE_STEPS, ...LOCAL_AI_STEPS];
  if (setupChoice === "byok") return [...BASE_STEPS, ...BYOK_STEPS];
  if (setupChoice === "custom_endpoint") return [...BASE_STEPS, ...CUSTOM_ENDPOINT_STEPS];
  return BASE_STEPS;
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
  { id: "key", label: "OpenRouter key shape valid" },
  { id: "provider", label: "Provider reachable" },
  { id: "classifier", label: "Classification ready" },
];

const CUSTOM_ENDPOINT_CONNECTION_CHECKS: ReadonlyArray<ConnectionCheck> = [
  { id: "url", label: "Endpoint URL valid" },
  { id: "model", label: "Model selected" },
  { id: "classifier", label: "OpenAI-compatible route ready" },
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

export function customEndpointBaseUrlError(baseUrl: string): string | null {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) return "Enter a base URL.";
  if (!/^https?:\/\/\S+$/u.test(trimmedBaseUrl)) return "Base URL should start with http:// or https://.";
  return null;
}

export function customEndpointModelError(model: string): string | null {
  return model.trim() ? null : "Enter a model id.";
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
