import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import type { TrackerStatus } from "@drifty/domain";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import { DEV_ONBOARDING_AUTH_BYPASS_ENABLED, DEV_ONBOARDING_AUTH_SKIP_ENABLED } from "../../appFeatureSwitches";
import type { CloudTrialStartedNoticeModel } from "../billing/CloudTrialStartedNotice";
import type { BillingEntitlement } from "../billing/billingService";
import type { LocalAiSetupState } from "../settings/localAiSetup";
import { completeOnboardingAction } from "./onboardingCompleteAction";
import { getOnboardingSteps, remapOnboardingStepForSetupChoice, type OnboardingStep, type SetupChoice } from "./onboardingFlow";
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
import { hasInstallableLocalModel, isLocalModelUnsupported, shouldClearUnsupportedLocalChoice } from "./localModelSetupAnalytics";
import { useMainActivities } from "./useMainActivities";
import { useOnboardingConnectionFlow } from "./useOnboardingConnectionFlow";
import { useOnboardingModalA11y } from "./useOnboardingModalA11y";
import { useOnboardingPermissions } from "./useOnboardingPermissions";
import { useSafariHistoryPermission } from "./useSafariHistoryPermission";
import { useLocalization } from "../localization/LocalizationContext";
import { resolveOnboardingAccountAccessState } from "./accountAccessState";

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
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly expectsPromotion: boolean;
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
  billingEntitlement,
  billingEntitlementError,
  billingEntitlementLoading,
  expectsPromotion,
  onAcknowledgeCloudTrialStartedNotice,
  onComplete,
  devInitialStep,
}: UseOnboardingFlowOptions) {
  const { t } = useLocalization();
  const promotionActive = billingEntitlement?.accessSource === "promotion"
    && billingEntitlement.status === "trialing"
    && billingEntitlement.canUseApp;
  const accountAccessState = resolveOnboardingAccountAccessState({
    accountConnected,
    billingAccessSource: billingEntitlement?.accessSource,
    billingEntitlementError,
    billingEntitlementLoading,
    entitlementResolved: billingEntitlement !== null,
    expectsPromotion,
    promotionActive,
  });
  const waitingForAccountAccess = accountAccessState === "checking"
    || accountAccessState === "promotion-mismatch"
    || (!expectsPromotion && accountConnected && billingEntitlementLoading);
  const skipAccountStep = DEV_ONBOARDING_AUTH_BYPASS_ENABLED || (promotionActive && accountConnected);
  const progressEnabled = devInitialStep === undefined;
  const restoredProgress = useMemo(() => {
    if (!progressEnabled) return null;
    const savedProgress = readOnboardingProgress(userId);
    if (!savedProgress) return null;
    return clampOnboardingProgressStep(savedProgress, {
      accountConnected,
      skipAccountStep,
    });
  }, [accountConnected, progressEnabled, skipAccountStep, userId]);
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
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(
    Boolean(restoredProgress?.driftAlarmEnabled && restoredProgress.extremeNudgeEnabled),
  );
  const [petModeEnabled, setPetModeEnabled] = useState(restoredProgress?.petModeEnabled ?? false);
  const [browserHistoryBootstrapEnabled, setBrowserHistoryBootstrapEnabled] = useState(true);
  const [openAtLoginEnabled, setOpenAtLoginEnabled] = useState(restoredProgress?.openAtLoginEnabled ?? true);
  const [accountSkippedForDev, setAccountSkippedForDev] = useState(false);
  const [step, setStep] = useState<OnboardingStep>(devInitialStep ?? restoredProgress?.step ?? "welcome");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const completionInFlightRef = useRef(false);
  const [isCompleting, setIsCompleting] = useState(false);

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
    skipAccountStep,
  }), [connection.setupChoice, skipAccountStep]);
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
  const catalogInstallable = hasInstallableLocalModel(connection.managedLocalAi.catalog);
  const blockedHint = useMemo(() => blockedHintForStep({
    accessibilityRecheckPending: permissions.accessibilityRecheckPending,
    canAdvance,
    connectionPhase: connection.connectionPhase,
    customEndpointBaseUrlIssue: connection.customEndpointBaseUrlIssue,
    customEndpointModelIssue: connection.customEndpointModelIssue,
    hasInstallableLocalModel: connection.managedLocalAi.loading || catalogInstallable,
    isCustomEndpointSetup: connection.isCustomEndpointSetup,
    isManagedProviderSetup: connection.isManagedProviderSetup,
    step,
  }, t), [
    canAdvance,
    catalogInstallable,
    connection.connectionPhase,
    connection.customEndpointBaseUrlIssue,
    connection.customEndpointModelIssue,
    connection.isCustomEndpointSetup,
    connection.isManagedProviderSetup,
    connection.managedLocalAi.loading,
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

  useEffect(() => {
    if (!shouldClearUnsupportedLocalChoice(
      step,
      connection.setupChoice,
      connection.managedLocalAi.catalog,
      connection.managedLocalAi.loading,
    )) return;
    connection.handleSetupChoice("simple");
  }, [
    connection.handleSetupChoice,
    connection.managedLocalAi.catalog,
    connection.managedLocalAi.loading,
    connection.setupChoice,
    step,
  ]);

  // Hold for active verification and a confirmed account mismatch. A transport
  // failure is deferred so setup can continue while Pro access remains gated.
  useEffect(() => {
    if (step !== "account" || !accountConnected) return;
    if (waitingForAccountAccess) return;
    const timeoutId = window.setTimeout(() => {
      const nextStep = skipAccountStep ? "job" : steps[stepIndex + 1]?.id;
      if (nextStep) setStep(nextStep);
    }, ACCOUNT_CONNECTED_ADVANCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [accountConnected, skipAccountStep, step, stepIndex, steps, waitingForAccountAccess]);

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
      petModeEnabled,
      openAtLoginEnabled,
      customEndpointDraft: connection.customEndpointDraft,
    });
  }, [
    connection.customEndpointDraft,
    connection.setupChoice,
    driftAlarmEnabled,
    extremeNudgeEnabled,
    petModeEnabled,
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
    if (completionInFlightRef.current) return;

    completionInFlightRef.current = true;
    setIsCompleting(true);
    let committedState: UserOnboardingState | null = null;
    try {
      await completeOnboardingAction({
        cloudTrialStartedNoticePresent: Boolean(cloudTrialStartedNotice),
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
        onCommitted: (state) => {
          committedState = state;
        },
        onComplete,
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
    } catch (error) {
      if (!committedState) throw error;
      console.error("Onboarding presentation failed after local completion was saved.", error);
    } finally {
      if (committedState) {
        clearOnboardingProgress(userId);
        capturePostHogEvent("onboarding_completed", {
          ...(connection.setupChoice ? { setup_choice: connection.setupChoice } : {}),
          accessibility_granted: permissions.accessibilityGranted,
          notifications_granted: permissions.notificationPermission === "granted",
          account_connected: accountConnected,
          drift_alarm_enabled: driftAlarmEnabled,
          extreme_nudge_enabled: extremeNudgeEnabled,
          pet_enabled: petModeEnabled,
        });
      } else {
        completionInFlightRef.current = false;
        setIsCompleting(false);
      }
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

  function handleSetupChoice(nextChoice: SetupChoice) {
    if (nextChoice === "local_ai" && isLocalModelUnsupported(connection.managedLocalAi.catalog, connection.managedLocalAi.loading)) {
      return;
    }
    const nextStep = remapOnboardingStepForSetupChoice(
      step,
      connection.setupChoice,
      nextChoice,
      { skipAccountStep },
    );
    connection.handleSetupChoice(nextChoice);
    if (nextStep !== step) setStep(nextStep);
  }

  return {
    ...connection,
    handleSetupChoice,
    ...permissions,
    safariHistoryPermission,
    accountConnected,
    accountAccessState,
    accountSkippedForDev,
    addMainActivity,
    browserHistoryBootstrapEnabled,
    blockedHint,
    canAdvance,
    cloudTrialStartedNotice,
    promotionActive,
    promotionEndsAt: promotionActive ? billingEntitlement?.trialEndsAt ?? null : null,
    expectsPromotion,
    driftAlarmEnabled,
    extremeNudgeEnabled,
    petModeEnabled,
    footerLabel,
    isCompleting,
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
    setPetModeEnabled,
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
