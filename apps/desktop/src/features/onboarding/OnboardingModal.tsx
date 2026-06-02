import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { TrackerStatus } from "@dtime/domain";
import { openSystemSettingsPane, type SystemSettingsPane } from "../../lib/api/systemSettingsClient";
import { Dropdown } from "./components/Dropdown";
import { TypewriterSequence } from "./components/TypewriterSequence";
import {
  WORK_DOMAIN_OPTIONS,
  WORK_TYPE_OPTIONS,
} from "./constants";
import wordmarkUrl from "../../assets/drifty-wordmark.png";
import "./onboarding.css";

const ONBOARDING_STORAGE_VERSION = 2;
const ONBOARDING_STORAGE_ERROR_MESSAGE = "Unable to save setup locally. Check storage permissions and try again.";

export type OnboardingPurpose =
  | "protect_focus"
  | "understand_day"
  | "plan_review"
  | "accountability"
  | "exploring";

export type UserOnboardingState = {
  version: typeof ONBOARDING_STORAGE_VERSION;
  completed: true;
  displayName: string;
  workType: string | null;
  workTypeOther: string;
  workDomain: string | null;
  workDomainOther: string;
  focusGoalHours: number | null;
  driftThresholdMinutes: number | null;
  purpose: OnboardingPurpose | null;
  completedAt: string;
};

type SaveUserOnboardingStateResult =
  | { success: true; state: UserOnboardingState }
  | { success: false; error: string };

type OnboardingStep =
  | "cloud_choice"
  | "welcome"
  | "work_profile"
  | "tracker"
  | "accessibility"
  | "notifications";

const ONBOARDING_STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: "cloud_choice", label: "AI setup" },
  { id: "welcome", label: "Welcome" },
  { id: "work_profile", label: "Profile" },
  { id: "tracker", label: "Tracker" },
  { id: "accessibility", label: "Context" },
  { id: "notifications", label: "Notifications" },
];

type NotificationPermissionState = "unknown" | "checking" | "granted" | "denied" | "unavailable";

const VALID_PURPOSES: ReadonlySet<string> = new Set<OnboardingPurpose>([
  "protect_focus",
  "understand_day",
  "plan_review",
  "accountability",
  "exploring",
]);

function isOnboardingPurpose(value: unknown): value is OnboardingPurpose {
  return typeof value === "string" && VALID_PURPOSES.has(value);
}

export function getUserOnboardingStorageKey(userId: string): string {
  return `drifty:onboarding:v${ONBOARDING_STORAGE_VERSION}:${userId}`;
}

function getLegacyStorageKeys(userId: string): string[] {
  return [
    `drifty:onboarding:v1:${userId}`,
    `dtime:onboarding:v1:${userId}`,
  ];
}

function parseUserOnboardingState(rawValue: string | null): UserOnboardingState | null {
  if (!rawValue) return null;
  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object") return null;
    const record = parsedValue as Record<string, unknown>;
    if (record.completed !== true || typeof record.completedAt !== "string") return null;
    if (record.version !== 1 && record.version !== 2) return null;

    const displayName = typeof record.displayName === "string" ? record.displayName : "";
    const purpose = isOnboardingPurpose(record.purpose) ? record.purpose : null;
    const workType = typeof record.workType === "string" ? record.workType : null;
    const workTypeOther = typeof record.workTypeOther === "string" ? record.workTypeOther : "";
    const workDomain = typeof record.workDomain === "string" ? record.workDomain : null;
    const workDomainOther = typeof record.workDomainOther === "string" ? record.workDomainOther : "";
    const focusGoalHours = typeof record.focusGoalHours === "number" ? record.focusGoalHours : null;
    const driftThresholdMinutes =
      typeof record.driftThresholdMinutes === "number" ? record.driftThresholdMinutes : null;

    return {
      version: ONBOARDING_STORAGE_VERSION,
      completed: true,
      displayName,
      workType,
      workTypeOther,
      workDomain,
      workDomainOther,
      focusGoalHours,
      driftThresholdMinutes,
      purpose,
      completedAt: record.completedAt,
    };
  } catch {
    return null;
  }
}

