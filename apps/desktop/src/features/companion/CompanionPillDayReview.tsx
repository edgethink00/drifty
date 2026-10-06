import type { CSSProperties } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { isQuietCloudPause } from "../classification/classificationAvailability";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import { PillBrandMark, PillDismissIcon } from "./CompanionPillIcons";

/**
 * The day review as the pill shows it: one slab per idea, densest last.
 *
 * The head row is two short slabs: Focus, captioned with the tracked total so
 * a thin day reads "0:03 of 0:12 tracked" instead of lying, and Longest
 * streak, the same word the resident pill shows all day, captioned with the
 * minute that run began. The ring then breaks the total into focus, drift and
 * neutral; time the AI has not rated yet folds into neutral rather than
 * appearing as a fourth kind of time (that is a system state, not a way the
 * day was spent). The pair below names what a good stretch looked like; top
 * apps says where the time actually went.
 *
 * When yesterday was watched long enough, each ring row carries its change
 * against the day before at the same time of day. Only the direction that is
 * better (more focus, less drift) takes the accent; neutral time never does.
 */

type RingStyle = CSSProperties & { "--seg"?: string };
type BarStyle = CSSProperties & { "--w"?: string; "--glyph"?: string };
type DonutRingStyle = CSSProperties & { background: string };


function pendingAssessmentBadgeKey(reason?: string): TranslationKey {
  if (reason === "cloud_quota_exceeded") return "companion.dayReview.dailyLimitReached";
  if (reason === "cloud_trial_expired") return "companion.dayReview.trialEnded";
  if (reason === "provider_checking" || reason === "cloud_entitlement_checking") {
    return "companion.dayReview.checking";
  }
  return "companion.dayReview.aiDisconnected";
}

