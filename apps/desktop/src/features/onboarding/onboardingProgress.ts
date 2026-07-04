import type { CustomEndpointDraft } from "./OnboardingCustomEndpointSetup";
import {
  CUSTOM_ENDPOINT_DEFAULT_DRAFT,
  getOnboardingSteps,
  type OnboardingStep,
  type SetupChoice,
} from "./onboardingFlow";

const ONBOARDING_PROGRESS_STORAGE_VERSION = 1;
const ONBOARDING_PROGRESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OnboardingProgressSnapshot = {
  readonly version: typeof ONBOARDING_PROGRESS_STORAGE_VERSION;
  readonly step: OnboardingStep;
  readonly setupChoice: SetupChoice | null;
  readonly mainActivities: readonly string[];
  readonly mainActivityOther: string;
  readonly workType: string | null;
  readonly workTypeOther: string;
  readonly workDomain: string | null;
  readonly workDomainOther: string;
  readonly driftAlarmEnabled: boolean;
  readonly extremeNudgeEnabled: boolean;
  readonly openAtLoginEnabled: boolean;
  readonly customEndpointDraft: CustomEndpointDraft;
  readonly savedAt: string;
};

export type OnboardingProgressInput = Omit<OnboardingProgressSnapshot, "version" | "savedAt">;

type ClampOnboardingProgressOptions = {
  readonly accountConnected: boolean;
  readonly skipAccountStep: boolean;
};

export function getOnboardingProgressStorageKey(userId: string): string {
  return `drifty:onboarding-progress:v${ONBOARDING_PROGRESS_STORAGE_VERSION}:${userId}`;
}

export function readOnboardingProgress(userId: string, now = new Date()): OnboardingProgressSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const rawValue = window.localStorage.getItem(getOnboardingProgressStorageKey(userId));
    return parseOnboardingProgress(rawValue, now);
  } catch (error) {
    if (error instanceof Error) return null;
    return null;
  }
}

export function writeOnboardingProgress(
  userId: string,
  progress: OnboardingProgressInput,
  now = new Date(),
): void {
  if (typeof window === "undefined") return;
  const snapshot: OnboardingProgressSnapshot = {
    version: ONBOARDING_PROGRESS_STORAGE_VERSION,
    ...progress,
    savedAt: now.toISOString(),
  };
  try {
    window.localStorage.setItem(getOnboardingProgressStorageKey(userId), JSON.stringify(snapshot));
  } catch (error) {
    if (error instanceof Error) return;
  }
}

export function clearOnboardingProgress(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getOnboardingProgressStorageKey(userId));
  } catch (error) {
    if (error instanceof Error) return;
  }
}

export function clampOnboardingProgressStep(
  progress: OnboardingProgressSnapshot,
  options: ClampOnboardingProgressOptions,
): OnboardingProgressSnapshot {
  const steps = getOnboardingSteps(progress.setupChoice, { skipAccountStep: options.skipAccountStep });
  const stepIds = steps.map((step) => step.id);
  const candidateStep = stepIds.includes(progress.step) ? progress.step : stepIds[0] ?? "welcome";
  const accountIndex = stepIds.indexOf("account");
  const candidateIndex = stepIds.indexOf(candidateStep);
  if (!options.accountConnected && accountIndex >= 0 && candidateIndex > accountIndex) {
    return { ...progress, step: "account" };
  }
  if (
    (progress.setupChoice === "byok" || progress.setupChoice === "custom_endpoint")
    && (candidateStep === "test_connection" || candidateStep === "self_data_review" || candidateStep === "ready")
  ) {
    return { ...progress, step: "connect_server" };
  }
  return { ...progress, step: candidateStep };
}

function parseOnboardingProgress(rawValue: string | null, now: Date): OnboardingProgressSnapshot | null {
  if (!rawValue) return null;
  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!isRecord(parsedValue) || parsedValue.version !== ONBOARDING_PROGRESS_STORAGE_VERSION) return null;
    const step = parseOnboardingStep(parsedValue.step);
    const setupChoice = parseSetupChoice(parsedValue.setupChoice);
    const savedAt = typeof parsedValue.savedAt === "string" ? parsedValue.savedAt : "";
    if (!step || !savedAtIsFresh(savedAt, now)) return null;
    return {
      version: ONBOARDING_PROGRESS_STORAGE_VERSION,
      step,
      setupChoice,
      mainActivities: parseStringArray(parsedValue.mainActivities),
      mainActivityOther: parseString(parsedValue.mainActivityOther),
      workType: parseNullableString(parsedValue.workType),
      workTypeOther: parseString(parsedValue.workTypeOther),
      workDomain: parseNullableString(parsedValue.workDomain),
      workDomainOther: parseString(parsedValue.workDomainOther),
      driftAlarmEnabled: parsedValue.driftAlarmEnabled === true,
      extremeNudgeEnabled: parsedValue.extremeNudgeEnabled === true,
      openAtLoginEnabled: parsedValue.openAtLoginEnabled !== false,
      customEndpointDraft: parseCustomEndpointDraft(parsedValue.customEndpointDraft),
      savedAt,
    };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    if (error instanceof Error) return null;
    return null;
  }
}

function savedAtIsFresh(savedAt: string, now: Date): boolean {
  const savedAtMs = Date.parse(savedAt);
  if (!Number.isFinite(savedAtMs)) return false;
  return now.getTime() - savedAtMs <= ONBOARDING_PROGRESS_TTL_MS;
}

function parseOnboardingStep(value: unknown): OnboardingStep | null {
  switch (value) {
    case "welcome":
    case "choose_setup":
    case "account":
    case "job":
    case "permissions":
    case "nudges":
    case "ready":
    case "connect_server":
    case "test_connection":
    case "self_data_review":
      return value;
    default:
      return null;
  }
}

function parseSetupChoice(value: unknown): SetupChoice | null {
  switch (value) {
    case "simple":
    case "local_ai":
    case "byok":
    case "custom_endpoint":
      return value;
    default:
      return null;
  }
}

function parseCustomEndpointDraft(value: unknown): CustomEndpointDraft {
  if (!isRecord(value)) return CUSTOM_ENDPOINT_DEFAULT_DRAFT;
  return {
    baseUrl: parseString(value.baseUrl) || CUSTOM_ENDPOINT_DEFAULT_DRAFT.baseUrl,
    model: parseString(value.model),
  };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function parseNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
