import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import type { TrackerStatus } from "@drifty/domain";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import { DEV_ONBOARDING_AUTH_BYPASS_ENABLED, DEV_ONBOARDING_AUTH_SKIP_ENABLED } from "../../appFeatureSwitches";
import type { CloudTrialStartedNoticeModel } from "../billing/CloudTrialStartedNotice";
import type { LocalAiSetupState } from "../settings/localAiSetup";
import { completeOnboardingAction } from "./onboardingCompleteAction";
import { getOnboardingSteps, type OnboardingStep } from "./onboardingFlow";
import {
  blockedHintForStep,
  canAdvanceOnboarding,
  footerLabelForStep,
  titleForStep,
} from "./onboardingFlowSelectors";
import {
  clampOnboardingProgressStep,
  clearOnboardingProgress,
  readOnboardingProgress,
  writeOnboardingProgress,
} from "./onboardingProgress";
import type { UserOnboardingState } from "./onboardingState";
import { useMainActivities } from "./useMainActivities";
import { useOnboardingConnectionFlow } from "./useOnboardingConnectionFlow";
import { useOnboardingModalA11y } from "./useOnboardingModalA11y";
import { useOnboardingPermissions } from "./useOnboardingPermissions";
import { useSafariHistoryPermission } from "./useSafariHistoryPermission";
import { useLocalization } from "../localization/LocalizationContext";

// Long enough for the "Account connected" success state to register before moving on.
const ACCOUNT_CONNECTED_ADVANCE_MS = 1200;

type UseOnboardingFlowOptions = {
  readonly userId: string;
  readonly accountConnected: boolean;
  readonly initialDisplayName: string;
  readonly trackerStatus: TrackerStatus | null;
  readonly accessibilityGranted: boolean;
  readonly accessibilityRequired: boolean;
  readonly onStartTracking: () => Promise<void>;
  readonly onEarlyTrackingStart: () => void;
  readonly onCheckAccessibility: () => Promise<boolean>;
  readonly onRequestAccessibility: () => Promise<boolean>;
  readonly onEnableDriftAlerts: () => void;
  readonly localAiSetup: LocalAiSetupState;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  readonly onAcknowledgeCloudTrialStartedNotice: () => void;
  readonly onComplete: (state: UserOnboardingState) => void;
  readonly devInitialStep?: OnboardingStep;
};

