import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { TrackerStatus } from "@drifty/domain";
import { openSystemSettingsPane, type SystemSettingsPane } from "../../lib/api/systemSettingsClient";
import { Dropdown } from "./components/Dropdown";
import { GoogleMark } from "./components/GoogleMark";
import { TypewriterSequence } from "./components/TypewriterSequence";
import {
  MAIN_ACTIVITY_OPTIONS,
  WORK_DOMAIN_OPTIONS,
  WORK_TYPE_OPTIONS,
} from "./constants";
import wordmarkUrl from "../../assets/drifty-wordmark.png";
import {
  getUserOnboardingStorageKey,
  ONBOARDING_STORAGE_VERSION,
  readUserOnboardingState,
  type UserOnboardingState,
} from "./onboardingState";
import "./onboarding.css";

const ONBOARDING_STORAGE_ERROR_MESSAGE = "Unable to save setup locally. Check storage permissions and try again.";

export {
  getUserOnboardingStorageKey,
  ONBOARDING_STORAGE_VERSION,
  readUserOnboardingState,
  type OnboardingPurpose,
  type UserOnboardingState,
} from "./onboardingState";

type SaveUserOnboardingStateResult =
  | { success: true; state: UserOnboardingState }
  | { success: false; error: string };

type OnboardingStep =
  | "welcome"
  | "choose_setup"
  | "account"
  | "job"
  | "data_review"
  | "permissions"
  | "ready"
  | "connect_server"
  | "test_connection"
  | "self_data_review"
  | "privacy"
  | "work_profile"
  | "accessibility"
  | "notifications";

type OnboardingStepDef = { id: OnboardingStep; label: string };
type SetupChoice = "simple" | "local_ai" | "byok";

// Steps shared by every path until the user picks a setup type.
const BASE_STEPS: OnboardingStepDef[] = [
  { id: "welcome", label: "Welcome" },
  { id: "job", label: "Work" },
  { id: "permissions", label: "Permissions" },
  { id: "choose_setup", label: "Setup" },
];

// Simple Setup path: Drifty-hosted, guided account + ready flow after the shared basics.
const SIMPLE_SETUP_STEPS: OnboardingStepDef[] = [
  { id: "account", label: "Account" },
  { id: "ready", label: "Ready" },
];

// Local AI and BYOK paths keep their separate connection inputs, run a check,
// then review data handling before the ready step.
const SELF_HOST_STEPS: OnboardingStepDef[] = [
  { id: "connect_server", label: "Connect" },
  { id: "test_connection", label: "Test" },
  { id: "self_data_review", label: "Data" },
  { id: "ready", label: "Ready" },
];

function getOnboardingSteps(setupChoice: SetupChoice | null): OnboardingStepDef[] {
  if (setupChoice === "simple") return [...BASE_STEPS, ...SIMPLE_SETUP_STEPS];
  if (setupChoice === "local_ai" || setupChoice === "byok") return [...BASE_STEPS, ...SELF_HOST_STEPS];
  return BASE_STEPS;
}

const PRIVACY_RECORDED = [
  "App name",
  "Window title",
  "Active time",
  "Idle time",
  "Browser/site context",
  "YouTube metadata",
  "Focus/Drift classification",
  "AI tool token usage summary",
];

const PRIVACY_NOT_RECORDED = [
  "Keystrokes",
  "Screenshots",
  "Screen recordings",
  "File contents",
  "Passwords",
  "Message bodies",
];

const MAX_MAIN_ACTIVITY_SELECTIONS = 5;

type ConnectionCheckStatus = "pending" | "loading" | "success" | "error";
type ConnectionPhase = "idle" | "testing" | "success" | "failed";
type ConnectionCheck = { id: string; label: string };

const LOCAL_AI_CONNECTION_CHECKS: ReadonlyArray<ConnectionCheck> = [
  { id: "reachable", label: "Server reachable" },
  { id: "detected", label: "Drifty server detected" },
  { id: "model", label: "Local model endpoint ready" },
];

const BYOK_CONNECTION_CHECKS: ReadonlyArray<ConnectionCheck> = [
  { id: "key", label: "OpenRouter key shape valid" },
  { id: "provider", label: "Provider reachable" },
  { id: "classifier", label: "Classification ready" },
];

// Masks an OpenRouter API key so only the final four characters are ever shown
// after a successful connection. The raw key is never persisted or logged.
function maskApiKey(key: string): string {
  const trimmed = key.trim();
  const last4 = trimmed.slice(-4);
  return `sk-or-••••••${last4}`;
}

type NotificationPermissionState = "unknown" | "checking" | "granted" | "denied" | "unavailable";

