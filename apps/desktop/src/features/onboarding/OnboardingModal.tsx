import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { TrackerStatus } from "@drifty/domain";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import type { OAuthCallbackStatus } from "../auth/AuthContext";
import type { CloudTrialStartedNoticeModel } from "../billing/CloudTrialStartedNotice";
import type { LocalAiSetupState } from "../settings/localAiSetup";
import { OnboardingDesignCodeContent } from "./OnboardingDesignCodeContent";
import { useOnboardingFlow } from "./useOnboardingFlow";
import type { OnboardingStep } from "./onboardingFlow";
import "./onboarding.css";

export {
  getUserOnboardingStorageKey,
  ONBOARDING_STORAGE_VERSION,
  readUserOnboardingState,
  type OnboardingPurpose,
  type UserOnboardingState,
} from "./onboardingState";
export { hasCompletedUserOnboarding, saveUserOnboardingState } from "./onboardingCompletion";
export type { OnboardingStep as OnboardingStepId } from "./onboardingFlow";

export function OnboardingModal({
  userId,
  accountConnected,
  initialDisplayName,
  trackerStatus,
  accessibilityGranted,
  accessibilityRequired,
  onStartTracking,
  onEarlyTrackingStart,
  onCheckAccessibility,
  onRequestAccessibility,
  onEnableDriftAlerts,
  localAiSetup,
  onLocalAiSetupChange,
  cloudTrialStartedNotice,
  authCallbackStatus,
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithEmail,
  onDeleteAnonymousAccount,
  onAcknowledgeCloudTrialStartedNotice,
  onComplete,
  __devInitialStep,
}: {
  userId: string;
  accountConnected: boolean;
  initialDisplayName: string;
  trackerStatus: TrackerStatus | null;
  accessibilityGranted: boolean;
  accessibilityRequired: boolean;
  onStartTracking: () => Promise<void>;
  onEarlyTrackingStart: () => void;
  onCheckAccessibility: () => Promise<boolean>;
  onRequestAccessibility: () => Promise<boolean>;
  onEnableDriftAlerts: () => void;
  localAiSetup: LocalAiSetupState;
  onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  authCallbackStatus: OAuthCallbackStatus | null;
  onStartCloudTrialWithGoogle: () => void;
  onStartCloudTrialWithEmail: () => void;
  onDeleteAnonymousAccount?: () => void;
  onAcknowledgeCloudTrialStartedNotice: () => void;
  onComplete: Parameters<typeof useOnboardingFlow>[0]["onComplete"];
  /** Dev-only: start on a specific step for visual review / Playwright. */
  __devInitialStep?: OnboardingStep;
}) {
  useEffect(() => {
    capturePostHogEvent("onboarding_opened", {
      source: __devInitialStep ? "manual" : "first_run",
    });
  }, [__devInitialStep]);

  const flow = useOnboardingFlow({
    userId,
    accountConnected,
    initialDisplayName,
    trackerStatus,
    accessibilityGranted,
    accessibilityRequired,
    onStartTracking,
    onEarlyTrackingStart,
    onCheckAccessibility,
    onRequestAccessibility,
    onEnableDriftAlerts,
    localAiSetup,
    onLocalAiSetupChange,
    cloudTrialStartedNotice,
    onAcknowledgeCloudTrialStartedNotice,
    onComplete,
    devInitialStep: __devInitialStep,
  });

  return (
    <section
      ref={flow.screenRef}
      className="onboarding-screen dc-onboarding-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-window-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className="onboarding-content-area">
        <OnboardingDesignCodeContent
          flow={flow}
          authCallbackStatus={authCallbackStatus}
          onStartCloudTrialWithEmail={onStartCloudTrialWithEmail}
          onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
          onDeleteAnonymousAccount={onDeleteAnonymousAccount}
        />
      </div>
    </section>
  );
}