export function useOnboardingFlow({
  userId,
  accountConnected,
  initialDisplayName,
  trackerStatus,
  accessibilityGranted: accessibilityGrantedFromApp,
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
  devInitialStep,
}: UseOnboardingFlowOptions) {
  const { t } = useLocalization();
  const progressEnabled = devInitialStep === undefined;
  const restoredProgress = useMemo(() => {
    if (!progressEnabled) return null;
    const savedProgress = readOnboardingProgress(userId);
    if (!savedProgress) return null;
    return clampOnboardingProgressStep(savedProgress, {
      accountConnected,
      skipAccountStep: DEV_ONBOARDING_AUTH_BYPASS_ENABLED,
    });
  }, [accountConnected, progressEnabled, userId]);
  const [displayName] = useState(initialDisplayName.trim());
  const { addMainActivity, mainActivities, mainActivityOther, setMainActivityOther, toggleMainActivity } = useMainActivities({
    mainActivities: restoredProgress?.mainActivities,
    mainActivityOther: restoredProgress?.mainActivityOther,
  });
  const [workType, setWorkType] = useState<string | null>(restoredProgress?.workType ?? null);
  const [workTypeOther, setWorkTypeOther] = useState(restoredProgress?.workTypeOther ?? "");
  const [workDescription, setWorkDescription] = useState(restoredProgress?.workDescription ?? "");
  const [jobType] = useState<string | null>(null);
  const [jobTypeOther] = useState("");
  const [driftAlarmEnabled, setDriftAlarmEnabled] = useState(restoredProgress?.driftAlarmEnabled ?? false);
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(restoredProgress?.extremeNudgeEnabled ?? false);
  const [browserHistoryBootstrapEnabled, setBrowserHistoryBootstrapEnabled] = useState(true);
  const [openAtLoginEnabled, setOpenAtLoginEnabled] = useState(restoredProgress?.openAtLoginEnabled ?? true);
  const [accountSkippedForDev, setAccountSkippedForDev] = useState(false);
  const [step, setStep] = useState<OnboardingStep>(devInitialStep ?? restoredProgress?.step ?? "welcome");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const { screenRef, stepBodyRef, titleRef } = useOnboardingModalA11y(step);
  const connection = useOnboardingConnectionFlow({
    initialCustomEndpointDraft: restoredProgress?.customEndpointDraft,
    initialSetupChoice: restoredProgress?.setupChoice,
    localAiSetup,
    onLocalAiSetupChange,
    step,
  });
  const permissions = useOnboardingPermissions({
    accessibilityGrantedFromApp,
    accessibilityRequired,
    onCheckAccessibility,
    onEarlyTrackingStart,
    onEnableDriftAlerts,
    onRequestAccessibility,
    setSetupError,
    step,
    trackerStatus,
  });
  const safariHistoryPermission = useSafariHistoryPermission(step);

  const steps = useMemo(() => getOnboardingSteps(connection.setupChoice, {
    skipAccountStep: DEV_ONBOARDING_AUTH_BYPASS_ENABLED,
  }), [connection.setupChoice]);
  const stepIndex = steps.findIndex((item) => item.id === step);
  const permissionSummaryLabel = permissions.accessibilityRequired && permissions.accessibilityGranted
    ? "Accessibility verified"
    : "Tracking readiness verified";
  const isFinalStep = stepIndex === steps.length - 1;
  const canAdvance = canAdvanceOnboarding({
    accessibilityReady: permissions.accessibilityReady,
    accessibilityRecheckPending: permissions.accessibilityRecheckPending,
    accountConnected: accountConnected || accountSkippedForDev,
    apiKeyIsValid: connection.apiKeyIsValid,
    connectionPhase: connection.connectionPhase,
    customEndpointIsValid: connection.customEndpointIsValid,
    isCustomEndpointSetup: connection.isCustomEndpointSetup,
    isManagedProviderSetup: connection.isManagedProviderSetup,
    managedLocalStarted: connection.managedLocalStarted,
    setupChoice: connection.setupChoice,
    step,
    workContextProvided: mainActivities.length > 0 || workDescription.trim().length > 0,
  });
  const blockedHint = useMemo(() => blockedHintForStep({
    accessibilityRecheckPending: permissions.accessibilityRecheckPending,
    canAdvance,
    connectionPhase: connection.connectionPhase,
    customEndpointBaseUrlIssue: connection.customEndpointBaseUrlIssue,
    customEndpointModelIssue: connection.customEndpointModelIssue,
    isCustomEndpointSetup: connection.isCustomEndpointSetup,
    isManagedProviderSetup: connection.isManagedProviderSetup,
    step,
  }, t), [
    canAdvance,
    connection.connectionPhase,
    connection.customEndpointBaseUrlIssue,
    connection.customEndpointModelIssue,
    connection.isCustomEndpointSetup,
    connection.isManagedProviderSetup,
    permissions.accessibilityRecheckPending,
    step,
    t,
  ]);
  const title = useMemo(() => titleForStep({
    accountConnected,
    connectionPhase: connection.connectionPhase,
    isByokSetup: connection.isByokSetup,
    isCustomEndpointSetup: connection.isCustomEndpointSetup,
    setupChoice: connection.setupChoice,
    step,
  }, t), [
    accountConnected,
    connection.connectionPhase,
    connection.isByokSetup,
    connection.isCustomEndpointSetup,
    connection.setupChoice,
    step,
    t,
  ]);
  const footerLabel = footerLabelForStep({
    isUserManagedProviderSetup: connection.isUserManagedProviderSetup,
    step,
  }, t);

  useEffect(() => {
    capturePostHogEvent("onboarding_step_viewed", { step });
  }, [step]);

  // Once the account is connected, hold on the visible success state briefly,
  // then advance on its own — the account step renders no Continue button.
  useEffect(() => {
    if (step !== "account" || !accountConnected) return;
    const timeoutId = window.setTimeout(() => {
      const nextStep = steps[stepIndex + 1]?.id;
      if (nextStep) setStep(nextStep);
    }, ACCOUNT_CONNECTED_ADVANCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [accountConnected, step, stepIndex, steps]);

  useEffect(() => {
    if (!progressEnabled) return;
    writeOnboardingProgress(userId, {
      step,
      setupChoice: connection.setupChoice,
      mainActivities,
      mainActivityOther,
      workType,
      workTypeOther,
      workDomain: null,
      workDomainOther: "",
      workDescription,
      driftAlarmEnabled,
      extremeNudgeEnabled,
      openAtLoginEnabled,
      customEndpointDraft: connection.customEndpointDraft,
    });
  }, [
    connection.customEndpointDraft,
    connection.setupChoice,
    driftAlarmEnabled,
    extremeNudgeEnabled,
    mainActivities,
    mainActivityOther,
    openAtLoginEnabled,
    progressEnabled,
    step,
    userId,
    workDescription,
    workType,
    workTypeOther,
  ]);

  async function completeOnboarding() {
    let didComplete = false;
    await completeOnboardingAction({
      cloudTrialStartedNoticePresent: Boolean(cloudTrialStartedNotice),
      displayName,
      driftAlarmEnabled,
      extremeNudgeEnabled,
      browserHistoryBootstrapEnabled,
      jobType,
      jobTypeOther,
      mainActivities,
      mainActivityOther,
      onAcknowledgeCloudTrialStartedNotice,
      onComplete: (state) => {
        didComplete = true;
        onComplete(state);
      },
      onStartTracking,
      openAtLoginEnabled,
      setSetupError,
      setStorageError,
      setupChoice: connection.setupChoice,
      userId,
      workDescription,
      workType,
      workTypeOther,
    });
    if (didComplete) {
      clearOnboardingProgress(userId);
      capturePostHogEvent("onboarding_completed", {
        ...(connection.setupChoice ? { setup_choice: connection.setupChoice } : {}),
        accessibility_granted: permissions.accessibilityGranted,
        notifications_granted: permissions.notificationPermission === "granted",
        account_connected: accountConnected,
      });
    }
  }

  function goToNextStep() {
    const nextStep = steps[stepIndex + 1]?.id;
    if (nextStep) setStep(nextStep);
  }

  function skipAccountForDev() {
    if (!DEV_ONBOARDING_AUTH_SKIP_ENABLED || step !== "account") return;
    setAccountSkippedForDev(true);
    setStorageError(null);
    setSetupError(null);
    goToNextStep();
  }

  function goToPreviousStep() {
    const previousStep = steps[stepIndex - 1]?.id;
    if (previousStep) setStep(previousStep);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isFinalStep) {
      setStorageError(null);
      setSetupError(null);
      if (!canAdvance) return;
      if (step === "connect_server" && connection.isUserManagedProviderSetup) {
        setStep("test_connection");
        return;
      }
      goToNextStep();
      return;
    }
    void completeOnboarding();
  }

  return {
    ...connection,
    ...permissions,
    safariHistoryPermission,
    accountConnected,
    accountSkippedForDev,
    addMainActivity,
    browserHistoryBootstrapEnabled,
    blockedHint,
    canAdvance,
    cloudTrialStartedNotice,
    driftAlarmEnabled,
    extremeNudgeEnabled,
    footerLabel,
    goToPreviousStep,
    handleSubmit,
    mainActivities,
    mainActivityOther,
    openAtLoginEnabled,
    permissionSummaryLabel,
    screenRef,
    setDriftAlarmEnabled,
    setBrowserHistoryBootstrapEnabled,
    setExtremeNudgeEnabled,
    setMainActivityOther,
    setOpenAtLoginEnabled,
    skipAccountForDev,
    setStep,
    setupError,
    step,
    stepBodyRef,
    stepIndex,
    steps,
    storageError,
    title,
    titleRef,
    toggleMainActivity,
    workDescription,
    workType,
    workTypeOther,
    setWorkDescription,
    setWorkType,
    setWorkTypeOther,
  };
}

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;