export function hasCompletedUserOnboarding(userId: string): boolean {
  return readUserOnboardingState(userId)?.completed === true;
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

export type OnboardingStepId = OnboardingStep;

export function OnboardingModal({
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
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithEmail,
  onComplete,
  __devInitialStep,
}: {
  userId: string;
  userEmail: string | null;
  initialDisplayName: string;
  trackerStatus: TrackerStatus | null;
  accessibilityGranted: boolean;
  onRefreshTracker: () => Promise<void>;
  onStartTracking: () => Promise<void>;
  onCheckAccessibility: () => Promise<boolean>;
  onRequestAccessibility: () => Promise<boolean>;
  onEnableDriftAlerts: () => void;
  onStartCloudTrialWithGoogle: () => void;
  onStartCloudTrialWithEmail: () => void;
  onComplete: (state: UserOnboardingState) => void;
  /** Dev-only: start on a specific step for visual review / Playwright. */
  __devInitialStep?: OnboardingStep;
}) {
  // Name is no longer collected during onboarding; keep the value provided by
  // the caller (if any) as the stored fallback for displayName.
  const [displayName] = useState(initialDisplayName.trim());
  const [setupChoice, setSetupChoice] = useState<SetupChoice | null>(null);

  // Self-host server connection state. The raw API key lives only in component
  // memory and is never persisted; after a successful test we keep a masked
  // version for display.
  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>("idle");
  const [checkStatuses, setCheckStatuses] = useState<ConnectionCheckStatus[]>([]);
  const [connectionFailureLabel, setConnectionFailureLabel] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState(0);

  const [mainActivities, setMainActivities] = useState<string[]>([]);
  const [mainActivityOther, setMainActivityOther] = useState("");
  const [workType, setWorkType] = useState<string | null>(null);
  const [workTypeOther, setWorkTypeOther] = useState("");
  const [workDomain, setWorkDomain] = useState<string | null>(null);
  const [workDomainOther, setWorkDomainOther] = useState("");
  const [jobType] = useState<string | null>(null);
  const [jobTypeOther] = useState("");

  const [step, setStep] = useState<OnboardingStep>(__devInitialStep ?? "welcome");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [openingSettingsPane, setOpeningSettingsPane] = useState<SystemSettingsPane | null>(null);
  const [accessibilityJustGranted, setAccessibilityJustGranted] = useState(false);
  const [accessibilityRecheckPending, setAccessibilityRecheckPending] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "unknown" : "unavailable",
  );

  const onRefreshTrackerRef = useRef(onRefreshTracker);
  const onCheckAccessibilityRef = useRef(onCheckAccessibility);
  const onRequestAccessibilityRef = useRef(onRequestAccessibility);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const screenRef = useRef<HTMLElement>(null);
  const stepBodyRef = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => getOnboardingSteps(setupChoice), [setupChoice]);
  const stepIndex = steps.findIndex((item) => item.id === step);
  const isDesktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const trackerUnavailable = trackerStatus?.trackerMode === "unavailable";
  const accessibilityGranted = accessibilityGrantedFromApp || Boolean(trackerStatus?.accessibilityGranted);
  const accessibilityReady = accessibilityGranted || (!isDesktopRuntime && trackerUnavailable);
  const accountConnected = Boolean(userEmail);
  const permissionSummaryLabel = accessibilityGranted ? "Accessibility verified" : "Tracking readiness verified";
  const previousAccessibilityGrantedRef = useRef(accessibilityGranted);
  const notificationsReady =
    notificationPermission === "granted" || notificationPermission === "unavailable";
  const isFinalStep = stepIndex === steps.length - 1;
  const isByokSetup = setupChoice === "byok";
  const connectionChecks = isByokSetup ? BYOK_CONNECTION_CHECKS : LOCAL_AI_CONNECTION_CHECKS;
  const serverUrlIsValid = /^https?:\/\//i.test(serverUrl.trim());
  const apiKeyIsValid = apiKey.trim().toLowerCase().startsWith("sk-or-");

  const canAdvance = (() => {
    switch (step) {
      case "welcome":
        return true;
      case "choose_setup":
        return Boolean(setupChoice);
      case "account":
        return accountConnected;
      case "job":
        return true;
      case "data_review":
        return true;
      case "connect_server":
        if (setupChoice === "local_ai") return serverUrlIsValid;
        if (setupChoice === "byok") return apiKeyIsValid;
        return false;
      case "test_connection":
        return connectionPhase === "success";
      case "self_data_review":
        return true;
      case "permissions":
        return true;
      case "ready":
        return true;
      case "privacy":
        return true;
      case "work_profile":
        return Boolean(workType) && Boolean(workDomain);
      case "accessibility":
        return accessibilityReady && !accessibilityRecheckPending;
      case "notifications":
        return notificationsReady;
      default:
        return true;
    }
  })();

  const blockedHint = useMemo(() => {
    if (canAdvance) return null;
    switch (step) {
      case "account":
        return "Connect an account to continue.";
      case "job":
        return null;
      case "connect_server":
        return isByokSetup ? "Enter an OpenRouter key that starts with sk-or-." : "Server URL must start with http:// or https://.";
      case "test_connection":
        if (connectionPhase === "failed") return "Connection failed. Try again or edit your details.";
        return "Checking your connection.";
      case "accessibility":
        if (accessibilityRecheckPending) return "Checking Accessibility access.";
        return "Enable Accessibility to continue.";
      case "notifications":
        return "Allow Notifications to finish setup.";
      default:
        return null;
    }
  }, [accessibilityRecheckPending, canAdvance, connectionPhase, isByokSetup, step]);

  const title = useMemo(() => {
    switch (step) {
      case "welcome":
        return "Welcome to drifty";
      case "choose_setup":
        return "Choose your setup";
      case "account":
        return "Connect your account";
      case "job":
        return "What do you usually do?";
      case "data_review":
        return "Review your data settings";
      case "connect_server":
        return isByokSetup ? "Add your OpenRouter key" : "Add your Local AI server URL";
      case "test_connection":
        return connectionPhase === "success"
          ? "Connection successful"
          : connectionPhase === "failed"
            ? "Connection failed"
            : "Testing connection";
      case "self_data_review":
        return "Review how your data is handled";
      case "permissions":
        return "Set up permissions";
      case "ready":
        return "You're ready to start";
      case "privacy":
        return "What Drifty records";
      case "work_profile":
        return "Tell us about your work";
      case "accessibility":
        return "Enable Accessibility";
      case "notifications":
        return "Allow notifications";
    }
  }, [connectionPhase, isByokSetup, step]);

  const subtitle = step === "choose_setup"
    ? "Start with Drifty Cloud, run AI locally, or bring your own AI key. You can change this later."
    : "";

  useEffect(() => {
    onRefreshTrackerRef.current = onRefreshTracker;
  }, [onRefreshTracker]);

  useEffect(() => {
    onCheckAccessibilityRef.current = onCheckAccessibility;
  }, [onCheckAccessibility]);

  useEffect(() => {
    onRequestAccessibilityRef.current = onRequestAccessibility;
  }, [onRequestAccessibility]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const screen = screenRef.current;
    const appShell = screen?.parentElement;
    if (!screen || !appShell) return;

    const siblings = Array.from(appShell.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== screen,
    );
    const previousStates = siblings.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert"),
    }));

    for (const element of siblings) {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }

    return () => {
      for (const { element, ariaHidden, inert } of previousStates) {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (!inert) element.removeAttribute("inert");
      }
    };
  }, []);

  useEffect(() => {
    if (step !== "accessibility" && step !== "permissions") {
      setAccessibilityRecheckPending(true);
      return;
    }

    let cancelled = false;
    let checking = false;

    async function checkAccessibilityStatus() {
      if (checking || cancelled) return;
      checking = true;
      setAccessibilityRecheckPending(true);
      try {
        await onCheckAccessibilityRef.current();
      } catch {
        // ignored: Check again surfaces user-facing errors
      } finally {
        if (!cancelled) setAccessibilityRecheckPending(false);
        checking = false;
      }
    }

    void checkAccessibilityStatus();

    if (accessibilityReady) {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void checkAccessibilityStatus();
    }, 2000);

    function handleFocus() {
      void checkAccessibilityStatus();
    }
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [accessibilityReady, step]);

  useEffect(() => {
    const wasAccessibilityGranted = previousAccessibilityGrantedRef.current;
    previousAccessibilityGrantedRef.current = accessibilityGranted;
    if (step === "accessibility" && !wasAccessibilityGranted && accessibilityGranted) {
      setAccessibilityJustGranted(true);
    }
  }, [accessibilityGranted, step]);

  useEffect(() => {
    if (step !== "accessibility") setAccessibilityJustGranted(false);
  }, [step]);

  useEffect(() => {
    if (step !== "test_connection") return;

    const checks = setupChoice === "byok" ? BYOK_CONNECTION_CHECKS : LOCAL_AI_CONNECTION_CHECKS;
    const failIndex = setupChoice === "byok"
      ? apiKeyIsValid ? -1 : 0
      : serverUrlIsValid ? -1 : 0;

    setConnectionPhase("testing");
    setConnectionFailureLabel(null);
    setCheckStatuses(checks.map(() => "pending"));

    let cancelled = false;
    const timers: number[] = [];

    function runCheck(index: number) {
      if (cancelled) return;
      if (index >= checks.length) {
        setMaskedApiKey(setupChoice === "byok" ? maskApiKey(apiKey) : null);
        setConnectionPhase("success");
        return;
      }

      setCheckStatuses((current) => current.map((status, statusIndex) => (statusIndex === index ? "loading" : status)));
      const timerId = window.setTimeout(() => {
        if (cancelled) return;
        const failedHere = failIndex === index;
        setCheckStatuses((current) => current.map((status, statusIndex) => (statusIndex === index ? failedHere ? "error" : "success" : status)));
        if (failedHere) {
          setConnectionFailureLabel(checks[index]?.label ?? "the connection check");
          setConnectionPhase("failed");
          return;
        }
        runCheck(index + 1);
      }, 260);
      timers.push(timerId);
    }

    const startTimerId = window.setTimeout(() => runCheck(0), 120);
    timers.push(startTimerId);

    return () => {
      cancelled = true;
      for (const timerId of timers) window.clearTimeout(timerId);
    };
  }, [apiKey, apiKeyIsValid, serverUrlIsValid, setupChoice, step, testRunId]);

  function resetConnectionValidation() {
    setConnectionPhase("idle");
    setCheckStatuses([]);
    setConnectionFailureLabel(null);
  }

  function toggleMainActivity(option: string) {
    setMainActivities((current) => {
      if (current.includes(option)) return current.filter((item) => item !== option);
      if (current.length >= MAX_MAIN_ACTIVITY_SELECTIONS) return current;
      return [...current, option];
    });
  }

  function addMainActivity(option: string) {
    if (!option) return;
    setMainActivities((current) => {
      if (current.includes(option) || current.length >= MAX_MAIN_ACTIVITY_SELECTIONS) return current;
      return [...current, option];
    });
  }

  async function completeOnboarding() {
    setStorageError(null);
    setSetupError(null);
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
      workDomain,
      workDomainOther,
      jobType: mainActivities.length > 0 ? mainActivities.join(", ") : jobType,
      jobTypeOther: mainActivities.includes("Other") ? mainActivityOther : jobTypeOther,
      focusGoalHours: null,
      driftThresholdMinutes: null,
    });
    if (!result.success) {
      setStorageError(result.error);
      return;
    }
    onComplete(result.state);
  }

  function goToNextStep() {
    const nextStep = steps[stepIndex + 1]?.id;
    if (nextStep) setStep(nextStep);
  }

  function goToPreviousStep() {
    const previousStep = steps[stepIndex - 1]?.id;
    if (previousStep) setStep(previousStep);
  }

  async function handleRefreshTrackerClick() {
    setSetupError(null);
    try {
      await onRefreshTracker();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to refresh tracker status.");
    }
  }

  async function handleRequestAccessibilityClick() {
    setSetupError(null);
    setOpeningSettingsPane("accessibility");
    try {
      await onRequestAccessibilityRef.current();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to request Accessibility access.");
    } finally {
      setOpeningSettingsPane(null);
    }
  }

  async function handleOpenSettingsPane(pane: SystemSettingsPane) {
    setSetupError(null);
    setOpeningSettingsPane(pane);
    try {
      const opened = await openSystemSettingsPane(pane);
      if (!opened) {
        setSetupError("System Settings can only be opened from the macOS desktop app.");
        return;
      }
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to open System Settings.");
    } finally {
      setOpeningSettingsPane(null);
    }
  }

  async function handleNotificationPermissionClick() {
    setSetupError(null);
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      setNotificationPermission("unavailable");
      return;
    }
    setNotificationPermission("checking");
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      const alreadyGranted = await isPermissionGranted();
      if (alreadyGranted) {
        onEnableDriftAlerts();
        setNotificationPermission("granted");
        return;
      }
      const permission = await requestPermission();
      if (permission === "granted") {
        onEnableDriftAlerts();
        setNotificationPermission("granted");
      } else {
        setNotificationPermission("denied");
      }
    } catch (error) {
      setNotificationPermission("unavailable");
      setSetupError(error instanceof Error ? error.message : "Notification permission is unavailable here.");
    }
  }

  function handleSetupChoice(nextChoice: SetupChoice) {
    setSetupChoice(nextChoice);
    resetConnectionValidation();
    setMaskedApiKey(null);
  }

  function handleServerUrlChange(value: string) {
    setServerUrl(value);
    resetConnectionValidation();
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value);
    resetConnectionValidation();
    setMaskedApiKey(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isFinalStep) {
      setStorageError(null);
      setSetupError(null);
      if (!canAdvance) return;
      if (step === "connect_server") {
        setStep("test_connection");
        return;
      }
      goToNextStep();
      return;
    }
    void completeOnboarding();
  }

  const titleIsVisible = step !== "welcome";
  const progressPct = ((stepIndex + 1) / steps.length) * 100;

  const footerLabel = (() => {
    switch (step) {
      case "job":
        return "Continue";
      case "choose_setup":
        return "Continue";
      case "connect_server":
        return "Test connection";
      case "test_connection":
        return "Continue";
      case "self_data_review":
        return "Continue";
      case "permissions":
        return setupChoice === "local_ai" || setupChoice === "byok" ? "Continue" : "Next";
      case "ready":
        return "Start tracking";
      default:
        return isFinalStep ? "Finish setup" : "Next";
    }
  })();

  return (
    <section
      ref={screenRef}
      className="onboarding-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-window-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className="onboarding-topbar" data-tauri-drag-region>
        <img className="onboarding-logo onboarding-logo--image" src={wordmarkUrl} alt="drifty" data-tauri-drag-region />
        <div className="onboarding-progress-bar--full" aria-label="Setup progress">
          <div className="onboarding-progress-bar__fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="onboarding-content-area">
        <form className="onboarding-card" onSubmit={handleSubmit}>
          <div className="onboarding-copy-column">
            <div className={`onboarding-middle onboarding-middle--${step}`}>
              <h1
                className={`onboarding-title${titleIsVisible ? "" : " onb-visually-hidden"}${step === "job" ? " onb-title--job" : ""}`}
                id="onboarding-title"
                ref={titleRef}
                tabIndex={-1}
              >
                {title}
              </h1>
              {subtitle ? <p className="onb-step-desc onboarding-subtitle">{subtitle}</p> : null}

              <div className={`onboarding-body onboarding-body--${step}`}>
                <div className="onboarding-viewport">
                  <div className="onboarding-step" key={step} ref={stepBodyRef}>
            {step === "welcome" ? (
              <div className="onb-welcome">
                <TypewriterSequence
                  key="welcome-intro"
                  speed={18}
                  segments={[
                    { text: "Hey, I'm drifty!", className: "tw-title" },
                    { text: "Your AI Time Tracker.", className: "tw-title" },
                    {
                      text:
                        "I'm your focus companion. I show where your time goes and help you stay with what matters.",
                      className: "tw-message",
                    },
                    { text: "Let's set up a few things. This takes about a minute.", className: "tw-sub" },
                  ]}
                />
              </div>
            ) : null}

            {step === "choose_setup" ? (
              <div className="onb-setup-choice">
                <button
                  type="button"
                  className={`onb-setup-choice__card${
                    setupChoice === "simple" ? " onb-setup-choice__card--selected" : ""
                  }`}
                  aria-pressed={setupChoice === "simple"}
                  onClick={() => handleSetupChoice("simple")}
                >
                  <span className="onb-setup-choice__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M7.2 17.2h9.2a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11 1.8 3.2 3.2 0 0 0 1.4 6.2Z" />
                      <path d="M9.3 13.8h5.9" />
                    </svg>
                  </span>
                  <span className="onb-setup-choice__copy">
                    <span className="onb-setup-choice__title">Drifty Cloud</span>
                    <span className="onb-setup-choice__desc">Start fast with hosted AI. Includes a 7-day trial.</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`onb-setup-choice__card${
                    setupChoice === "local_ai" ? " onb-setup-choice__card--selected" : ""
                  }`}
                  aria-pressed={setupChoice === "local_ai"}
                  onClick={() => handleSetupChoice("local_ai")}
                >
                  <span className="onb-setup-choice__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M6 6.8h12v8.4H6Z" />
                      <path d="M8.4 18h7.2M9.2 9.8h5.6M9.2 12.2h5.6" />
                    </svg>
                  </span>
                  <span className="onb-setup-choice__copy">
                    <span className="onb-setup-choice__title">Local AI</span>
                    <span className="onb-setup-choice__desc">Run AI on your own local server for maximum control.</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`onb-setup-choice__card${
                    setupChoice === "byok" ? " onb-setup-choice__card--selected" : ""
                  }`}
                  aria-pressed={setupChoice === "byok"}
                  onClick={() => handleSetupChoice("byok")}
                >
                  <span className="onb-setup-choice__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <circle cx="8.1" cy="15.9" r="2.45" />
                      <path d="M9.85 14.15 16.9 7.1" />
                      <path d="M15.35 8.65 17.15 10.45" />
                      <path d="M13.95 10.05 15.2 11.3" />
                    </svg>
                  </span>
                  <span className="onb-setup-choice__copy">
                    <span className="onb-setup-choice__title">BYOK (Bring Your Own Key)</span>
                    <span className="onb-setup-choice__desc">
                      Use your own OpenRouter API key. Estimated $2-4/month with DeepSeek v4 flash.
                    </span>
                  </span>
                </button>
              </div>
            ) : null}

            {step === "account" ? (
              <>
                <p className="onb-step-desc">
                  Your account keeps your focus and drift insights synced across your devices.
                </p>
                <div className="onb-account">
                  <button
                    type="button"
                    className="onb-button onb-button--primary onb-account__provider"
                    onClick={onStartCloudTrialWithGoogle}
                    disabled={accountConnected}
                  >
                    {accountConnected ? (
                      "Account connected"
                    ) : (
                      <>
                        <GoogleMark />
                        <span>Continue with Google</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="onb-button onb-button--ghost onb-account__provider"
                    onClick={onStartCloudTrialWithEmail}
                    disabled={accountConnected}
                  >
                    {accountConnected ? "Signed in" : "Continue with email"}
                  </button>
                </div>
                <p className="onb-account__helper">
                  Drifty never shares your activity data with teammates unless you choose to join a team or
                  share a report.
                </p>
              </>
            ) : null}

            {step === "job" ? (
              <>
                <p className="onb-step-desc">Choose up to 5 activities.</p>
                <div className="onb-job__compact">
                  <div className="onb-activity-picker">
                    {mainActivities.length > 0 ? (
                      <div className="onb-activity-tags" role="group" aria-label="Selected activities">
                        {mainActivities.map((option) => (
                          <button
                            type="button"
                            className="onb-activity-tag"
                            key={option}
                            onClick={() => toggleMainActivity(option)}
                            aria-label={`Remove ${option}`}
                          >
                            <span>{option}</span>
                            <span className="onb-activity-tag__remove" aria-hidden="true">x</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="onb-dropdown">
                      <div className="onb-dropdown__trigger" role="combobox" aria-expanded="false" aria-label="Search activities">
                        <select
                          className="onb-dropdown__input"
                          value=""
                          disabled={mainActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS}
                          onChange={(event) => addMainActivity(event.target.value)}
                          aria-label="Search activities"
                        >
                          <option value="">
                            {mainActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS ? "Maximum 5 selected" : "Search activities..."}
                          </option>
                          {MAIN_ACTIVITY_OPTIONS.filter((option) => !mainActivities.includes(option)).map((option) => (
                            <option value={option} key={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <div className="onb-dropdown__icons">
                          <svg className="onb-dropdown__chevron" width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    {mainActivities.includes("Other") ? (
                      <input
                        className="onb-dropdown__other-input"
                        type="text"
                        placeholder="e.g. Coaching, recruiting, compliance"
                        value={mainActivityOther}
                        onChange={(event) => setMainActivityOther(event.target.value)}
                        aria-label="Enter your activity"
                      />
                    ) : null}
                  </div>
                  <div className="onb-job__question">
                    <div className="onb-inline-question">
                      <h2 className="onb-inline-question-title">What field are you in?</h2>
                      <p className="onb-step-desc">This helps Drifty understand the context of your work.</p>
                    </div>
                    <Dropdown
                      options={WORK_DOMAIN_OPTIONS}
                      value={workDomain}
                      onChange={setWorkDomain}
                      placeholder="Search field..."
                      otherText={workDomainOther}
                      onOtherTextChange={setWorkDomainOther}
                      searchable
                      ariaLabel="Your field"
                    />
                  </div>
                </div>
              </>
            ) : null}

            {step === "data_review" ? (
              <>
                <p className="onb-step-desc">Review this before Drifty starts building your focus insights.</p>
                <div className="onb-data-rows" aria-label="Data handling summary">
                  <div className="onb-data-row">
                    <span className="onb-data-row__label">Uses</span>
                    <span className="onb-data-row__copy">
                      App names, active windows, browser sites, and session timing.
                    </span>
                  </div>
                  <div className="onb-data-row">
                    <span className="onb-data-row__label">Stored for</span>
                    <span className="onb-data-row__copy">Your Drifty account and insight history after setup.</span>
                  </div>
                  <div className="onb-data-row">
                    <span className="onb-data-row__label">You control</span>
                    <span className="onb-data-row__copy">
                      Pause tracking, review settings, or switch setup later.
                    </span>
                  </div>
                </div>
              </>
            ) : null}

            {step === "connect_server" ? (
              <>
                <p className="onb-step-desc">
                  {isByokSetup
                    ? "Enter the OpenRouter key Drifty uses for focus insights. The key stays masked during setup."
                    : "Enter the localhost address for your Local AI server."}
                </p>
                <div className="onb-server-form">
                  {isByokSetup ? (
                    <label className="onb-field">
                      <span className="onb-field__label">OpenRouter API key</span>
                      <span className="onb-secure-field">
                        <input
                          className={`onb-field__input onb-secure-field__input${
                            apiKey.trim() && !apiKeyIsValid ? " onb-field__input--invalid" : ""
                          }`}
                          type="password"
                          autoCapitalize="none"
                          autoCorrect="off"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="sk-or-..."
                          value={apiKey}
                          onChange={(event) => handleApiKeyChange(event.target.value)}
                          aria-label="OpenRouter API key"
                          aria-invalid={apiKey.trim() && !apiKeyIsValid ? "true" : "false"}
                        />
                        <span className="onb-secure-field__mask" aria-hidden="true">Masked</span>
                      </span>
                      <span
                        className={`onb-field__hint${
                          apiKey.trim() && !apiKeyIsValid ? " onb-field__hint--error" : ""
                        }`}
                      >
                        {apiKey.trim() && !apiKeyIsValid
                          ? "OpenRouter key should start with sk-or-."
                          : "Drifty never displays the raw key after you leave this field."}
                      </span>
                    </label>
                  ) : (
                    <label className="onb-field">
                      <span className="onb-field__label">Local AI server URL</span>
                      <input
                        className={`onb-field__input${
                          serverUrl.trim() && !serverUrlIsValid ? " onb-field__input--invalid" : ""
                        }`}
                        type="url"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="http://localhost:3000"
                        value={serverUrl}
                        onChange={(event) => handleServerUrlChange(event.target.value)}
                        aria-label="Server URL"
                        aria-invalid={serverUrl.trim() && !serverUrlIsValid ? "true" : "false"}
                      />
                      <span
                        className={`onb-field__hint${
                          serverUrl.trim() && !serverUrlIsValid ? " onb-field__hint--error" : ""
                        }`}
                      >
                        {serverUrl.trim() && !serverUrlIsValid
                          ? "Server URL must start with http:// or https://."
                          : "Use the local Drifty AI server address you control."}
                      </span>
                    </label>
                  )}
                </div>
              </>
            ) : null}

            {step === "test_connection" ? (
              <>
                <p className="onb-step-desc">
                  {connectionPhase === "success"
                    ? isByokSetup
                      ? "Your OpenRouter key is connected and ready for AI classification."
                      : "Your Local AI server is connected and ready for classification."
                    : connectionPhase === "failed"
                      ? `Drifty could not complete "${connectionFailureLabel ?? "the connection check"}". Review the details below and try again.`
                      : isByokSetup
                        ? "Checking that Drifty can use your masked OpenRouter key."
                        : "Checking that Drifty can reach your Local AI server."}
                </p>
                <ul className="onb-checklist" aria-label="Connection checks">
                  {connectionChecks.map((check, index) => {
                    const status = checkStatuses[index] ?? "pending";
                    return (
                      <li className={`onb-checklist__row onb-checklist__row--${status}`} key={check.id}>
                        <span className="onb-checklist__icon" aria-hidden="true" />
                        <span className="onb-checklist__label">{check.label}</span>
                      </li>
                    );
                  })}
                </ul>
                {connectionPhase === "failed" ? (
                  <>
                    <ul className="onb-checklist__fixes" aria-label="Possible fixes">
                      {isByokSetup ? (
                        <>
                          <li>Confirm the key starts with sk-or- and is active in OpenRouter.</li>
                          <li>Check your provider billing and model access.</li>
                        </>
                      ) : (
                        <>
                          <li>Confirm the server URL is correct and the local server is running.</li>
                          <li>Make sure your Mac can reach the local address.</li>
                        </>
                      )}
                    </ul>
                    <div className="onb-setup-card__actions">
                      <button type="button" className="onb-button onb-button--primary" onClick={() => setTestRunId((id) => id + 1)}>
                        Try again
                      </button>
                      <button type="button" className="onb-button onb-button--ghost" onClick={() => setStep("connect_server")}>
                        Edit connection details
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {step === "self_data_review" ? (
              <>
                <p className="onb-step-desc">
                  {isByokSetup
                    ? "With BYOK, Drifty sends minimized activity context to your chosen AI provider through OpenRouter using your masked key."
                    : "With Local AI, activity context stays pointed at the server you control instead of Drifty Cloud."}
                </p>
                <div className="onb-data-cards" aria-label="Self-hosted data handling summary">
                  <div className="onb-data-card">
                    <h2 className="onb-data-card__title">Where data goes</h2>
                    <p className="onb-data-card__desc">
                      {isByokSetup
                        ? "Minimized classification context goes to OpenRouter for the model call."
                        : `Activity goes to ${serverUrl.trim() || "your Local AI server"}, not to Drifty Cloud.`}
                    </p>
                  </div>
                  <div className="onb-data-card">
                    <h2 className="onb-data-card__title">Who manages it</h2>
                    <p className="onb-data-card__desc">
                      {isByokSetup
                        ? "You manage the provider key, model access, and provider billing."
                        : "You manage where the server runs, how it stores data, and who can access it."}
                    </p>
                  </div>
                  <div className="onb-data-card">
                    <h2 className="onb-data-card__title">What Drifty needs</h2>
                    <p className="onb-data-card__desc">
                      {isByokSetup
                        ? `A masked OpenRouter key${maskedApiKey ? ` (${maskedApiKey})` : ""} plus local permissions for activity context.`
                        : "Local permissions to read activity context and a reachable Local AI server URL."}
                    </p>
                  </div>
                </div>
                <p className="onb-account__helper">You can change these settings later.</p>
              </>
            ) : null}

            {step === "permissions" ? (
              <>
                <p className="onb-step-desc">
                  Drifty needs a few Mac permissions to understand your focus and drift patterns.
                </p>
                <ul className="onb-perms" aria-label="Required permissions">
                  <li className="onb-perms__row">
                    <div className="onb-perms__info">
                      <span className="onb-perms__name">Accessibility</span>
                      <span className="onb-perms__desc">Lets Drifty understand active apps and windows.</span>
                    </div>
                    <div className="onb-perms__control">
                      <span
                        className={`onb-status-pill${accessibilityReady ? " onb-status-pill--ready" : ""}`}
                      >
                        {accessibilityGranted ? "Enabled" : accessibilityReady ? "Ready" : "Required"}
                      </span>
                      <button
                        type="button"
                        className="onb-button onb-button--ghost onb-perms__action"
                        onClick={() => void handleRequestAccessibilityClick()}
                        disabled={openingSettingsPane === "accessibility" || accessibilityReady}
                      >
                        {openingSettingsPane === "accessibility"
                          ? "Opening…"
                          : accessibilityReady
                            ? accessibilityGranted
                              ? "Enabled"
                              : "Ready"
                            : "Enable"}
                      </button>
                    </div>
                  </li>
                  <li className="onb-perms__row">
                    <div className="onb-perms__info">
                      <span className="onb-perms__name">Notifications</span>
                      <span className="onb-perms__desc">Lets Drifty send gentle focus nudges and useful setup alerts.</span>
                    </div>
                    <div className="onb-perms__control">
                      <button
                        type="button"
                        className="onb-button onb-button--ghost onb-perms__action"
                        onClick={() => void handleNotificationPermissionClick()}
                        disabled={notificationPermission === "checking" || notificationsReady}
                      >
                        {notificationsReady ? "Enabled" : "Enable"}
                      </button>
                    </div>
                  </li>
                </ul>
              </>
            ) : null}

            {step === "ready" ? (
              <>
                <p className="onb-step-desc">
                  Drifty will now track your focus and drift in the background while you work.
                </p>
                {setupChoice === "local_ai" || setupChoice === "byok" ? (
                  <ul className="onb-summary" aria-label="Setup summary">
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      {setupChoice === "byok" ? "BYOK selected" : "Local AI selected"}
                    </li>
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      {setupChoice === "byok" ? "OpenRouter key connected" : "Server URL connected"}
                    </li>
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      {permissionSummaryLabel}
                    </li>
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      Tracking ready
                    </li>
                  </ul>
                ) : (
                  <ul className="onb-summary" aria-label="Setup summary">
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      Drifty AI selected
                    </li>
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      Account connected
                    </li>
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      {permissionSummaryLabel}
                    </li>
                    <li className="onb-summary__item">
                      <span className="onb-summary__check" aria-hidden="true" />
                      Tracking ready
                    </li>
                  </ul>
                )}
                <div className="onb-setup-card__actions">
                  {setupChoice === "local_ai" || setupChoice === "byok" ? (
                    <button
                      type="button"
                      className="onb-button onb-button--ghost"
                      onClick={() => setStep("connect_server")}
                    >
                      Change connection
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="onb-button onb-button--ghost"
                    onClick={() => void handleRequestAccessibilityClick()}
                  >
                    Open settings
                  </button>
                </div>
                <p className="onb-account__helper">You can pause Drifty any time from the menu bar.</p>
              </>
            ) : null}

            {step === "privacy" ? (
              <>
                <p className="onb-step-desc">Drifty records activity signals, not your screen.</p>
                <div className="onb-privacy">
                  <div className="onb-privacy__group">
                    <h2 className="onb-privacy__group-title">Recorded on this Mac</h2>
                    <ul className="onb-privacy__list onb-privacy__list--recorded">
                      {PRIVACY_RECORDED.map((item) => (
                        <li className="onb-privacy__item" key={item}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="onb-privacy__group">
                    <h2 className="onb-privacy__group-title">Not intentionally recorded</h2>
                    <ul className="onb-privacy__list onb-privacy__list--excluded">
                      {PRIVACY_NOT_RECORDED.map((item) => (
                        <li className="onb-privacy__item" key={item}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            ) : null}

            {step === "work_profile" ? (
              <>
                <Dropdown
                  options={WORK_TYPE_OPTIONS}
                  value={workType}
                  onChange={setWorkType}
                  placeholder="What's your role?"
                  otherText={workTypeOther}
                  onOtherTextChange={setWorkTypeOther}
                  searchable
                  ariaLabel="Your role"
                />
                <Dropdown
                  options={WORK_DOMAIN_OPTIONS}
                  value={workDomain}
                  onChange={setWorkDomain}
                  placeholder="What field do you work in?"
                  otherText={workDomainOther}
                  onOtherTextChange={setWorkDomainOther}
                  searchable
                  ariaLabel="Your field"
                />
              </>
            ) : null}

            {step === "accessibility" ? (
              <>
                <span className={`onb-status-pill${accessibilityReady ? " onb-status-pill--ready" : ""}`}>
                  {accessibilityReady ? "Granted" : "Waiting"}
                </span>
                <p className="onb-step-desc">drifty uses this to understand what you&apos;re working on.</p>
                {!accessibilityReady ? (
                  <ol className="onb-instructions" aria-label="Accessibility permission steps">
                    <li>Open System Settings → Privacy &amp; Security → Accessibility.</li>
                    <li>Enable drifty (or the terminal running it).</li>
                    <li>Return here. drifty detects it automatically.</li>
                  </ol>
                ) : null}
                {accessibilityJustGranted ? (
                  <p className="onb-setup-card__note">Detected automatically. Continue when you&apos;re ready.</p>
                ) : null}
                <div className="onb-setup-card__actions">
                  <button
                    type="button"
                    className="onb-button onb-button--primary"
                    onClick={() => void handleOpenSettingsPane("accessibility")}
                    disabled={openingSettingsPane === "accessibility" || accessibilityReady}
                  >
                    {openingSettingsPane === "accessibility"
                      ? "Opening…"
                      : accessibilityReady
                        ? "Accessibility ready"
                        : "Open Accessibility settings"}
                  </button>
                  <button
                    type="button"
                    className="onb-button onb-button--ghost"
                    onClick={() => void handleRefreshTrackerClick()}
                  >
                    Check again
                  </button>
                </div>
              </>
            ) : null}

            {step === "notifications" ? (
              <>
                <span className={`onb-status-pill${notificationsReady ? " onb-status-pill--ready" : ""}`}>
                  {notificationPermission === "unavailable"
                    ? "Preview"
                    : notificationsReady
                      ? "Granted"
                      : notificationPermission === "denied"
                        ? "Waiting"
                        : "Required"}
                </span>
                <p className="onb-step-desc">
                  drifty only nudges you when a drift lasts long enough to matter.
                </p>
                <div className="onb-setup-card__actions">
                  <button
                    type="button"
                    className="onb-button onb-button--primary"
                    onClick={() => void handleNotificationPermissionClick()}
                    disabled={
                      notificationPermission === "checking" ||
                      notificationPermission === "granted" ||
                      notificationPermission === "unavailable"
                    }
                  >
                    {notificationPermission === "checking"
                      ? "Checking…"
                      : notificationPermission === "granted"
                        ? "Notifications ready"
                        : notificationPermission === "unavailable"
                          ? "Unavailable here"
                          : notificationPermission === "denied"
                            ? "Check again"
                            : "Request permission"}
                  </button>
                  {notificationPermission === "denied" ? (
                    <button
                      type="button"
                      className="onb-button onb-button--ghost"
                      onClick={() => void handleOpenSettingsPane("notifications")}
                      disabled={openingSettingsPane === "notifications"}
                    >
                      {openingSettingsPane === "notifications" ? "Opening…" : "Open Notification settings"}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}

            {storageError ? (
              <p className="onb-error" role="alert">
                {storageError}
              </p>
            ) : null}
            {setupError ? (
              <p className="onb-error" role="alert">
                {setupError}
              </p>
            ) : null}
              </div>
            </div>
          </div>
          </div>

          <div className="onb-actions">
            {stepIndex > 0 ? (
              <button type="button" className="onb-actions__back" onClick={goToPreviousStep}>
                Back
              </button>
            ) : (
              <span className="onb-actions__spacer" />
            )}
            {blockedHint ? (
              <p className="onb-hint" role="status">
                {blockedHint}
              </p>
            ) : null}
            <button type="submit" className="onb-button onb-button--primary" disabled={!canAdvance}>
              {footerLabel}
            </button>
          </div>
          </div>
        </form>
      </div>
    </section>
  );
}
