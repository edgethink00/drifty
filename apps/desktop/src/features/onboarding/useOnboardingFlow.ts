import {
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import type { TrackerStatus } from "@drifty/domain";
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
import type { UserOnboardingState } from "./onboardingState";
import { useMainActivities } from "./useMainActivities";
import { useOnboardingConnectionFlow } from "./useOnboardingConnectionFlow";
import { useOnboardingModalA11y } from "./useOnboardingModalA11y";
import { useOnboardingPermissions } from "./useOnboardingPermissions";

type UseOnboardingFlowOptions = {
  readonly userId: string;
  readonly userEmail: string | null;
  readonly initialDisplayName: string;
  readonly trackerStatus: TrackerStatus | null;
  readonly accessibilityGranted: boolean;
  readonly onRefreshTracker: () => Promise<void>;
  readonly onStartTracking: () => Promise<void>;
  readonly onCheckAccessibility: () => Promise<boolean>;
  readonly onRequestAccessibility: () => Promise<boolean>;
  readonly onEnableDriftAlerts: () => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  readonly onAcknowledgeCloudTrialStartedNotice: () => void;
  readonly onComplete: (state: UserOnboardingState) => void;
  readonly devInitialStep?: OnboardingStep;
};

export function useOnboardingFlow({
  userId,
  userEmail,
  initialDisplayName,
  trackerStatus,
  accessibilityGranted: accessibilityGrantedFromApp,
  onRefreshTracker,
  onStartTracking,
  onCheckAccessibility,
  onRequestAccessibility,
  onEnableDriftAlerts,
  onLocalAiSetupChange,
  cloudTrialStartedNotice,
  onAcknowledgeCloudTrialStartedNotice,
  onComplete,
  devInitialStep,
}: UseOnboardingFlowOptions) {
  const [displayName] = useState(initialDisplayName.trim());
  const { addMainActivity, mainActivities, mainActivityOther, setMainActivityOther, toggleMainActivity } = useMainActivities();
  const [workType, setWorkType] = useState<string | null>(null);
  const [workTypeOther, setWorkTypeOther] = useState("");
  const [workDomain, setWorkDomain] = useState<string | null>(null);
  const [workDomainOther, setWorkDomainOther] = useState("");
  const [jobType] = useState<string | null>(null);
  const [jobTypeOther] = useState("");
  const [driftAlarmEnabled, setDriftAlarmEnabled] = useState(false);
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(false);
  const [openAtLoginEnabled, setOpenAtLoginEnabled] = useState(true);
  const [step, setStep] = useState<OnboardingStep>(devInitialStep ?? "welcome");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const { screenRef, stepBodyRef, titleRef } = useOnboardingModalA11y(step);
  const connection = useOnboardingConnectionFlow({ onLocalAiSetupChange, step });
  const permissions = useOnboardingPermissions({
    accessibilityGrantedFromApp,
    onCheckAccessibility,
    onEnableDriftAlerts,
    onRefreshTracker,
    onRequestAccessibility,
    setSetupError,
    step,
    trackerStatus,
  });

  const steps = useMemo(() => getOnboardingSteps(connection.setupChoice), [connection.setupChoice]);
  const stepIndex = steps.findIndex((item) => item.id === step);
  const accountConnected = Boolean(userEmail);
  const permissionSummaryLabel = permissions.accessibilityGranted
    ? "Accessibility verified"
    : "Tracking readiness verified";
  const isFinalStep = stepIndex === steps.length - 1;
  const canAdvance = canAdvanceOnboarding({
    accessibilityReady: permissions.accessibilityReady,
    accessibilityRecheckPending: permissions.accessibilityRecheckPending,
    accountConnected,
    apiKeyIsValid: connection.apiKeyIsValid,
    connectionPhase: connection.connectionPhase,
    customEndpointIsValid: connection.customEndpointIsValid,
    isCustomEndpointSetup: connection.isCustomEndpointSetup,
    isManagedProviderSetup: connection.isManagedProviderSetup,
    managedLocalStarted: connection.managedLocalStarted,
    notificationsReady: permissions.notificationsReady,
    setupChoice: connection.setupChoice,
    step,
    workDomain,
    workType,
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
  }), [
    canAdvance,
    connection.connectionPhase,
    connection.customEndpointBaseUrlIssue,
    connection.customEndpointModelIssue,
    connection.isCustomEndpointSetup,
    connection.isManagedProviderSetup,
    permissions.accessibilityRecheckPending,
    step,
  ]);
  const title = useMemo(() => titleForStep({
    accountConnected,
    connectionPhase: connection.connectionPhase,
    isByokSetup: connection.isByokSetup,
    isCustomEndpointSetup: connection.isCustomEndpointSetup,
    setupChoice: connection.setupChoice,
    step,
  }), [
    accountConnected,
    connection.connectionPhase,
    connection.isByokSetup,
    connection.isCustomEndpointSetup,
    connection.setupChoice,
    step,
  ]);
  const subtitle = step === "choose_setup"
    ? "Start with Drifty Cloud, run AI locally, bring your own key, or point Drifty at an OpenAI-compatible endpoint."
    : "";
  const titleIsVisible = step !== "welcome";
  const progressPct = ((stepIndex + 1) / steps.length) * 100;
  const footerLabel = footerLabelForStep({
    isFinalStep,
    isUserManagedProviderSetup: connection.isUserManagedProviderSetup,
    setupChoice: connection.setupChoice,
    step,
  });

  async function completeOnboarding() {
    await completeOnboardingAction({
      cloudTrialStartedNoticePresent: Boolean(cloudTrialStartedNotice),
      displayName,
      driftAlarmEnabled,
      extremeNudgeEnabled,
      jobType,
      jobTypeOther,
      mainActivities,
      mainActivityOther,
      onAcknowledgeCloudTrialStartedNotice,
      onComplete,
      onStartTracking,
      openAtLoginEnabled,
      setSetupError,
      setStorageError,
      setupChoice: connection.setupChoice,
      userId,
      workDomain,
      workDomainOther,
      workType,
      workTypeOther,
    });
  }

  function goToNextStep() {
    const nextStep = steps[stepIndex + 1]?.id;
    if (nextStep) setStep(nextStep);
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
    accountConnected,
    addMainActivity,
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
    progressPct,
    screenRef,
    setDriftAlarmEnabled,
    setExtremeNudgeEnabled,
    setMainActivityOther,
    setOpenAtLoginEnabled,
    setStep,
    setupError,
    step,
    stepBodyRef,
    stepIndex,
    storageError,
    subtitle,
    title,
    titleIsVisible,
    titleRef,
    toggleMainActivity,
    workDomain,
    workDomainOther,
    workType,
    workTypeOther,
    setWorkDomain,
    setWorkDomainOther,
    setWorkType,
    setWorkTypeOther,
  };
}

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;
