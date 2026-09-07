import type { CSSProperties } from "react";
import { AppGlyph } from "../../components/AppGlyph";
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
 * A "vs yesterday" delta used to ride on the head. It was only ever populated
 * by the Dev mock, so production never showed it and the row does without.
 */

type RingStyle = CSSProperties & { "--seg"?: string };
type BarStyle = CSSProperties & { "--w"?: string; "--glyph"?: string };
type DonutRingStyle = CSSProperties & { background: string };

export function CompanionPillDayReview({
  event,
  onDismiss,
  onOpenDashboard,
  onOpenAiSettings,
}: {
  event: EndOfDayReviewEvent;
  onDismiss: () => void;
  onOpenDashboard: () => void;
  onOpenAiSettings?: () => void;
}) {
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
  const longestRun = signals?.longestFocusRunSeconds ?? 0;
  const longestRunStart = signals?.longestFocusRunStartedAt ? new Date(signals.longestFocusRunStartedAt) : null;
  const longestRunStartLabel = longestRunStart && Number.isFinite(longestRunStart.getTime())
    ? formatClockShort(longestRunStart)
    : null;

  return (
    <>
      <div className="card__head">
        <span className="eod__heading">
          <span className="moment-brand moment-brand--heading" aria-hidden="true">
            <PillBrandMark />
          </span>
          Day review
          {pendingAssessment ? <span className="eod__badge">AI disconnected</span> : null}
          {!pendingAssessment && event.highlightLabel ? <span className="eod__badge">{event.highlightLabel}</span> : null}
        </span>
        <button className="card__close" type="button" title="Dismiss" onClick={onDismiss}>
          <PillDismissIcon />
        </button>
      </div>

      <div className="eodv eodv--12" data-sensitive>
        {pendingAssessment ? (
          <div className="eodv12b eodv12b--head">
            <span className="eodsec">Tracked time</span>
            <b>{formatReviewClockDuration(totalSeconds)}</b>
          </div>
        ) : (
          <div className="eodv12__split">
            <div className="eodv12b eodv12b--head eodv12b--split" data-tone="focus">
              <span className="eodsec">Focus</span>
              <b>{formatReviewClockDuration(focusSeconds)}</b>
              <em className="eodv12__sub">of {formatReviewClockDuration(totalSeconds)} tracked</em>
            </div>
            <div className="eodv12b eodv12b--head eodv12b--split">
              <span className="eodsec">Longest streak</span>
              <b>{formatReviewClockDuration(longestRun)}</b>
              <em className="eodv12__sub">
                {longestRun > 0
                  ? (longestRunStartLabel ? `from ${longestRunStartLabel}` : "focus without a break")
                  : "no focus run yet"}
              </em>
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
            <div className="eodv12__cats">
              <CategoryRow
                label="Focus"
                seconds={focusSeconds}
                tone="var(--p-focus)"
                deltaSeconds={event.comparison?.focusDeltaSeconds}
                deltaTone="good"
              />
              <CategoryRow
                label="Drift"
                seconds={driftSeconds}
                tone="var(--p-drift)"
                deltaSeconds={event.comparison?.driftDeltaSeconds}
                deltaTone="good"
              />
              <CategoryRow
                label="Neutral"
                seconds={neutralSeconds}
                tone="var(--p-neutral)"
                deltaSeconds={event.comparison?.otherDeltaSeconds}
                deltaTone="flat"
              />
            </div>
          </div>
        ) : null}

        {!pendingAssessment && signals ? (
          <div className="eodv12__duo">
            <div className="eodv12b">
              <span>Deep sessions</span>
              <b>{signals.deepSessionCount}</b>
              <i className="eod__delta" data-delta={signals.deepSessionCount > 0 ? "good" : "flat"}>
                {signals.deepSessionCount > 0
                  ? `45m+ each · best ${formatReviewClockDuration(signals.longestFocusRunSeconds)}`
                  : "No 45m+ runs"}
              </i>
            </div>
            <div className="eodv12b">
              <span>Peak hour</span>
              <b>{signals.peakHourLabel ?? "—"}</b>
              <i className="eod__delta" data-delta="flat">
                {signals.peakHourFocusSeconds > 0
                  ? `${formatFocusedMinutes(signals.peakHourFocusSeconds)} focused`
                  : "No focus yet"}
              </i>
            </div>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="eodv12b eodv12b--apps">
            <div className="eodsec eodv12__apps-heading">
              <span>Top apps</span>
              {pendingAssessment ? (
                <button className="eodv12__apps-link" type="button" onClick={onOpenDashboard}>
                  See tracked day
                </button>
              ) : null}
            </div>
            <div className="eodv12__apps">
              {sources.map((source, index) => {
                const relative = topShare > 0 ? Math.round((source.percent / topShare) * 100) : 0;
                return (
                  <div className="eodapp" key={`${source.appName}-${index}`}>
                    <span className="eodapp__rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="eodapp__glyph">
                      <AppGlyph appName={source.appName} iconSrc={source.iconSrc ?? undefined} size="sm" />
                    </span>
                    <span className="eodapp__name">{source.appName}</span>
                    <span className="eodapp__bar" style={{ "--w": `${relative}%` } as BarStyle}>
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

        {pendingAssessment ? (
          <div
            className="eodv12b eodv12__pending"
            data-tone={pendingAssessment.reason === "cloud_trial_expired" ? "trial-ended" : undefined}
          >
            <div className="eodv12__pending-head">
              <b>{pendingAssessmentTitle(pendingAssessment.reason)}</b>
              {onOpenAiSettings ? (
                <button className="act act--primary eodv12__pending-action" type="button" onClick={onOpenAiSettings}>
                  {pendingAssessmentActionLabel(pendingAssessment.reason)}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {!pendingAssessment ? (
        <div className="card__actions">
          <button className="act act--primary" type="button" onClick={onOpenDashboard}>
            See full day
          </button>
        </div>
      ) : null}
    </>
  );
}

function pendingAssessmentTitle(reason: NonNullable<EndOfDayReviewEvent["assessment"]>["reason"]): string {
  if (reason === "cloud_trial_expired") return "Your Pro trial ended";
  if (reason === "cloud_payment_required" || reason === "cloud_billing_missing") return "Cloud classification needs attention";
  if (reason === "provider_not_configured" || reason === "cloud_not_configured") return "Connect AI to finish this review";
  return "AI disconnected before the day was classified";
}

function pendingAssessmentActionLabel(reason: string): string {
  if (reason === "cloud_trial_expired" || reason === "cloud_payment_required" || reason === "cloud_billing_missing") {
    return "Upgrade to Pro";
  }
  return "AI settings";
}

function CategoryRow({
  label,
  seconds,
  tone,
  deltaSeconds,
  deltaTone,
}: {
  label: string;
  seconds: number;
  tone: string;
  deltaSeconds?: number;
  deltaTone: "good" | "flat";
}) {
  return (
    <div className="eod__row" style={{ "--seg": tone } as RingStyle}>
      <span>{label}</span>
      <b>{formatReviewClockDuration(seconds)}</b>
      {typeof deltaSeconds === "number" ? (
        <ReviewDelta seconds={deltaSeconds} tone={deltaTone} />
      ) : null}
    </div>
  );
}

function ReviewDelta({
  seconds,
  tone,
  suffix = "",
}: {
  seconds: number;
  tone: "good" | "flat";
  suffix?: string;
}) {
  const direction = seconds < 0 ? "▼" : "▲";
  return (
    <i className="eod__delta" data-delta={tone}>
      {direction}{formatFocusedMinutes(Math.abs(seconds))}{suffix}
    </i>
  );
}

function formatFocusedMinutes(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function formatReviewClockDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/** 09:00 → "9:00 AM", 14:05 → "2:05 PM"; minutes matter for a streak start. */
function formatClockShort(date: Date): string {
  const hour = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minutes} ${suffix}`;
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
    stops.push(`${color} ${cursor.toFixed(2)}% ${colorEnd.toFixed(2)}%`);
    stops.push(`transparent ${colorEnd.toFixed(2)}% ${end.toFixed(2)}%`);
    cursor = end;
  }
  if (cursor < 100) stops.push(`transparent ${cursor.toFixed(2)}% 100%`);
  return { background: `conic-gradient(${stops.join(", ")})` };
}
