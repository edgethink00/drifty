import {
  getUserOnboardingStorageKey,
  ONBOARDING_STORAGE_VERSION,
  readUserOnboardingState,
  type UserOnboardingState,
} from "./onboardingState";

const ONBOARDING_STORAGE_ERROR_MESSAGE = "Unable to save setup locally. Check storage permissions and try again.";

type SaveUserOnboardingStateResult =
  | { success: true; state: UserOnboardingState }
  | { success: false; error: string };

export function hasCompletedUserOnboarding(userId: string, fallbackUserIds: readonly string[] = []): boolean {
  return readUserOnboardingState(userId, fallbackUserIds)?.completed === true;
}

export function saveUserOnboardingState({
  userId,
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
}: {
  userId: string;
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
}): SaveUserOnboardingStateResult {
  const state: UserOnboardingState = {
    version: ONBOARDING_STORAGE_VERSION,
    completed: true,
    displayName: displayName.trim(),
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
    purpose: null,
    completedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(getUserOnboardingStorageKey(userId), JSON.stringify(state));
  } catch {
    return { success: false, error: ONBOARDING_STORAGE_ERROR_MESSAGE };
  }

  return { success: true, state };
}
