import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingEntitlement } from "./billingService";
import "./CloudTrialStartedNotice.css";

const CLOUD_TRIAL_STARTED_NOTICE_STORAGE_PREFIX = "drifty:billing:trial-started-notice:v1";
const CLOUD_TRIAL_STARTED_NOTICE_AUTO_DISMISS_MS = 5_000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type CloudTrialStartedNoticeModel = {
  readonly trialEndsAt: string | null;
  readonly detail: string;
};

type CloudTrialStartedNoticeProps = {
  readonly notice: CloudTrialStartedNoticeModel;
  readonly onDismiss: () => void;
  readonly onOpenAiSetup?: () => void;
};

export function getCloudTrialStartedNoticeStorageKey(userId: string): string {
  return `${CLOUD_TRIAL_STARTED_NOTICE_STORAGE_PREFIX}:${userId}`;
}

export function buildCloudTrialStartedNotice(
  entitlement: BillingEntitlement | null,
): CloudTrialStartedNoticeModel | null {
  if (entitlement?.status !== "trialing" || !entitlement.canUseApp) return null;

  return {
    trialEndsAt: entitlement.trialEndsAt,
    detail: formatCloudTrialStartedDetail(entitlement.trialEndsAt),
  };
}

export function claimCloudTrialStartedNotice(
  userId: string,
  entitlement: BillingEntitlement | null,
): CloudTrialStartedNoticeModel | null {
  const notice = buildCloudTrialStartedNotice(entitlement);
  if (!notice) return null;

  const storageKey = getCloudTrialStartedNoticeStorageKey(userId);
  if (hasStoredTrialNotice(storageKey)) return null;
  storeTrialNotice(storageKey);
  return notice;
}

export function CloudTrialStartedNotice({
  notice,
  onDismiss,
  onOpenAiSetup,
}: CloudTrialStartedNoticeProps) {
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const timeoutIdRef = useRef<number | null>(null);
  const timerStartedAtRef = useRef(Date.now());
  const remainingDismissMsRef = useRef(CLOUD_TRIAL_STARTED_NOTICE_AUTO_DISMISS_MS);

  const clearDismissTimer = useCallback(() => {
    if (timeoutIdRef.current === null) return;
    window.clearTimeout(timeoutIdRef.current);
    timeoutIdRef.current = null;
  }, []);

  const pauseDismissTimer = useCallback(() => {
    if (isTimerPaused) return;

    clearDismissTimer();
    remainingDismissMsRef.current = Math.max(0, remainingDismissMsRef.current - (Date.now() - timerStartedAtRef.current));
    setIsTimerPaused(true);
  }, [clearDismissTimer, isTimerPaused]);

  const resumeDismissTimer = useCallback(() => {
    if (!isTimerPaused) return;
    setIsTimerPaused(false);
  }, [isTimerPaused]);

  useEffect(() => {
    if (isTimerPaused) return undefined;

    timerStartedAtRef.current = Date.now();
    timeoutIdRef.current = window.setTimeout(onDismiss, remainingDismissMsRef.current);
    return clearDismissTimer;
  }, [clearDismissTimer, isTimerPaused, onDismiss]);

  return (
    <section
      className={isTimerPaused ? "cloud-trial-started-notice is-paused" : "cloud-trial-started-notice"}
      role="status"
      aria-label="Drifty Cloud trial started"
      onMouseEnter={pauseDismissTimer}
      onMouseLeave={resumeDismissTimer}
    >
      <span className="cloud-trial-started-notice__signal" aria-hidden="true">
        <span className="cloud-trial-started-notice__signal-dot" />
      </span>
      <span className="cloud-trial-started-notice__copy">
        <span className="cloud-trial-started-notice__eyebrow">Drifty Cloud</span>
        <strong>1-week free trial has started</strong>
        <span>{notice.detail}</span>
      </span>
      {onOpenAiSetup ? (
        <button
          type="button"
          className="settings-btn settings-btn--primary cloud-trial-started-notice__action"
          onClick={onOpenAiSetup}
        >
          AI setup
        </button>
      ) : null}
      <button
        type="button"
        className="cloud-trial-started-notice__dismiss"
        aria-label="Dismiss trial notice"
        onClick={onDismiss}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
        </svg>
      </button>
      <span
        className="cloud-trial-started-notice__timer"
        role="timer"
        aria-label="Trial notice closes in 5 seconds"
      />
    </section>
  );
}

export function formatCloudTrialStartedDetail(trialEndsAt: string | null): string {
  if (!trialEndsAt) return "Hosted Cloud AI is available while your trial is active.";

  const endDate = new Date(trialEndsAt);
  if (Number.isNaN(endDate.getTime())) return "Hosted Cloud AI is available while your trial is active.";

  const month = MONTH_LABELS[endDate.getMonth()] ?? "soon";
  return `Hosted Cloud AI is available until ${month} ${endDate.getDate()}.`;
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
