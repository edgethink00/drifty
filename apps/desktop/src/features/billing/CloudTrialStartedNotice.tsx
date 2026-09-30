import { useCallback, useEffect, useRef, useState, type AnimationEvent } from "react";
import type { BillingEntitlement } from "./billingService";
import { useLocalization } from "../localization/LocalizationContext";
import type { LocalizationController } from "../localization/LocalizationContext";
import "./CloudTrialStartedNotice.css";

const CLOUD_TRIAL_STARTED_NOTICE_STORAGE_PREFIX = "drifty:billing:trial-started-notice:v1";
const CLOUD_TRIAL_STARTED_NOTICE_AUTO_DISMISS_MS = 5_000;

export type CloudTrialStartedNoticeModel = {
  readonly accessSource: "standard_trial" | "promotion";
  readonly trialEndsAt: string | null;
};

type CloudTrialStartedNoticeProps = {
  readonly notice: CloudTrialStartedNoticeModel;
  readonly onDismiss: () => void;
};

export function getCloudTrialStartedNoticeStorageKey(
  userId: string,
  accessSource: CloudTrialStartedNoticeModel["accessSource"] = "standard_trial",
): string {
  return accessSource === "promotion"
    ? `${CLOUD_TRIAL_STARTED_NOTICE_STORAGE_PREFIX}:promotion:${userId}`
    : `${CLOUD_TRIAL_STARTED_NOTICE_STORAGE_PREFIX}:${userId}`;
}

export function buildCloudTrialStartedNotice(
  entitlement: BillingEntitlement | null,
): CloudTrialStartedNoticeModel | null {
  if (entitlement?.status !== "trialing" || !entitlement.canUseApp) return null;

  const accessSource = entitlement.accessSource === "promotion" ? "promotion" : "standard_trial";

  return {
    accessSource,
    trialEndsAt: entitlement.trialEndsAt,
  };
}

export function claimCloudTrialStartedNotice(
  userId: string,
  entitlement: BillingEntitlement | null,
): CloudTrialStartedNoticeModel | null {
  const notice = buildCloudTrialStartedNotice(entitlement);
  if (!notice) return null;

  const storageKey = getCloudTrialStartedNoticeStorageKey(userId, notice.accessSource);
  if (hasStoredTrialNotice(storageKey)) return null;
  storeTrialNotice(storageKey);
  return notice;
}

