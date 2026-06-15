const ONBOARDING_STORAGE_VERSION = 2;

export type OnboardingPurpose =
  | "protect_focus"
  | "understand_day"
  | "plan_review"
  | "accountability"
  | "exploring";

export type UserOnboardingState = {
  version: typeof ONBOARDING_STORAGE_VERSION;
  completed: true;
  displayName: string;
  workType: string | null;
  workTypeOther: string;
  workDomain: string | null;
  workDomainOther: string;
  jobType: string | null;
  jobTypeOther: string;
  driftAlarmEnabled: boolean;
  extremeNudgeEnabled: boolean;
  focusGoalHours: number | null;
  driftThresholdMinutes: number | null;
  purpose: OnboardingPurpose | null;
  completedAt: string;
};

const VALID_PURPOSES: ReadonlySet<string> = new Set<OnboardingPurpose>([
  "protect_focus",
  "understand_day",
  "plan_review",
  "accountability",
  "exploring",
]);

function isOnboardingPurpose(value: unknown): value is OnboardingPurpose {
  return typeof value === "string" && VALID_PURPOSES.has(value);
}

export function getUserOnboardingStorageKey(userId: string): string {
  return `drifty:onboarding:v${ONBOARDING_STORAGE_VERSION}:${userId}`;
}

function readOnboardingStateFromStorageKey(storageKey: string): UserOnboardingState | null {
  try {
    return parseUserOnboardingState(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function writeOnboardingStateToStorageKey(storageKey: string, state: UserOnboardingState): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    return;
  }
}

function parseUserOnboardingState(rawValue: string | null): UserOnboardingState | null {
  if (!rawValue) return null;
  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object") return null;
    const record = parsedValue as Record<string, unknown>;
    if (record.completed !== true || typeof record.completedAt !== "string") return null;
    if (record.version !== 1 && record.version !== 2) return null;

    const displayName = typeof record.displayName === "string" ? record.displayName : "";
    const purpose = isOnboardingPurpose(record.purpose) ? record.purpose : null;
    const workType = typeof record.workType === "string" ? record.workType : null;
    const workTypeOther = typeof record.workTypeOther === "string" ? record.workTypeOther : "";
    const workDomain = typeof record.workDomain === "string" ? record.workDomain : null;
    const workDomainOther = typeof record.workDomainOther === "string" ? record.workDomainOther : "";
    const jobType = typeof record.jobType === "string" ? record.jobType : null;
    const jobTypeOther = typeof record.jobTypeOther === "string" ? record.jobTypeOther : "";
    const driftAlarmEnabled = typeof record.driftAlarmEnabled === "boolean" ? record.driftAlarmEnabled : false;
    const extremeNudgeEnabled = typeof record.extremeNudgeEnabled === "boolean" ? record.extremeNudgeEnabled : false;
    const focusGoalHours = typeof record.focusGoalHours === "number" ? record.focusGoalHours : null;
    const driftThresholdMinutes =
      typeof record.driftThresholdMinutes === "number" ? record.driftThresholdMinutes : null;

    return {
      version: ONBOARDING_STORAGE_VERSION,
      completed: true,
      displayName,
      workType,
      workTypeOther,
      workDomain,
      workDomainOther,
      jobType,
      jobTypeOther,
      driftAlarmEnabled,
      extremeNudgeEnabled,
      focusGoalHours,
      driftThresholdMinutes,
      purpose,
      completedAt: record.completedAt,
    };
  } catch {
    return null;
  }
}

export function readUserOnboardingState(userId: string, fallbackUserIds: readonly string[] = []): UserOnboardingState | null {
  const storageKey = getUserOnboardingStorageKey(userId);

  const state = readOnboardingStateFromStorageKey(storageKey);
  if (state) return state;

  const previousDriftyKey = `drifty:onboarding:v1:${userId}`;
  const migrated = readOnboardingStateFromStorageKey(previousDriftyKey);
  if (migrated) {
    writeOnboardingStateToStorageKey(storageKey, migrated);
    return migrated;
  }

  for (const fallbackUserId of fallbackUserIds) {
    if (fallbackUserId === userId) continue;
    const fallbackState = readUserOnboardingState(fallbackUserId);
    if (!fallbackState) continue;
    writeOnboardingStateToStorageKey(storageKey, fallbackState);
    return fallbackState;
  }

  return null;
}

export function saveUserWorkProfile(userId: string, workProfile: string): UserOnboardingState | null {
  const normalizedWorkProfile = normalizeWorkProfileSetting(workProfile);
  if (!normalizedWorkProfile) return null;

  const currentState = readUserOnboardingState(userId);
  const nextState: UserOnboardingState = {
    version: ONBOARDING_STORAGE_VERSION,
    completed: true,
    displayName: currentState?.displayName ?? "",
    workType: normalizedWorkProfile,
    workTypeOther: "",
    workDomain: null,
    workDomainOther: "",
    jobType: normalizedWorkProfile,
    jobTypeOther: "",
    driftAlarmEnabled: currentState?.driftAlarmEnabled ?? false,
    extremeNudgeEnabled: currentState?.extremeNudgeEnabled ?? false,
    focusGoalHours: currentState?.focusGoalHours ?? null,
    driftThresholdMinutes: currentState?.driftThresholdMinutes ?? null,
    purpose: currentState?.purpose ?? null,
    completedAt: currentState?.completedAt ?? new Date().toISOString(),
  };
  writeOnboardingStateToStorageKey(getUserOnboardingStorageKey(userId), nextState);
  return nextState;
}

export function summarizeUserWorkProfile(userId: string): string {
  const state = readUserOnboardingState(userId);
  if (!state) return "";
  const workType = normalizeWorkProfileSetting(state.workType === "Other" ? state.workTypeOther : state.workType);
  const workDomain = normalizeWorkProfileSetting(state.workDomain === "Other" ? state.workDomainOther : state.workDomain);
  if (workType && workDomain) return `${workType} in ${workDomain}`;
  return workType ?? workDomain ?? "";
}

function normalizeWorkProfileSetting(value: string | null | undefined): string | null {
  const normalized = value
    ?.replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, 180).trim() || null;
}

export { ONBOARDING_STORAGE_VERSION };
