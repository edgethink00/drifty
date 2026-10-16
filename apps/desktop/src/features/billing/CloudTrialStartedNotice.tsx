import { useFloatingNotice } from "../../components/useFloatingNotice";
import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import type { BillingEntitlement } from "./billingService";
import { useLocalization } from "../localization/LocalizationContext";
import type { LocalizationController } from "../localization/LocalizationContext";
import { localeForDisplayLanguage } from "../../lib/formatting";
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
  const { rootRef, hasEntered, isLeaving, isTimerPaused, requestLeave, handlers } = useFloatingNotice(onDismiss, CLOUD_TRIAL_STARTED_NOTICE_AUTO_DISMISS_MS);

  const isPromotion = notice.accessSource === "promotion";
  const headline = t(isPromotion ? "billing.trialNotice.promoHeadline" : "billing.trialNotice.trialHeadline");
  const detail = formatCloudTrialStartedDetail(notice.trialEndsAt, notice.accessSource, effectiveLanguage, t);
  const className = [
    "cloud-trial-started-notice",
    isLeaving ? "is-leaving" : hasEntered ? "is-settled" : "is-entering",
    isTimerPaused ? "is-paused" : "",
  ].filter(Boolean).join(" ");

  return (
    <FloatingNoticePortal><section
      ref={rootRef}
      className={className}
      role="status"
      aria-label={t(isPromotion ? "billing.trialNotice.promoAria" : "billing.trialNotice.trialAria")}
      {...handlers}
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
    </section></FloatingNoticePortal>
  );
}

export function formatCloudTrialStartedDetail(
  trialEndsAt: string | null,
  accessSource: CloudTrialStartedNoticeModel["accessSource"],
  language: "en" | "ko" | "es",
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

  const date = new Intl.DateTimeFormat(localeForDisplayLanguage(language), {
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