export function CompanionPillDayReview({
  event,
  onDismiss,
  onOpenDashboard,
  onOpenAiSettings,
  onUpgrade,
}: {
  event: EndOfDayReviewEvent;
  onDismiss: () => void;
  onOpenDashboard: () => void;
  onOpenAiSettings?: () => void;
  onUpgrade?: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const totalSeconds = Math.max(0, event.totalSeconds);
  const focusSeconds = Math.max(0, event.focusSeconds);
  const driftSeconds = Math.max(0, event.driftSeconds);
  const neutralSeconds = Math.max(0, totalSeconds - focusSeconds - driftSeconds);
  const focusPercent = totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
  const focusShare = totalSeconds > 0 ? (focusSeconds / totalSeconds) * 100 : 0;
  const driftShare = totalSeconds > 0 ? (driftSeconds / totalSeconds) * 100 : 0;
  const neutralShare = totalSeconds > 0 ? (neutralSeconds / totalSeconds) * 100 : 0;
  const sources = (event.sourceSummaries ?? []).slice(0, 3);
  const topShare = sources[0]?.percent ?? 0;
  const signals = event.dailySignals;
  const pendingAssessment = event.assessment?.state === "pending" ? event.assessment : null;
  const quietPause = pendingAssessment !== null && isQuietCloudPause(pendingAssessment);
  const pendingAction = pendingAssessment?.recoveryAction === "upgrade" && onUpgrade ? onUpgrade : onOpenAiSettings;
  const pendingActionLabel = pendingAssessment?.recoveryAction === "upgrade" && onUpgrade ? t("sidebar.cta.upgrade.action") : t("account.aiSettings");
  const longestRun = signals?.longestFocusRunSeconds ?? 0;
  const longestRunStart = signals?.longestFocusRunStartedAt ? new Date(signals.longestFocusRunStartedAt) : null;
  const longestRunStartLabel = longestRunStart && Number.isFinite(longestRunStart.getTime())
    ? formatClockShort(longestRunStart, effectiveLanguage)
    : null;
  const trackedDuration = formatReviewClockDuration(totalSeconds);
  const comparison = event.comparison;
  const comparisonLabel = comparison
    ? t(comparison.scope === "wholeDay" ? "companion.dayReview.vsDayBeforeWhole" : "companion.dayReview.vsDayBefore")
    : undefined;
  const longestCaption = longestRun > 0
    ? (longestRunStartLabel
      ? t("companion.dayReview.fromTime", { time: longestRunStartLabel })
      : t("companion.dayReview.unbrokenFocus"))
    : t("companion.dayReview.noFocusRun");

  return (
    <>
      <div className="card__head" data-locale={effectiveLanguage}>
        <span className="eod__heading">
          <span className="moment-brand moment-brand--heading" aria-hidden="true">
            <PillBrandMark />
          </span>
          {t("companion.dayReview.title")}
          {pendingAssessment && !quietPause ? <span className="eod__badge">{t(pendingAssessmentBadgeKey(pendingAssessment.reason))}</span> : null}
          {!pendingAssessment && event.highlightLabel ? <span className="eod__badge">{event.highlightLabel}</span> : null}
        </span>
        <button className="card__close" type="button" title={t("companion.dayReview.dismiss")} onClick={onDismiss}>
          <PillDismissIcon />
        </button>
      </div>

      <div className="eodv eodv--12" data-sensitive data-locale={effectiveLanguage}>
        {pendingAssessment ? (
          <div className="eodv12b eodv12b--head">
            <span className="eodsec">{t("companion.dayReview.trackedTime")}</span>
            <b>{trackedDuration}</b>
          </div>
        ) : (
          <div className="eodv12__split">
            <div className="eodv12b eodv12b--head eodv12b--split" data-tone="focus">
              <span className="eodsec">{t("activity.productivity.focus")}</span>
              <b>{formatReviewClockDuration(focusSeconds)}</b>
              <em className="eodv12__sub">{t("companion.dayReview.trackedOf", { duration: trackedDuration })}</em>
            </div>
            <div className="eodv12b eodv12b--head eodv12b--split">
              <span className="eodsec">{t("companion.dayReview.longestStreak")}</span>
              <b>{formatReviewClockDuration(longestRun)}</b>
              <em className="eodv12__sub">{longestCaption}</em>
            </div>
          </div>
        )}

        {!pendingAssessment ? (
          <div className="eodv12b eodv12__ringrow">
            <div className="eodv6__donut" aria-hidden="true">
              <i
                className="eodv6__ring"
                style={buildDonutRingStyle(focusShare, driftShare, neutralShare)}
              />
              <b>
                {focusPercent}
                <span>%</span>
              </b>
            </div>
            <div className="eodv12__cats" data-compare={comparison ? "" : undefined}>
              <CategoryRow
                label={t("activity.productivity.focus")}
                seconds={focusSeconds}
                tone="var(--p-focus)"
                deltaSeconds={comparison?.focusDeltaSeconds}
                better="higher"
                comparisonLabel={comparisonLabel}
                language={effectiveLanguage}
              />
              <CategoryRow
                label={t("activity.productivity.drift")}
                seconds={driftSeconds}
                tone="var(--p-drift)"
                deltaSeconds={comparison?.driftDeltaSeconds}
                better="lower"
                comparisonLabel={comparisonLabel}
                language={effectiveLanguage}
              />
              <CategoryRow
                label={t("activity.productivity.neutral")}
                seconds={neutralSeconds}
                tone="var(--p-neutral)"
                deltaSeconds={comparison?.otherDeltaSeconds}
                better="none"
                comparisonLabel={comparisonLabel}
                language={effectiveLanguage}
              />
            </div>
          </div>
        ) : null}

        {!pendingAssessment && signals ? (
          <div className="eodv12__duo">
            <div className="eodv12b">
              <span>{t("companion.dayReview.deepSessions")}</span>
              <b>{signals.deepSessionCount}</b>
              <i className="eod__delta" data-delta={signals.deepSessionCount > 0 ? "good" : "flat"}>
                {signals.deepSessionCount > 0
                  ? t("companion.dayReview.deepSessionsDetail", {
                    duration: formatReviewClockDuration(signals.longestFocusRunSeconds),
                  })
                  : t("companion.dayReview.deepSessionsEmpty")}
              </i>
            </div>
            <div className="eodv12b">
              <span>{t("companion.dayReview.peakHour")}</span>
              <b>{signals.peakHourLabel ?? "—"}</b>
              <i className="eod__delta" data-delta="flat">
                {signals.peakHourFocusSeconds > 0
                  ? t("companion.dayReview.peakHourFocused", {
                    duration: formatFocusedMinutes(signals.peakHourFocusSeconds, effectiveLanguage),
                  })
                  : t("companion.dayReview.peakHourEmpty")}
              </i>
            </div>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="eodv12b eodv12b--apps">
            <div className="eodsec eodv12__apps-heading">
              <span>{t("companion.dayReview.topApps")}</span>
              {pendingAssessment ? (
                <button className="eodv12__apps-link" type="button" onClick={onOpenDashboard}>
                  {t("companion.dayReview.seeTrackedDay")}
                </button>
              ) : null}
            </div>
            <div className="eodv12__apps">
              {sources.map((source, index) => {
                const relative = topShare > 0 ? Math.round((source.percent / topShare) * 100) : 0;
                return (
                  <div className="eodapp" key={source.appName + "-" + index}>
                    <span className="eodapp__rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="eodapp__glyph">
                      <AppGlyph appName={source.appName} iconSrc={source.iconSrc ?? undefined} size="sm" />
                    </span>
                    <span className="eodapp__name">{source.appName}</span>
                    <span className="eodapp__bar" style={{ "--w": relative + "%" } as BarStyle}>
                      <i />
                    </span>
                    <span className="eodapp__time">{formatReviewClockDuration(source.durationSeconds)}</span>
                    <span className="eodapp__share">{source.percent}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {pendingAssessment && !quietPause ? (
          <div
            className="eodv12b eodv12__pending"
            data-tone={pendingAssessment.reason === "cloud_trial_expired" || pendingAssessment.reason === "cloud_quota_exceeded" ? "trial-ended" : undefined}
          >
            <div className="eodv12__pending-head">
              <b>{t(pendingAssessmentTitleKey(pendingAssessment.reason))}</b>
              {pendingAction ? (
                <button
                  className="act act--primary eodv12__pending-action"
                  type="button"
                  onClick={pendingAction}
                >
                  {pendingActionLabel}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {!pendingAssessment || quietPause ? (
        <div className="card__actions" data-locale={effectiveLanguage}>
          <button className="act act--primary" type="button" onClick={onOpenDashboard}>
            {t("companion.dayReview.seeFullDay")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function pendingAssessmentTitleKey(reason: NonNullable<EndOfDayReviewEvent["assessment"]>["reason"]): TranslationKey {
  if (reason === "cloud_quota_exceeded") return "companion.dayReview.pending.quotaExceeded";
  if (reason === "cloud_trial_expired") return "companion.dayReview.pending.trialEnded";
  if (reason === "cloud_payment_required" || reason === "cloud_billing_missing") {
    return "companion.dayReview.pending.cloudNeedsAttention";
  }
  if (reason === "provider_not_configured" || reason === "cloud_not_configured") {
    return "companion.dayReview.pending.connectAi";
  }
  return "companion.dayReview.pending.disconnected";
}

function CategoryRow({
  label,
  seconds,
  tone,
  deltaSeconds,
  better,
  language,
  comparisonLabel,
}: {
  label: string;
  seconds: number;
  tone: string;
  deltaSeconds?: number;
  /** Which direction of change is the good one for this row. */
  better: "higher" | "lower" | "none";
  language: LocalizationController["effectiveLanguage"];
  /** What the change is measured against, for the tooltip and assistive name. */
  comparisonLabel?: string;
}) {
  const deltaTone = typeof deltaSeconds === "number" && deltaSeconds !== 0
    && ((better === "higher" && deltaSeconds > 0) || (better === "lower" && deltaSeconds < 0))
    ? "good" as const
    : "flat" as const;
  return (
    <div className="eod__row" style={{ "--seg": tone } as RingStyle}>
      <span>{label}</span>
      <b>{formatReviewClockDuration(seconds)}</b>
      {/* Under a minute of change reads as "no change": an empty cell keeps the columns aligned. */}
      {typeof deltaSeconds === "number" ? (Math.abs(deltaSeconds) >= 60
        ? <ReviewDelta seconds={deltaSeconds} tone={deltaTone} language={language} title={comparisonLabel} />
        : <i className="eod__delta" aria-hidden="true" />) : null}
    </div>
  );
}

function ReviewDelta({
  seconds,
  tone,
  language,
  suffix = "",
  title,
}: {
  seconds: number;
  tone: "good" | "flat";
  language: LocalizationController["effectiveLanguage"];
  suffix?: string;
  title?: string;
}) {
  const direction = seconds < 0 ? "▼" : "▲";
  return (
    <i className="eod__delta" data-delta={tone} title={title}>
      {direction}{formatFocusedMinutes(Math.abs(seconds), language)}{suffix}
    </i>
  );
}

function formatFocusedMinutes(seconds: number, language: LocalizationController["effectiveLanguage"]): string {
  if (language === "ko") return formatLocalizedCompactDurationFromSeconds(seconds, language);
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? hours + "h" : hours + "h " + remainder + "m";
}

function formatReviewClockDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return hours + ":" + String(minutes).padStart(2, "0");
}

/** 09:00 → "9:00 AM", 14:05 → "2:05 PM"; minutes matter for a streak start. */
function formatClockShort(date: Date, language: LocalizationController["effectiveLanguage"]): string {
  const hour = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  if (language === "ko") return (hour < 12 ? "오전 " : "오후 ") + hour12 + ":" + minutes;
  const suffix = hour < 12 ? "AM" : "PM";
  return hour12 + ":" + minutes + " " + suffix;
}

function buildDonutRingStyle(
  focusPercent: number,
  driftPercent: number,
  neutralPercent: number,
): DonutRingStyle {
  const shares = [
    ["var(--p-focus)", focusPercent],
    ["var(--p-drift)", driftPercent],
    ["var(--p-neutral)", neutralPercent],
  ] as const;
  let cursor = 0;
  const stops: string[] = [];
  for (const [color, rawShare] of shares) {
    const share = Math.max(0, rawShare);
    const end = Math.min(100, cursor + share);
    const gap = Math.min(1.4, share * 0.24);
    const colorEnd = Math.max(cursor, end - gap);
    stops.push(color + " " + cursor.toFixed(2) + "% " + colorEnd.toFixed(2) + "%");
    stops.push("transparent " + colorEnd.toFixed(2) + "% " + end.toFixed(2) + "%");
    cursor = end;
  }
  if (cursor < 100) stops.push("transparent " + cursor.toFixed(2) + "% 100%");
  return { background: "conic-gradient(" + stops.join(", ") + ")" };
}