export function readUserOnboardingState(userId: string): UserOnboardingState | null {
  const storageKey = getUserOnboardingStorageKey(userId);

  let state: UserOnboardingState | null = null;
  try {
    state = parseUserOnboardingState(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
  if (state) return state;

  for (const legacyKey of getLegacyStorageKeys(userId)) {
    let migrated: UserOnboardingState | null = null;
    try {
      migrated = parseUserOnboardingState(window.localStorage.getItem(legacyKey));
    } catch {
      return null;
    }
    if (migrated) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(migrated));
      } catch {
        // best effort migration; fall through and return the parsed value
      }
      return migrated;
    }
  }

  return null;
}

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
  focusGoalHours,
  driftThresholdMinutes,
}: {
  userId: string;
  displayName: string;
  workType: string | null;
  workTypeOther: string;
  workDomain: string | null;
  workDomainOther: string;
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
  userEmail: _userEmail,
  initialDisplayName: _initialDisplayName,
  trackerStatus,
  accessibilityGranted,
  onRefreshTracker,
  onStartTracking,
  onCheckAccessibility,
  onRequestAccessibility,
  onEnableDriftAlerts,
  onStartCloudTrial,
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
  onStartCloudTrial: () => void;
  onComplete: (state: UserOnboardingState) => void;
  /** Dev-only: start on a specific step for visual review / Playwright. */
  __devInitialStep?: OnboardingStep;
}) {
  void _userEmail; // accepted for API compatibility
  void _initialDisplayName;

  const [workType, setWorkType] = useState<string | null>(null);
  const [workTypeOther, setWorkTypeOther] = useState("");
  const [workDomain, setWorkDomain] = useState<string | null>(null);
  const [workDomainOther, setWorkDomainOther] = useState("");

  const [step, setStep] = useState<OnboardingStep>(__devInitialStep ?? (_userEmail ? "welcome" : "cloud_choice"));
  const [storageError, setStorageError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [startingTracker, setStartingTracker] = useState(false);
  const [openingSettingsPane, setOpeningSettingsPane] = useState<SystemSettingsPane | null>(null);
  const [accessibilityJustGranted, setAccessibilityJustGranted] = useState(false);
  const [accessibilityRecheckPending, setAccessibilityRecheckPending] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "unknown" : "unavailable",
  );

  const onRefreshTrackerRef = useRef(onRefreshTracker);
  const onCheckAccessibilityRef = useRef(onCheckAccessibility);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const screenRef = useRef<HTMLElement>(null);

  const stepIndex = ONBOARDING_STEPS.findIndex((item) => item.id === step);
  const visibleStepIndex = _userEmail ? Math.max(0, stepIndex - 1) : stepIndex;
  const isDesktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const trackerUnavailable = trackerStatus?.trackerMode === "unavailable";
  const trackerReady = Boolean(trackerStatus?.running) || trackerUnavailable;
  const accessibilityReady = accessibilityGranted || (!isDesktopRuntime && trackerUnavailable);
  const previousAccessibilityGrantedRef = useRef(accessibilityGranted);
  const notificationsReady =
    notificationPermission === "granted" || notificationPermission === "unavailable";
  const isFinalStep = stepIndex === ONBOARDING_STEPS.length - 1;

  const canAdvance = (() => {
    switch (step) {
      case "cloud_choice":
        return false;
      case "welcome":
        return true;
      case "work_profile":
        return Boolean(workType) && Boolean(workDomain);
      case "tracker":
        return trackerReady;
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
      case "tracker":
        return "Start the local tracker to continue.";
      case "accessibility":
        if (accessibilityRecheckPending) return "Checking Accessibility access.";
        return "Enable Accessibility to continue.";
      case "notifications":
        return "Allow Notifications to finish setup.";
      default:
        return null;
    }
  }, [accessibilityRecheckPending, canAdvance, step]);

  const title = useMemo(() => {
    switch (step) {
      case "cloud_choice":
        return "Choose how you want to start";
      case "welcome":
        return "Welcome to drifty";
      case "work_profile":
        return "Tell us about your work";
      case "tracker":
        return "Start your local timeline";
      case "accessibility":
        return "Enable Accessibility";
      case "notifications":
        return "Allow notifications";
    }
  }, [step]);

  useEffect(() => {
    onRefreshTrackerRef.current = onRefreshTracker;
  }, [onRefreshTracker]);

  useEffect(() => {
    onCheckAccessibilityRef.current = onCheckAccessibility;
  }, [onCheckAccessibility]);

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
    if (step !== "accessibility") {
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

  function completeOnboarding() {
    setStorageError(null);
    const result = saveUserOnboardingState({
      userId,
      displayName: "",
      workType,
      workTypeOther,
      workDomain,
      workDomainOther,
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
    const nextStep = ONBOARDING_STEPS[stepIndex + 1]?.id;
    if (nextStep) setStep(nextStep);
  }

  function goToPreviousStep() {
    const previousStep = ONBOARDING_STEPS[stepIndex - 1]?.id;
    if (previousStep) setStep(previousStep);
  }

  async function handleStartTrackerClick() {
    setSetupError(null);
    setStartingTracker(true);
    try {
      await onStartTracking();
      await onRefreshTracker();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to start the tracker.");
    } finally {
      setStartingTracker(false);
    }
  }

  async function handleRefreshTrackerClick() {
    setSetupError(null);
    try {
      await onRefreshTracker();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to refresh tracker status.");
    }
  }

  async function handleCheckAccessibilityClick() {
    setSetupError(null);
    setAccessibilityRecheckPending(true);
    try {
      await onCheckAccessibility();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to refresh Accessibility status.");
    } finally {
      setAccessibilityRecheckPending(false);
    }
  }

  async function handleRequestAccessibilityClick() {
    setSetupError(null);
    setOpeningSettingsPane("accessibility");
    try {
      await onRequestAccessibility();
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isFinalStep) {
      setStorageError(null);
      setSetupError(null);
      if (canAdvance) goToNextStep();
      return;
    }
    completeOnboarding();
  }

  const titleIsVisible = step !== "welcome";
  const progressPct = ((stepIndex + 1) / ONBOARDING_STEPS.length) * 100;

  return (
    <section
      ref={screenRef}
      className="onboarding-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-bg" aria-hidden="true">
        <div className="bg-panel bg-panel-1" />
        <div className="bg-panel bg-panel-2" />
        <div className="bg-panel bg-panel-3" />
        <div className="bg-panel bg-panel-4" />
        <div className="bg-panel bg-panel-5" />
        <div className="bg-panel bg-panel-6" />
      </div>

      <div className="onboarding-topbar">
        <img className="onboarding-logo onboarding-logo--image" src={wordmarkUrl} alt="drifty" />
        <div className="onboarding-progress-bar--full" aria-label="Setup progress">
          <div className="onboarding-progress-bar__fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="onboarding-content-area">
        <form className="onboarding-card" onSubmit={handleSubmit}>
          <h1
            className={`onboarding-title${titleIsVisible ? "" : " onb-visually-hidden"}`}
            id="onboarding-title"
            ref={titleRef}
            tabIndex={-1}
          >
            {title}
          </h1>

          <div className="onboarding-body">
            {step === "cloud_choice" ? (
              <div className="onb-cloud-choice" aria-label="Drifty setup options">
                <p className="onb-step-desc">
                  Start locally now. Add Drifty Cloud when you want AI classification, sync, profile features, or leaderboard publishing.
                </p>
                <button type="button" className="onb-choice-card onb-choice-card--primary" onClick={onStartCloudTrial}>
                  <span>Start Drifty Cloud trial</span>
                  <small>Try cloud AI and account features with Drifty-hosted Supabase.</small>
                </button>
                <button type="button" className="onb-choice-card" onClick={() => setStep("welcome")}>
                  <span>Use my own AI setup</span>
                  <small>You can connect a self-hosted or BYOK AI setup later from Settings → Drifty Cloud.</small>
                </button>
                <button type="button" className="onb-choice-card" onClick={() => setStep("welcome")}>
                  <span>Continue local-only without AI</span>
                  <small>Use local tracking now. Drifty Cloud and your own AI setup stay available later in Settings.</small>
                </button>
              </div>
            ) : null}

            {step === "welcome" ? (
              <div className="onb-welcome">
                <TypewriterSequence
                  key="welcome"
                  speed={18}
                  segments={[
                    { text: "Welcome to drifty", className: "tw-title" },
                    {
                      text:
                        "I'm your focus companion. I help you see where your time goes and stay with what matters.",
                      className: "tw-message",
                    },
                    { text: "Let's set a few things up. This takes about a minute.", className: "tw-sub" },
                  ]}
                />
              </div>
            ) : null}

            {step === "work_profile" ? (
              <>
                <Dropdown
                  options={WORK_TYPE_OPTIONS}
                  value={workType}
                  onChange={setWorkType}
                  placeholder="Your role…"
                  otherText={workTypeOther}
                  onOtherTextChange={setWorkTypeOther}
                  searchable
                  ariaLabel="Your role"
                />
                <Dropdown
                  options={WORK_DOMAIN_OPTIONS}
                  value={workDomain}
                  onChange={setWorkDomain}
                  placeholder="Your field…"
                  otherText={workDomainOther}
                  onOtherTextChange={setWorkDomainOther}
                  searchable
                  ariaLabel="Your field"
                />
              </>
            ) : null}

            {step === "tracker" ? (
              <>
                <span className={`onb-status-pill${trackerReady ? " onb-status-pill--ready" : ""}`}>
                  {trackerReady ? "Ready" : "Needs setup"}
                </span>
                <p className="onb-step-desc">
                  drifty builds your timeline from a local macOS tracker. Start it here, then the next step unlocks
                  once capture is running.
                </p>
                <div className="onb-setup-card__actions">
                  <button
                    type="button"
                    className="onb-button onb-button--primary"
                    onClick={() => void handleStartTrackerClick()}
                    disabled={startingTracker || trackerReady}
                  >
                    {startingTracker ? "Starting…" : trackerReady ? "Tracker ready" : "Start tracker"}
                  </button>
                  <button
                    type="button"
                    className="onb-button onb-button--ghost"
                    onClick={() => void handleRefreshTrackerClick()}
                  >
                    Check again
                  </button>
                </div>
                {trackerUnavailable ? (
                  <p className="onb-setup-card__note">Dev/browser preview can continue without the sidecar.</p>
                ) : null}
              </>
            ) : null}

            {step === "accessibility" ? (
              <>
                <span className={`onb-status-pill${accessibilityReady ? " onb-status-pill--ready" : ""}`}>
                  {accessibilityReady ? "Granted" : "Waiting"}
                </span>
                <p className="onb-step-desc">This lets drifty understand what you&apos;re working on.</p>
                {!accessibilityReady ? (
                  <ol className="onb-instructions" aria-label="Accessibility permission steps">
                    <li>Open System Settings → Privacy &amp; Security → Accessibility.</li>
                    <li>Enable drifty (or the terminal running it).</li>
                    <li>Return here — drifty detects it automatically.</li>
                  </ol>
                ) : null}
                {accessibilityJustGranted ? (
                  <p className="onb-setup-card__note">Detected automatically. Continue when you are ready.</p>
                ) : null}
                <div className="onb-setup-card__actions">
                  <button
                    type="button"
                    className="onb-button onb-button--primary"
                    onClick={() => void handleRequestAccessibilityClick()}
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
                    onClick={() => void handleCheckAccessibilityClick()}
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
                  drifty will only nudge you when a drift lasts long enough to matter.
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

          <div className="onb-actions">
            {step === "cloud_choice" ? (
              <span className="onb-actions__spacer" />
            ) : visibleStepIndex > 0 ? (
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
            {step === "cloud_choice" ? null : (
              <button type="submit" className="onb-button onb-button--primary" disabled={!canAdvance}>
                {isFinalStep ? "Finish setup" : "Next"}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
