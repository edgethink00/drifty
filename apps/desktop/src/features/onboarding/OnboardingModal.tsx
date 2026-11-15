import { useEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import type { TrackerStatus } from "@drifty/domain";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import type { OAuthCallbackStatus } from "../auth/AuthContext";
import type { CloudTrialStartedNoticeModel } from "../billing/CloudTrialStartedNotice";
import type { BillingEntitlement } from "../billing/billingService";
import type { LocalAiSetupState } from "../settings/localAiSetup";
import { OnboardingDesignCodeContent } from "./OnboardingDesignCodeContent";
import { useOnboardingFlow } from "./useOnboardingFlow";
import { readReadyReviewState, readyReviewBilling } from "./readyReviewState";
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

export function OnboardingModal(props: ComponentProps<typeof OnboardingSession>) {
  const review = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("cliPilot");
  const accountId = props.accountConnected ? props.userId : null;
  const scope = useRef({ accountId, epoch: 0 });
  if (scope.current.accountId !== accountId) {
    // Keep the first sign-in handoff, but never carry an authenticated user's
    // draft into another account (including a sign-out followed by sign-in).
    if (scope.current.accountId !== null) scope.current.epoch += 1;
    scope.current.accountId = accountId;
  }
  return <OnboardingSession key={scope.current.epoch} {...props} {...(review ? { __devInitialStep: "choose_setup" as const } : {})} />;
}

function OnboardingSession({
  userId,
  accountConnected,
  initialDisplayName,
  trackerStatus,
  accessibilityGranted,
  accessibilityRequired,
  onStartTracking,
  onActivateCloudTrial,
  onRefreshBillingEntitlement,
  onEarlyTrackingStart,
  onCheckAccessibility,
  onRequestAccessibility,
  localAiSetup,
  onLocalAiSetupChange,
  cloudTrialStartedNotice,
  billingEntitlement,
  billingEntitlementError,
  billingEntitlementLoading,
  expectsPromotion,
  cloudDeviceRevokingId,
  cloudDeviceActionError,
  onRevokeCloudDevice,
  authCallbackStatus,
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithWebsite,
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
  onActivateCloudTrial?: () => Promise<BillingEntitlement>;
  onRefreshBillingEntitlement?: () => Promise<BillingEntitlement | null>;
  onEarlyTrackingStart: () => void;
  onCheckAccessibility: () => Promise<boolean>;
  onRequestAccessibility: () => Promise<boolean>;
  localAiSetup: LocalAiSetupState;
  onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  billingEntitlement: BillingEntitlement | null;
  billingEntitlementError: string | null;
  billingEntitlementLoading: boolean;
  expectsPromotion: boolean;
  cloudDeviceRevokingId?: string | null;
  cloudDeviceActionError?: string | null;
  onRevokeCloudDevice?: (deviceId: string) => Promise<void>;
  authCallbackStatus: OAuthCallbackStatus | null;
  onStartCloudTrialWithGoogle: () => void;
  onStartCloudTrialWithWebsite?: () => void;
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

  const readyReview = useMemo(readReadyReviewState, []);
  const [readyReached, setReadyReached] = useState(false);
  const reviewBilling = readyReview ? readyReviewBilling(readyReview, readyReached, { billingEntitlement, billingEntitlementError, billingEntitlementLoading }) : null;
  const flow = useOnboardingFlow({
    userId,
    accountConnected,
    initialDisplayName,
    trackerStatus,
    accessibilityGranted,
    accessibilityRequired,
    onStartTracking,
    ...(onActivateCloudTrial ? { onActivateCloudTrial } : {}),
    ...(onRefreshBillingEntitlement ? { onRefreshBillingEntitlement } : {}),
    onEarlyTrackingStart,
    onCheckAccessibility,
    onRequestAccessibility,
    localAiSetup,
    onLocalAiSetupChange,
    cloudTrialStartedNotice,
    billingEntitlement: reviewBilling ? reviewBilling.billingEntitlement : billingEntitlement,
    billingEntitlementError: reviewBilling ? reviewBilling.billingEntitlementError : billingEntitlementError,
    billingEntitlementLoading: reviewBilling ? reviewBilling.billingEntitlementLoading : billingEntitlementLoading,
    expectsPromotion,
    cloudDeviceRevokingId: cloudDeviceRevokingId ?? null,
    cloudDeviceActionError: cloudDeviceActionError ?? null,
    ...(onRevokeCloudDevice ? { onRevokeCloudDevice } : {}),
    onAcknowledgeCloudTrialStartedNotice,
    onComplete,
    devInitialStep: __devInitialStep,
  });
  useEffect(() => {
    if (readyReview && flow.step === "ready") setReadyReached(true);
  }, [readyReview, flow.step]);

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
          onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
          onStartCloudTrialWithWebsite={onStartCloudTrialWithWebsite}
          onDeleteAnonymousAccount={onDeleteAnonymousAccount}
        />
      </div>
    </section>
  );
}