export function CloudTrialStartedNotice({
  notice,
  onDismiss,
}: CloudTrialStartedNoticeProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  // The card animates in and out instead of popping: hasEntered gates the
  // hover lift so it cannot fight the entrance, and isLeaving plays the exit
  // before the parent unmounts the notice.
  const [hasEntered, setHasEntered] = useState(isNoticeMotionReduced);
  const [isLeaving, setIsLeaving] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  // Mirrors isTimerPaused synchronously: hover and focus can both arrive
  // before React re-renders, and a stale "not paused" read would subtract the
  // same elapsed time twice from the remaining countdown.
  const isTimerPausedRef = useRef(false);
  const timeoutIdRef = useRef<number | null>(null);
  const timerStartedAtRef = useRef(Date.now());
  const remainingDismissMsRef = useRef(CLOUD_TRIAL_STARTED_NOTICE_AUTO_DISMISS_MS);
  // Pointer hover and keyboard focus both hold the notice open; it resumes
  // only once neither is inside it, so a keyboard user reaching the action
  // button does not lose the notice mid-read.
  const pauseSourcesRef = useRef({ hover: false, focus: false });

  const clearDismissTimer = useCallback(() => {
    if (timeoutIdRef.current === null) return;
    window.clearTimeout(timeoutIdRef.current);
    timeoutIdRef.current = null;
  }, []);

  const pauseDismissTimer = useCallback(() => {
    if (isTimerPausedRef.current) return;

    isTimerPausedRef.current = true;
    clearDismissTimer();
    remainingDismissMsRef.current = Math.max(0, remainingDismissMsRef.current - (Date.now() - timerStartedAtRef.current));
    setIsTimerPaused(true);
  }, [clearDismissTimer]);

  const resumeDismissTimer = useCallback(() => {
    if (!isTimerPausedRef.current) return;
    isTimerPausedRef.current = false;
    setIsTimerPaused(false);
  }, []);

  const requestLeave = useCallback(() => {
    clearDismissTimer();
    // Reduced motion removes the exit animation entirely, so there is no exit
    // to wait for; dismiss immediately instead of holding a static card.
    if (isNoticeMotionReduced()) {
      onDismiss();
      return;
    }
    setIsLeaving(true);
  }, [clearDismissTimer, onDismiss]);

  const setPauseSource = useCallback((source: "hover" | "focus", active: boolean) => {
    pauseSourcesRef.current = { ...pauseSourcesRef.current, [source]: active };
    if (active) {
      pauseDismissTimer();
      return;
    }
    if (!pauseSourcesRef.current.hover && !pauseSourcesRef.current.focus) resumeDismissTimer();
  }, [pauseDismissTimer, resumeDismissTimer]);

  useEffect(() => {
    if (isTimerPaused || isLeaving) return undefined;

    timerStartedAtRef.current = Date.now();
    timeoutIdRef.current = window.setTimeout(requestLeave, remainingDismissMsRef.current);
    return clearDismissTimer;
  }, [clearDismissTimer, isLeaving, isTimerPaused, requestLeave]);

  // animationend is the fast path; the timeout covers a DOM that never runs
  // stylesheet animations (jsdom) or a superseded animation, so dismissal
  // always lands. CSS owns the budget — see floating-notice-leave.
  useEffect(() => {
    if (!isLeaving) return undefined;
    const timer = window.setTimeout(onDismiss, leaveFallbackMs(rootRef.current));
    return () => window.clearTimeout(timer);
  }, [isLeaving, onDismiss]);

  const handleAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.animationName === "floating-notice-enter") {
      setHasEntered(true);
      return;
    }
    if (event.animationName === "floating-notice-leave") onDismiss();
  };

  const isPromotion = notice.accessSource === "promotion";
  const headline = t(isPromotion ? "billing.trialNotice.promoHeadline" : "billing.trialNotice.trialHeadline");
  const detail = formatCloudTrialStartedDetail(notice.trialEndsAt, notice.accessSource, effectiveLanguage, t);
  const className = [
    "cloud-trial-started-notice",
    isLeaving ? "is-leaving" : hasEntered ? "is-settled" : "is-entering",
    isTimerPaused ? "is-paused" : "",
  ].filter(Boolean).join(" ");

  return (
    <section
      ref={rootRef}
      className={className}
      role="status"
      aria-label={t(isPromotion ? "billing.trialNotice.promoAria" : "billing.trialNotice.trialAria")}
      onAnimationEnd={handleAnimationEnd}
      onMouseEnter={() => setPauseSource("hover", true)}
      onMouseLeave={() => setPauseSource("hover", false)}
      onFocus={() => setPauseSource("focus", true)}
      onBlur={(event) => {
        // Focus moving between the notice's own buttons keeps it held.
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        // Switching to another app blurs the focused button without moving
        // focus out of the notice; it returns there when the window does.
        if (!document.hasFocus()) return;
        setPauseSource("focus", false);
      }}
    >
      <span className="cloud-trial-started-notice__copy">
        <strong>{headline}</strong>
        <span className="cloud-trial-started-notice__detail">{detail}</span>
      </span>
      <button
        type="button"
        className="cloud-trial-started-notice__dismiss"
        aria-label={t("billing.trialNotice.dismiss")}
        onClick={requestLeave}
      >
        <svg className="cloud-trial-started-notice__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
          <circle className="cloud-trial-started-notice__ring-track" cx="14" cy="14" r="11" />
          <circle className="cloud-trial-started-notice__ring-progress" cx="14" cy="14" r="11" />
        </svg>
        <span className="cloud-trial-started-notice__dismiss-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
          </svg>
        </span>
      </button>
      <span
        className="sr-only"
        role="timer"
        aria-label={t("billing.trialNotice.timerAria")}
      />
    </section>
  );
}

function isNoticeMotionReduced(): boolean {
  return typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

// CSS owns the exit timing; read it back rather than duplicating the number,
// matching AnchoredPresence/ModalPresence.
function leaveFallbackMs(root: HTMLElement | null): number {
  if (!root) return 220;
  const style = window.getComputedStyle(root);
  const milliseconds = (value: string) =>
    value.trim().endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;
  const durations = style.animationDuration.split(",").map(milliseconds);
  const delays = style.animationDelay.split(",").map(milliseconds);
  const longest = Math.max(0, ...durations
    .map((duration, index) => duration + (delays[index % delays.length] || 0))
    .filter(Number.isFinite));
  // jsdom has no stylesheet timing; browser zero-motion styles remove quickly.
  return style.animationDuration ? longest + 80 : 220;
}

export function formatCloudTrialStartedDetail(
  trialEndsAt: string | null,
  accessSource: CloudTrialStartedNoticeModel["accessSource"],
  language: "en" | "ko",
  t: LocalizationController["t"],
): string {
  // Each variant owns a whole sentence rather than a subject slot: Korean
  // particles ("를"/"을") depend on the final consonant of the noun, so
  // interpolating a subject into one shared template produces wrong grammar.
  const isPromotion = accessSource === "promotion";
  const endDate = trialEndsAt ? new Date(trialEndsAt) : null;
  if (!endDate || Number.isNaN(endDate.getTime())) {
    return t(isPromotion ? "billing.trialNotice.promoWhileActive" : "billing.trialNotice.trialWhileActive");
  }

  const date = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    month: language === "ko" ? "long" : "short",
    day: "numeric",
  }).format(endDate);
  return t(isPromotion ? "billing.trialNotice.promoUntil" : "billing.trialNotice.trialUntil", { date });
}

function hasStoredTrialNotice(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

function storeTrialNotice(storageKey: string): void {
  try {
    window.localStorage.setItem(storageKey, "1");
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}
