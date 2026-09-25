import { useCallback, useEffect, useRef, useState } from "react";
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
  readonly onOpenAiSetup?: () => void;
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
  onOpenAiSetup,
}: CloudTrialStartedNoticeProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [isTimerPaused, setIsTimerPaused] = useState(false);
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

  const setPauseSource = useCallback((source: "hover" | "focus", active: boolean) => {
    pauseSourcesRef.current = { ...pauseSourcesRef.current, [source]: active };
    if (active) {
      pauseDismissTimer();
      return;
    }
    if (!pauseSourcesRef.current.hover && !pauseSourcesRef.current.focus) resumeDismissTimer();
  }, [pauseDismissTimer, resumeDismissTimer]);

  useEffect(() => {
    if (isTimerPaused) return undefined;

    timerStartedAtRef.current = Date.now();
    timeoutIdRef.current = window.setTimeout(onDismiss, remainingDismissMsRef.current);
    return clearDismissTimer;
  }, [clearDismissTimer, isTimerPaused, onDismiss]);

  const isPromotion = notice.accessSource === "promotion";
  const headline = t(isPromotion ? "billing.trialNotice.promoHeadline" : "billing.trialNotice.trialHeadline");
  const detail = formatCloudTrialStartedDetail(notice.trialEndsAt, notice.accessSource, effectiveLanguage, t);

  return (
    <section
      className={isTimerPaused ? "cloud-trial-started-notice is-paused" : "cloud-trial-started-notice"}
      role="status"
      aria-label={t(isPromotion ? "billing.trialNotice.promoAria" : "billing.trialNotice.trialAria")}
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
      <span className="cloud-trial-started-notice__signal" aria-hidden="true">
        <span className="cloud-trial-started-notice__signal-dot" />
      </span>
      <span className="cloud-trial-started-notice__copy">
        <span className="cloud-trial-started-notice__eyebrow">{t("billing.trialNotice.eyebrow")}</span>
        <strong>{headline}</strong>
        <span>{detail}</span>
      </span>
      {onOpenAiSetup ? (
        <button
          type="button"
          className="app-btn app-btn--primary cloud-trial-started-notice__action"
          onClick={onOpenAiSetup}
        >
          {t("billing.trialNotice.action")}
        </button>
      ) : null}
      <button
        type="button"
        className="cloud-trial-started-notice__dismiss"
        aria-label={t("billing.trialNotice.dismiss")}
        onClick={onDismiss}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
        </svg>
      </button>
      <span
        className="cloud-trial-started-notice__timer"
        role="timer"
        aria-label={t("billing.trialNotice.timerAria")}
      />
    </section>
  );
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
