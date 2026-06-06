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

function getLegacyStorageKeys(userId: string): string[] {
  return [
    `drifty:onboarding:v1:${userId}`,
    `dtime:onboarding:v1:${userId}`,
  ];
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
      focusGoalHours,
      driftThresholdMinutes,
      purpose,
      completedAt: record.completedAt,
    };
  } catch {
    return null;
  }
}

export function readUserOnboardingState(userId: string): UserOnboardingState | null {
  const storageKey = getUserOnboardingStorageKey(userId);

  let state: UserOnboardingState | null = null;
  try {
    state = parseUserOnboardingState(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
  if (state) return state;

  for (const legacyKey of getLegacyStorageKeys(userId)) {
    let migrated: UserOnboardingState | null = null;
    try {
      migrated = parseUserOnboardingState(window.localStorage.getItem(legacyKey));
    } catch {
      return null;
    }
    if (migrated) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(migrated));
      } catch {
        // best effort migration; fall through and return the parsed value
      }
      return migrated;
    }
  }

  return null;
}

export { ONBOARDING_STORAGE_VERSION };
