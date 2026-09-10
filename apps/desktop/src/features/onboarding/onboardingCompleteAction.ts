import { startupSettingsClient } from "../../lib/api/startupSettingsClient";
import { reportStartupRegistration } from "../../lib/analytics/startupEnvironment";
import { saveUserOnboardingState } from "./onboardingCompletion";
import type { SetupChoice } from "./onboardingFlow";
import type { UserOnboardingState } from "./onboardingState";
import { synchronizeLivingSoulDeclaredContextForUser } from "../classification/livingSoul";

type CompleteOnboardingInput = {
  readonly cloudTrialStartedNoticePresent: boolean;
  readonly displayName: string;
  readonly driftAlarmEnabled: boolean;
  readonly extremeNudgeEnabled: boolean;
  readonly petModeEnabled: boolean;
  readonly browserHistoryBootstrapEnabled: boolean;
  readonly jobType: string | null;
  readonly jobTypeOther: string;
  readonly mainActivities: readonly string[];
  readonly mainActivityOther: string;
  readonly onAcknowledgeCloudTrialStartedNotice: () => void;
  readonly onCommitted: (state: UserOnboardingState) => void;
  readonly onComplete: (state: UserOnboardingState) => void;
  readonly onStartTracking: () => Promise<void>;
  readonly openAtLoginEnabled: boolean;
  readonly setSetupError: (error: string | null) => void;
  readonly setStorageError: (error: string | null) => void;
  readonly setupChoice: SetupChoice | null;
  readonly userId: string;
  readonly workDescription: string;
  readonly workType: string | null;
  readonly workTypeOther: string;
};

export async function completeOnboardingAction({
  cloudTrialStartedNoticePresent,
  displayName,
  driftAlarmEnabled,
  extremeNudgeEnabled,
  petModeEnabled,
  browserHistoryBootstrapEnabled,
  jobType,
  jobTypeOther,
  mainActivities,
  mainActivityOther,
  onAcknowledgeCloudTrialStartedNotice,
  onCommitted,
  onComplete,
  onStartTracking,
  openAtLoginEnabled,
  setSetupError,
  setStorageError,
  setupChoice,
  userId,
  workDescription,
  workType,
  workTypeOther,
}: CompleteOnboardingInput): Promise<void> {
  setStorageError(null);
  setSetupError(null);
  if (startupSettingsClient.isAvailable()) {
    try {
      const startupResult = await startupSettingsClient.setOpenAtLoginEnabled(openAtLoginEnabled);
      reportStartupRegistration({
        phase: "onboarding",
        requestedEnabled: openAtLoginEnabled,
        outcome: startupResult,
      });
      console.debug("Start at login update completed during onboarding.", {
        requested: openAtLoginEnabled,
        ...startupResult,
      });
    } catch (error) {
      reportStartupRegistration({
        phase: "onboarding",
        requestedEnabled: openAtLoginEnabled,
        outcome: null,
        failed: true,
      });
      console.debug("Start at login update failed during onboarding.", {
        requested: openAtLoginEnabled,
        error: error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
      });
      console.warn("Unable to update start at login during onboarding.", error);
    }
  }
  try {
    await onStartTracking();
  } catch (error) {
    setSetupError(error instanceof Error ? error.message : "Unable to start tracking.");
    return;
  }
  const result = saveUserOnboardingState({
    userId,
    displayName,
    workType: mainActivities[0] ?? workType,
    workTypeOther: mainActivities.includes("Other") ? mainActivityOther : workTypeOther,
    workDomain: null,
    workDomainOther: "",
    workDescription,
    jobType: mainActivities.length > 0 ? mainActivities.join(", ") : jobType,
    jobTypeOther: mainActivities.includes("Other") ? mainActivityOther : jobTypeOther,
    focusGoalHours: null,
    driftThresholdMinutes: null,
    driftAlarmEnabled,
    extremeNudgeEnabled,
    petModeEnabled,
    browserHistoryBootstrapEnabled,
  });
  if (!result.success) {
    setStorageError(result.error);
    return;
  }
  // Local persistence is the terminal completion boundary. Notify the caller
  // before presentation-only follow-up so an unexpected downstream exception
  // can never make the completed onboarding retryable.
  onCommitted(result.state);
  void synchronizeLivingSoulDeclaredContextForUser(userId, result.state).catch((error) => {
    console.warn("Unable to initialize Living Soul after onboarding.", error);
  });
  if (setupChoice === "simple" && cloudTrialStartedNoticePresent) {
    onAcknowledgeCloudTrialStartedNotice();
  }
  onComplete(result.state);
}
