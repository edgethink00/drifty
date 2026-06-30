import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { TrackerStatus } from "@drifty/domain";
import { capturePostHogEvent } from "../../lib/analytics/posthog";
import type { CloudTrialStartedNoticeModel } from "../billing/CloudTrialStartedNotice";
import type { LocalAiSetupState } from "../settings/localAiSetup";
import wordmarkUrl from "../../assets/drifty-wordmark.png";
import { OnboardingStepContent } from "./OnboardingStepContent";
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
  onRefreshTracker,
  onStartTracking,
  onCheckAccessibility,
  onRequestAccessibility,
  onEnableDriftAlerts,
  onLocalAiSetupChange,
  cloudTrialStartedNotice,
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithEmail,
  onAcknowledgeCloudTrialStartedNotice,
  onComplete,
  __devInitialStep,
}: {
  userId: string;
  accountConnected: boolean;
  initialDisplayName: string;
  trackerStatus: TrackerStatus | null;
  accessibilityGranted: boolean;
  onRefreshTracker: () => Promise<void>;
  onStartTracking: () => Promise<void>;
  onCheckAccessibility: () => Promise<boolean>;
  onRequestAccessibility: () => Promise<boolean>;
  onEnableDriftAlerts: () => void;
  onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  onStartCloudTrialWithGoogle: () => void;
  onStartCloudTrialWithEmail: () => void;
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
    onRefreshTracker,
    onStartTracking,
    onCheckAccessibility,
    onRequestAccessibility,
    onEnableDriftAlerts,
    onLocalAiSetupChange,
    cloudTrialStartedNotice,
    onAcknowledgeCloudTrialStartedNotice,
    onComplete,
    devInitialStep: __devInitialStep,
  });

  return (
    <section
      ref={flow.screenRef}
      className="onboarding-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-window-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className="onboarding-topbar" data-tauri-drag-region>
        <img className="onboarding-logo onboarding-logo--image" src={wordmarkUrl} alt="drifty" data-tauri-drag-region />
      </div>

      <div className="onboarding-content-area">
        <form className="onboarding-card" onSubmit={flow.handleSubmit}>
          <div className="onboarding-copy-column">
            <div className={`onboarding-middle onboarding-middle--${flow.step}`}>
              <h1
                className={`onboarding-title${flow.titleIsVisible ? "" : " onb-visually-hidden"}${flow.step === "job" ? " onb-title--job" : ""}`}
                id="onboarding-title"
                ref={flow.titleRef}
                tabIndex={-1}
              >
                {flow.title}
              </h1>
              {flow.subtitle ? <p className="onb-step-desc onboarding-subtitle">{flow.subtitle}</p> : null}

              <div className={`onboarding-body onboarding-body--${flow.step}`}>
                <div className="onboarding-viewport">
                  <div className="onboarding-step" key={flow.step} ref={flow.stepBodyRef}>
                    <OnboardingStepContent
                      flow={flow}
                      onStartCloudTrialWithEmail={onStartCloudTrialWithEmail}
                      onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
                    />

                    {flow.storageError ? (
                      <p className="onb-error" role="alert">
                        {flow.storageError}
                      </p>
                    ) : null}
                    {flow.setupError ? (
                      <p className="onb-error" role="alert">
                        {flow.setupError}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="onb-actions">
              {flow.stepIndex > 0 ? (
                <button type="button" className="onb-actions__back" onClick={flow.goToPreviousStep}>
                  Back
                </button>
              ) : (
                <span className="onb-actions__spacer" />
              )}
              {flow.step !== "account" ? (
                <div className="onb-actions__dots" aria-hidden="true">
                  {flow.steps.map((stepDef, index) => (
                    <span
                      key={stepDef.id}
                      className={`onb-actions__dot${index === flow.stepIndex ? " onb-actions__dot--active" : ""}`}
                    />
                  ))}
                </div>
              ) : null}
              {flow.blockedHint ? (
                <p className="onb-hint" role="status">
                  {flow.blockedHint}
                </p>
              ) : null}
              <button type="submit" className="onb-button onb-button--primary" disabled={!flow.canAdvance}>
                {flow.footerLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
