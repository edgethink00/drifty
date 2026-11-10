import {
  useEffect,
  useLayoutEffect,
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
import { canStartCloudTrial } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import type { LocalAiSetupState } from "../settings/localAiSetup";
import { persistLocalAiSetup } from "../settings/useAiSetupController";
import { completeOnboardingAction } from "./onboardingCompleteAction";
import { prepareOnboardingAccess } from "./prepareOnboardingAccess";
import {
  getOnboardingSteps,
  isOnboardingEntryStep,
  onboardingSetupSteps,
  remapOnboardingStepForSetupChoice,
  type OnboardingStep,
  type SetupChoice,
} from "./onboardingFlow";
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
import { useAccessibilityPaneIsDeviceControl } from "../../lib/api/accessibilityPaneName";
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
  readonly onActivateCloudTrial?: () => Promise<BillingEntitlement>;
  readonly onRefreshBillingEntitlement?: () => Promise<BillingEntitlement | null>;
  readonly onEarlyTrackingStart: () => void;
  readonly onCheckAccessibility: () => Promise<boolean>;
  readonly onRequestAccessibility: () => Promise<boolean>;
  readonly localAiSetup: LocalAiSetupState;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly expectsPromotion: boolean;
  /** Cloud device removal, so a device-limited account can free a slot without leaving setup. */
  readonly cloudDeviceRevokingId?: string | null;
  readonly cloudDeviceActionError?: string | null;
  readonly onRevokeCloudDevice?: (deviceId: string) => Promise<void>;
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
  cloudDeviceRevokingId = null,
  cloudDeviceActionError = null,
  onRevokeCloudDevice,
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
  // Drifty Cloud unusable on the ready step: the AI the person picks instead (2026-11-10, B).
  const [readyAlternative, setReadyAlternative] = useState<"local_ai" | "byok">("local_ai");
  const { addMainActivity, mainActivities, mainActivityOther, setMainActivityOther, toggleMainActivity } = useMainActivities({
    mainActivities: restoredProgress?.mainActivities,
    mainActivityOther: restoredProgress?.mainActivityOther,
  });
  const [workType, setWorkType] = useState<string | null>(restoredProgress?.workType ?? null);
  const [workTypeOther, setWorkTypeOther] = useState(restoredProgress?.workTypeOther ?? "");
  const [workDescription, setWorkDescription] = useState(restoredProgress?.workDescription ?? "");
  const [jobType] = useState<string | null>(null);
  const [jobTypeOther] = useState("");
  const restoredExtremeNudgeEnabled = Boolean(restoredProgress?.driftAlarmEnabled && restoredProgress.extremeNudgeEnabled);
  const [driftAlarmEnabled, setDriftAlarmEnabled] = useState(restoredExtremeNudgeEnabled);
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(restoredExtremeNudgeEnabled);
  const [petModeEnabled, setPetModeEnabled] = useState(restoredProgress?.petModeEnabled ?? false);
  const [browserHistoryBootstrapEnabled, setBrowserHistoryBootstrapEnabled] = useState(true);
  const [openAtLoginEnabled, setOpenAtLoginEnabled] = useState(restoredProgress?.openAtLoginEnabled ?? true);
  const [accountSkippedForDev, setAccountSkippedForDev] = useState(false);
  const [step, setStep] = useState<OnboardingStep>(devInitialStep ?? restoredProgress?.step ?? (skipAccountStep ? "welcome" : "account"));
  // Signing in on the entry screen moves on by itself after the success state. An account that
  // was already connected when the screen opened (a restored session, or a resumed run) has
  // nothing to celebrate, so the screen offers Continue instead of leaving after a moment.
  const accountConnectedRef = useRef(accountConnected);
  accountConnectedRef.current = accountConnected;
  const [entryOpenedConnected, setEntryOpenedConnected] = useState(accountConnected);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const completionInFlightRef = useRef(false);
  const currentUserRef = useRef(userId);
  currentUserRef.current = userId;
  const latestAiSetupRef = useRef(localAiSetup);
  latestAiSetupRef.current = localAiSetup;
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
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
  const setupSteps = useMemo(() => onboardingSetupSteps(steps), [steps]);
  const setupStepIndex = setupSteps.findIndex((item) => item.id === step);
  const firstSetupStep = setupSteps[0]?.id ?? null;
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
  const accessibilityPaneIsDeviceControl = useAccessibilityPaneIsDeviceControl();
  const blockedHint = useMemo(() => blockedHintForStep({
    accessibilityPaneIsDeviceControl,
    accessibilityRecheckPending: permissions.accessibilityRecheckPending,
    canAdvance,
    connectionPhase: connection.connectionPhase,
    hasInstallableLocalModel: connection.managedLocalAi.loading || catalogInstallable,
    isCustomEndpointSetup: connection.isCustomEndpointSetup,
    isManagedProviderSetup: connection.isManagedProviderSetup,
    step,
  }, t), [
    accessibilityPaneIsDeviceControl,
    canAdvance,
    catalogInstallable,
    connection.connectionPhase,
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
    if (isOnboardingEntryStep(step)) setEntryOpenedConnected(accountConnectedRef.current);
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
    if (entryOpenedConnected) return;
    if (waitingForAccountAccess) return;
    const timeoutId = window.setTimeout(() => {
      if (firstSetupStep) setStep(firstSetupStep);
    }, ACCOUNT_CONNECTED_ADVANCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [accountConnected, entryOpenedConnected, firstSetupStep, step, waitingForAccountAccess]);

  const entryAwaitsContinue = isOnboardingEntryStep(step)
    && (step === "welcome" || (accountConnected && entryOpenedConnected && !waitingForAccountAccess));

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
    const completingUserId = userId;
    const assertCurrentAccount = () => {
      if (!mountedRef.current || currentUserRef.current !== completingUserId) throw new Error(t("onboarding.block.account"));
    };
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
        assertCurrentAccount,
        onStartTracking: async () => {
          assertCurrentAccount();
          const storageFailure = t("onboarding.error.aiSetupStorage");
          if (connection.setupChoice === "simple" && !persistLocalAiSetup(latestAiSetupRef.current)) {
            throw new Error(storageFailure);
          }
          await prepareOnboardingAccess({
            setupChoice: connection.setupChoice,
            entitlement: billingEntitlement,
            skipCloudAccessCheck: accountSkippedForDev || DEV_ONBOARDING_AUTH_BYPASS_ENABLED,
            assertCurrentAccount,
            startTracking: onStartTracking,
            ...(onActivateCloudTrial ? { activateCloudTrial: onActivateCloudTrial } : {}),
            ...(onRefreshBillingEntitlement ? { refreshEntitlement: onRefreshBillingEntitlement } : {}),
            unavailableMessage: t("billing.trialActivation.unavailable"),
            deviceLimitMessage: t(onRevokeCloudDevice ? "onboarding.ready.cloudDeviceLimitInline" : "onboarding.ready.cloudDeviceLimit"),
          });
          assertCurrentAccount();
          if (connection.setupChoice === "simple") {
            const nextSetup = { ...latestAiSetupRef.current, provider: "managed_local" as const, driftyRoute: "cloud" as const };
            const persisted = persistLocalAiSetup(nextSetup);
            onLocalAiSetupChange(nextSetup);
            if (!persisted) throw new Error(storageFailure);
          }
        },
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
      if (!committedState) {
        setSetupError(error instanceof Error ? error.message : t("billing.trialActivation.failed"));
        return;
      }
      console.error("Onboarding presentation failed after local completion was saved.", error);
    } finally {
      if (committedState) {
        clearOnboardingProgress(userId);
        capturePostHogEvent("onboarding_completed", {
          ...(connection.setupChoice ? { setup_choice: connection.setupChoice } : {}),
          accessibility_granted: permissions.accessibilityGranted,
          notifications_granted: permissions.notificationPermission === "granted",
          account_connected: accountConnected,
          // Setup no longer asks about drift alerts, Automatic close or the cat; the intro reports
          // those choices on its onboarding_intro event.
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
    // The entry screen is sign-in; once past it there is nothing to go back to.
    if (previousStep && !isOnboardingEntryStep(previousStep)) setStep(previousStep);
  }

  function continueFromEntry() {
    if (!entryAwaitsContinue || isCompleting || !firstSetupStep) return;
    setStep(firstSetupStep);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A Cloud device removal re-checks the entitlement right after it lands;
    // continuing in between would retry against the full device list.
    if (isFinalStep && connection.setupChoice === "simple" && (billingEntitlementLoading || cloudDeviceRevokingId !== null)) return;
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
    if (readyCloudBlocked) {
      continueWithReadyAlternative();
      return;
    }
    if (connection.setupChoice === "simple" && !accountSkippedForDev
      && (!billingEntitlement || billingEntitlementError) && onRefreshBillingEntitlement) {
      void onRefreshBillingEntitlement();
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

  // Drifty Cloud chosen on the ready step but not usable: no plan or trial, or
  // the access check failed. Instead of "You're ready" over an unavailable
  // notice, the step offers the other ways to classify (owner choice B,
  // 2026-11-10). A device limit keeps its own fix (free a device), and the
  // brief access check shows no error until its answer arrives.
  const localAlternativeUnsupported = isLocalModelUnsupported(connection.managedLocalAi.catalog, connection.managedLocalAi.loading);
  const readyCloudCheckFailed = !billingEntitlement || Boolean(billingEntitlementError);
  const readyCloudBlocked = step === "ready" && connection.setupChoice === "simple" && !accountSkippedForDev
    && !billingEntitlementLoading && cloudDeviceRevokingId === null
    && billingEntitlement?.lockedReason !== "device_limit_reached"
    && (readyCloudCheckFailed || (!billingEntitlement?.canUseApp && !canStartCloudTrial(billingEntitlement)));
  const readyAlternativeChoice = localAlternativeUnsupported ? "byok" : readyAlternative;
  function continueWithReadyAlternative() {
    handleSetupChoice(readyAlternativeChoice);
    setStep("connect_server");
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
    canAdvance: canAdvance && !(step === "ready" && connection.setupChoice === "simple" && (billingEntitlementLoading || cloudDeviceRevokingId !== null)),
    cloudTrialStartedNotice,
    billingEntitlement,
    billingEntitlementLoading,
    cloudDeviceRevokingId,
    cloudDeviceActionError,
    revokeCloudDevice: onRevokeCloudDevice
      ? async (deviceId: string) => {
        await onRevokeCloudDevice(deviceId);
        // The footer still names the limit from the last attempt; the inline
        // list now owns the state until Continue is pressed again.
        setSetupError(null);
      }
      : null,
    promotionActive,
    promotionEndsAt: promotionActive ? billingEntitlement?.trialEndsAt ?? null : null,
    expectsPromotion,
    driftAlarmEnabled,
    extremeNudgeEnabled,
    petModeEnabled,
    readyCloudBlocked,
    readyCloudCheckFailed: readyCloudBlocked && readyCloudCheckFailed,
    readyAlternative: readyAlternativeChoice,
    setReadyAlternative,
    localAlternativeUnsupported,
    refreshBillingEntitlement: onRefreshBillingEntitlement ?? null,
    footerLabel: readyCloudBlocked
      ? t(readyAlternativeChoice === "local_ai" ? "onboarding.ready.continueLocal" : "onboarding.ready.continueProvider")
      : step === "ready" && connection.setupChoice === "simple"
      ? billingEntitlementLoading ? t("billing.trialActivation.checking")
        : !accountSkippedForDev && (!billingEntitlement || billingEntitlementError)
        ? t("common.retry")
        : canStartCloudTrial(billingEntitlement) ? t("billing.trialActivation.start") : t("billing.trialActivation.continue")
      : footerLabel,
    isCompleting,
    goToPreviousStep,
    continueFromEntry,
    entryAwaitsContinue,
    returnToSetupChoice: () => { if (!isCompleting) { setSetupError(null); setStep("choose_setup"); } },
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
    setupStepIndex,
    setupSteps,
    storageError,
    title: readyCloudBlocked
      ? t(readyCloudCheckFailed ? "onboarding.title.cloudUncheckable" : "onboarding.title.cloudUnavailable")
      : title,
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
