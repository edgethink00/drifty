import type { CSSProperties } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import { PillBrandMark, PillDismissIcon } from "./CompanionPillIcons";

/**
 * The day review as the pill shows it: one slab per idea, densest last.
 *
 * Work hours answers "how did today go" before anything else; the ring breaks
 * that into focus, drift and other; the pair below names what a good stretch
 * looked like; top apps says where the time actually went.
 */

type RingStyle = CSSProperties & { "--seg"?: string };
type BarStyle = CSSProperties & { "--w"?: string; "--glyph"?: string };
type DonutRingStyle = CSSProperties & { background: string };

export function CompanionPillDayReview({
  event,
  onDismiss,
  onOpenDashboard,
}: {
  event: EndOfDayReviewEvent;
  onDismiss: () => void;
  onOpenDashboard: () => void;
}) {
  const totalSeconds = Math.max(0, event.totalSeconds);
  const focusSeconds = Math.max(0, event.focusSeconds);
  const driftSeconds = Math.max(0, event.driftSeconds);
  const otherSeconds = Math.max(0, totalSeconds - focusSeconds - driftSeconds);
  const focusPercent = totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
  const driftPercent = totalSeconds > 0 ? (driftSeconds / totalSeconds) * 100 : 0;
  const otherPercent = Math.max(0, 100 - focusPercent - driftPercent);
  const sources = (event.sourceSummaries ?? []).slice(0, 3);
  const topShare = sources[0]?.percent ?? 0;
  const signals = event.dailySignals;

  return (
    <>
      <div className="card__head">
        <span className="eod__heading">
          <span className="moment-brand moment-brand--heading" aria-hidden="true">
            <PillBrandMark />
          </span>
          Day review
          {event.highlightLabel ? <span className="eod__badge">{event.highlightLabel}</span> : null}
        </span>
        <button className="card__close" type="button" title="Dismiss" onClick={onDismiss}>
          <PillDismissIcon />
        </button>
      </div>

      <div className="eodv eodv--12" data-sensitive>
        <div className="eodv12b eodv12b--head">
          <span className="eodsec">Work hours</span>
          <b>{formatReviewClockDuration(focusSeconds)}</b>
          {event.comparison ? (
            <ReviewDelta seconds={event.comparison.focusDeltaSeconds} tone="good" suffix=" vs yesterday" />
          ) : null}
        </div>

        <div className="eodv12b eodv12__ringrow">
          <div className="eodv6__donut" aria-hidden="true">
            <i
              className="eodv6__ring"
              style={buildDonutRingStyle(focusPercent, driftPercent, otherPercent)}
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
              label="Other"
              seconds={otherSeconds}
              tone="var(--p-neutral)"
              deltaSeconds={event.comparison?.otherDeltaSeconds}
              deltaTone="flat"
            />
          </div>
        </div>

        {signals ? (
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
            <div className="eodsec">Top apps</div>
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
      </div>

      <div className="card__actions">
        <button className="act act--primary" type="button" onClick={onOpenDashboard}>
          See full day
        </button>
      </div>
    </>
  );
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

function buildDonutRingStyle(
  focusPercent: number,
  driftPercent: number,
  otherPercent: number,
): DonutRingStyle {
  const shares = [
    ["var(--p-focus)", focusPercent],
    ["var(--p-drift)", driftPercent],
    ["var(--p-neutral)", otherPercent],
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
