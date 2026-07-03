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
  browserHistoryBootstrapEnabled: boolean;
  focusGoalHours: number | null;
  driftThresholdMinutes: number | null;
  purpose: OnboardingPurpose | null;
  completedAt: string;
};

export type WorkProfileSettings = {
  workActivities: readonly string[];
  workActivityOther: string;
  workDomain: string | null;
  workDomainOther: string;
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
    const browserHistoryBootstrapEnabled =
      typeof record.browserHistoryBootstrapEnabled === "boolean" ? record.browserHistoryBootstrapEnabled : false;
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
      browserHistoryBootstrapEnabled,
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

  return saveUserWorkProfileSettings(userId, {
    workActivities: [normalizedWorkProfile],
    workActivityOther: "",
    workDomain: null,
    workDomainOther: "",
  });
}

export function readUserWorkProfileSettings(userId: string): WorkProfileSettings {
  const currentState = readUserOnboardingState(userId);
  const workActivities = readWorkActivitiesFromState(currentState);
  return {
    workActivities,
    workActivityOther: currentState?.jobTypeOther || currentState?.workTypeOther || "",
    workDomain: currentState?.workDomain ?? null,
    workDomainOther: currentState?.workDomainOther ?? "",
  };
}

export function saveUserWorkProfileSettings(
  userId: string,
  workProfile: WorkProfileSettings,
): UserOnboardingState | null {
  const nextWorkProfile = normalizeWorkProfileSettings(workProfile);
  if (!summarizeWorkProfileSettings(nextWorkProfile)) return null;

  const currentState = readUserOnboardingState(userId);
  const nextState: UserOnboardingState = {
    version: ONBOARDING_STORAGE_VERSION,
    completed: true,
    displayName: currentState?.displayName ?? "",
    workType: nextWorkProfile.workActivities[0] ?? null,
    workTypeOther: nextWorkProfile.workActivities.includes("Other") ? nextWorkProfile.workActivityOther : "",
    workDomain: nextWorkProfile.workDomain,
    workDomainOther: nextWorkProfile.workDomainOther,
    jobType: summarizeWorkActivities(nextWorkProfile) || null,
    jobTypeOther: nextWorkProfile.workActivities.includes("Other") ? nextWorkProfile.workActivityOther : "",
    driftAlarmEnabled: currentState?.driftAlarmEnabled ?? false,
    extremeNudgeEnabled: currentState?.extremeNudgeEnabled ?? false,
    browserHistoryBootstrapEnabled: currentState?.browserHistoryBootstrapEnabled ?? false,
    focusGoalHours: currentState?.focusGoalHours ?? null,
    driftThresholdMinutes: currentState?.driftThresholdMinutes ?? null,
    purpose: currentState?.purpose ?? null,
    completedAt: currentState?.completedAt ?? new Date().toISOString(),
  };
  writeOnboardingStateToStorageKey(getUserOnboardingStorageKey(userId), nextState);
  return nextState;
}

export function summarizeUserWorkProfile(userId: string): string {
  return summarizeWorkProfileSettings(readUserWorkProfileSettings(userId));
}

export function summarizeWorkProfileSettings(workProfile: WorkProfileSettings): string {
  const workType = summarizeWorkActivities(workProfile);
  const workDomain = normalizeWorkProfileSetting(
    workProfile.workDomain === "Other" ? workProfile.workDomainOther : workProfile.workDomain,
  );
  if (workType && workDomain) return `${workType} in ${workDomain}`;
  return workType ?? workDomain ?? "";
}

function normalizeWorkProfileSettings(workProfile: WorkProfileSettings): WorkProfileSettings {
  const workActivities = Array.from(new Set(workProfile.workActivities))
    .map((activity) => normalizeWorkProfileSetting(activity))
    .filter((activity): activity is string => Boolean(activity))
    .slice(0, 5);
  const workDomain = normalizeWorkProfileSetting(workProfile.workDomain);
  return {
    workActivities,
    workActivityOther: workActivities.includes("Other")
      ? normalizeWorkProfileSetting(workProfile.workActivityOther) ?? ""
      : "",
    workDomain,
    workDomainOther: workDomain === "Other" ? normalizeWorkProfileSetting(workProfile.workDomainOther) ?? "" : "",
  };
}

function summarizeWorkActivities(workProfile: WorkProfileSettings): string | null {
  const activities = workProfile.workActivities
    .map((activity) => {
      const normalizedActivity = normalizeWorkProfileSetting(activity);
      if (normalizedActivity !== "Other") return normalizedActivity;
      const normalizedOther = normalizeWorkProfileSetting(workProfile.workActivityOther);
      return normalizedOther ? `Other: ${normalizedOther}` : null;
    })
    .filter((activity): activity is string => Boolean(activity));
  return activities.length > 0 ? activities.join(", ") : null;
}

function readWorkActivitiesFromState(state: UserOnboardingState | null): readonly string[] {
  if (!state) return [];
  const jobTypeActivities = splitWorkActivities(state.jobType);
  if (jobTypeActivities.length > 1) return jobTypeActivities;
  if (jobTypeActivities.length === 1 && !jobTypeActivities[0]?.includes(" in ")) return jobTypeActivities;
  const workType = normalizeWorkProfileSetting(state.workType);
  return workType ? [workType] : [];
}

function splitWorkActivities(value: string | null | undefined): readonly string[] {
  const normalized = normalizeWorkProfileSetting(value);
  if (!normalized) return [];
  return normalized
    .split(",")
    .map((activity) => normalizeWorkProfileSetting(activity))
    .filter((activity): activity is string => Boolean(activity))
    .slice(0, 5);
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
