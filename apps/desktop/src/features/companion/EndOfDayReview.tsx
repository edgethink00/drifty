import { useState, type CSSProperties, type MouseEvent } from "react";
import { buildAppUsageSummaries, buildProductivityDurations, secondsToLabel, type ActivitySegment } from "@dtime/domain";

type ReviewBreakdownKey = "focus" | "drift" | "other";

export type EndOfDayReviewTopSource = {
  appName: string;
  sourceLabel: string;
  durationSeconds: number;
};

export type EndOfDayReviewBreakdownSource = EndOfDayReviewTopSource & {
  key: ReviewBreakdownKey;
};

export type EndOfDayReviewEvent = {
  kind: "endOfDayReview";
  placement?: "top-right";
  day: string;
  generatedAt: string;
  trackedLabel: string;
  focusLabel: string;
  driftLabel: string;
  totalSeconds: number;
  focusSeconds: number;
  driftSeconds: number;
  topSource: EndOfDayReviewTopSource | null;
  breakdownSources?: EndOfDayReviewBreakdownSource[];
  isMock?: boolean;
};

type EndOfDayReviewProps = {
  event: EndOfDayReviewEvent;
  isMock?: boolean;
  onOpenDashboard?: () => void;
  onViewDetails?: () => void;
  onOpenNotificationSettings?: () => void;
  onClose?: () => void;
};

type ReviewBreakdownItem = {
  key: ReviewBreakdownKey;
  label: string;
  seconds: number;
  percent: number;
  topSource: EndOfDayReviewTopSource | null;
};

type ReviewBreakdownHover = {
  item: ReviewBreakdownItem;
  x: number;
  y: number;
};

type ReviewShareStyle = CSSProperties & {
  "--review-share": string;
};

const REVIEW_GRAPH_RADIUS = 34;
const REVIEW_GRAPH_CIRCUMFERENCE = 2 * Math.PI * REVIEW_GRAPH_RADIUS;
const BREAKDOWN_ORDER: Record<ReviewBreakdownKey, number> = { focus: 0, drift: 1, other: 2 };

export function buildEndOfDayReviewSummary({
  day,
  generatedAt,
  segments,
  isMock = false,
}: {
  day: string;
  generatedAt: string;
  segments: ActivitySegment[];
  isMock?: boolean;
}): EndOfDayReviewEvent {
  const totalSeconds = segments.reduce((total, segment) => total + segment.durationSeconds, 0);
  const productivityDurations = buildProductivityDurations(segments);
  const focusSeconds = productivityDurations.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const driftSeconds = productivityDurations.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0;

  return {
    kind: "endOfDayReview",
    placement: "top-right",
    day,
    generatedAt,
    trackedLabel: `${formatReviewDuration(totalSeconds)} tracked`,
    focusLabel: `${formatReviewDuration(focusSeconds)} focus`,
    driftLabel: `${formatReviewDuration(driftSeconds)} drift`,
    totalSeconds,
    focusSeconds,
    driftSeconds,
    topSource: buildTopSource(segments),
    breakdownSources: buildBreakdownSources(segments),
    isMock: isMock || undefined,
  };
}

export function EndOfDayReview({
  event,
  isMock = false,
  onOpenDashboard,
  onViewDetails,
  onOpenNotificationSettings,
  onClose,
}: EndOfDayReviewProps) {
  const showMockCopy = isMock || event.isMock === true;
  const hasTrackedTime = event.totalSeconds > 0;
  const breakdown = buildReviewBreakdown(event);
  const compactBreakdown = buildCompactBreakdown(breakdown);
  const [breakdownHover, setBreakdownHover] = useState<ReviewBreakdownHover | null>(null);

  function showBreakdownHover(item: ReviewBreakdownItem, mouseEvent: MouseEvent<HTMLElement>) {
    setBreakdownHover({ item, x: mouseEvent.clientX, y: mouseEvent.clientY });
  }

  return (
    <aside className="end-of-day-review" aria-label="Drifty end-of-day review" aria-live="polite" data-mock={showMockCopy ? "true" : undefined}>
      <button type="button" className="end-of-day-review__close" aria-label="Close end-of-day review" onClick={onClose}>x</button>

      {hasTrackedTime ? (
        <div className="end-of-day-review__compact">
          <ReviewDonut breakdown={compactBreakdown} leadingItem={compactBreakdown[0]} />
          <ReviewBreakdown breakdown={compactBreakdown} onShowHover={showBreakdownHover} onHideHover={() => setBreakdownHover(null)} />
        </div>
      ) : (
        <div className="end-of-day-review__empty">
          <strong>No tracked activity today.</strong>
          <p>No tracked activity for this day yet.</p>
          <p>Leave Drifty running during a workday and your end-of-day review will appear here.</p>
          <p>The tracker was running, but no local activity segments were captured for this review window.</p>
        </div>
      )}

      <div className="end-of-day-review__actions" aria-label="End-of-day review actions">
        <button type="button" className="end-of-day-review__action end-of-day-review__action--primary" onClick={onOpenDashboard}>
          Open dashboard
        </button>
        <button type="button" className="end-of-day-review__action" onClick={onViewDetails}>
          View details
        </button>
        <button type="button" className="end-of-day-review__action" onClick={onOpenNotificationSettings}>
          Review settings
        </button>
      </div>
      {breakdownHover ? <ReviewBreakdownHoverCard hover={breakdownHover} /> : null}
    </aside>
  );
}

function ReviewDonut({ breakdown, leadingItem }: { breakdown: ReviewBreakdownItem[]; leadingItem: ReviewBreakdownItem | undefined }) {
  let offset = 0;

  return (
    <svg
      className="end-of-day-review__graph"
      viewBox="0 0 96 96"
      role="img"
      aria-label="End-of-day focus and drift breakdown"
      focusable="false"
    >
      <circle className="end-of-day-review__graph-track" cx="48" cy="48" r={REVIEW_GRAPH_RADIUS} />
      {breakdown.map((item) => {
        const length = (item.percent / 100) * REVIEW_GRAPH_CIRCUMFERENCE;
        const dashOffset = -offset;
        offset += length;

        return (
          <circle
            key={item.key}
            className={`end-of-day-review__graph-segment end-of-day-review__graph-segment--${item.key}`}
            cx="48"
            cy="48"
            r={REVIEW_GRAPH_RADIUS}
            strokeDasharray={`${length} ${REVIEW_GRAPH_CIRCUMFERENCE - length}`}
            strokeDashoffset={dashOffset}
          />
        );
      })}
      <text className="end-of-day-review__graph-label" x="48" y="45" textAnchor="middle">{leadingItem?.label ?? "Neutral"}</text>
      <text className="end-of-day-review__graph-value" x="48" y="59" textAnchor="middle">
        {formatReviewPercent(leadingItem?.percent ?? 0)}
      </text>
    </svg>
  );
}

function ReviewBreakdown({
  breakdown,
  onShowHover,
  onHideHover,
}: {
  breakdown: ReviewBreakdownItem[];
  onShowHover: (item: ReviewBreakdownItem, mouseEvent: MouseEvent<HTMLElement>) => void;
  onHideHover: () => void;
}) {
  return (
    <dl className="end-of-day-review__breakdown" aria-label="End-of-day derived breakdown">
      {breakdown.map((item) => {
        const shareStyle: ReviewShareStyle = { "--review-share": `${item.percent}%` };
        const percentLabel = formatReviewPercent(item.percent);

        return (
          <div
            className={`end-of-day-review__breakdown-item end-of-day-review__breakdown-item--${item.key}`}
            key={item.key}
            aria-label={`${item.label} breakdown detail`}
            style={shareStyle}
            onMouseEnter={(event) => onShowHover(item, event)}
            onMouseMove={(event) => onShowHover(item, event)}
            onMouseLeave={onHideHover}
          >
            <dt className="end-of-day-review__breakdown-label">
              <span className="end-of-day-review__breakdown-dot" aria-hidden="true" />
              <span>{item.label}</span>
            </dt>
            <dd className="end-of-day-review__breakdown-measure">
              <span>{percentLabel}</span>
              <strong>{formatReviewDuration(item.seconds)}</strong>
            </dd>
            <span
              className="end-of-day-review__breakdown-bar"
              role="meter"
              aria-label={`${item.label} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.percent}
              aria-valuetext={percentLabel}
            >
              <span />
            </span>
          </div>
        );
      })}
    </dl>
  );
}

function ReviewBreakdownHoverCard({ hover }: { hover: ReviewBreakdownHover }) {
  const { item } = hover;
  const left = Math.max(12, Math.min(hover.x + 14, window.innerWidth - 252));
  const top = Math.max(12, Math.min(hover.y + 14, window.innerHeight - 172));

  return (
    <div className="end-of-day-review__hover-card" role="tooltip" aria-label={`${item.label} detail`} style={{ left, top }}>
      <div className="end-of-day-review__hover-head">
        <span className={`end-of-day-review__breakdown-dot end-of-day-review__breakdown-dot--${item.key}`} aria-hidden="true" />
        <strong>{item.label}</strong>
      </div>
      <div className="end-of-day-review__hover-metric">
        <strong>{formatReviewDuration(item.seconds)}</strong>
        <span>{formatReviewPercent(item.percent)} of tracked time</span>
      </div>
      <div className="end-of-day-review__hover-source">
        <span>Top source</span>
        {item.topSource ? (
          <strong>{item.topSource.appName}</strong>
        ) : (
          <strong>No source yet</strong>
        )}
        {item.topSource && item.topSource.sourceLabel !== item.topSource.appName ? <em>{item.topSource.sourceLabel}</em> : null}
      </div>
    </div>
  );
}

function buildTopSource(segments: ActivitySegment[]): EndOfDayReviewTopSource | null {
  return buildTopSourceFromSegments(segments);
}

function buildBreakdownSources(segments: ActivitySegment[]): EndOfDayReviewBreakdownSource[] {
  return (["focus", "drift", "other"] as ReviewBreakdownKey[]).flatMap((key) => {
    const source = buildTopSourceFromSegments(segments.filter((segment) => matchesBreakdownKey(segment, key)));
    return source ? [{ ...source, key }] : [];
  });
}

function buildTopSourceFromSegments(segments: ActivitySegment[]): EndOfDayReviewTopSource | null {
  const topApp = buildAppUsageSummaries(segments, { limit: 1, groupBy: "app" })[0];
  if (!topApp) return null;

  const appSegments = segments.filter((segment) => segment.appName === topApp.appName);
  const topSource = buildAppUsageSummaries(appSegments, { limit: 1 })[0];
  const sourceLabel = topSource ? sourceLabelForSummary(topSource) : topApp.appName;

  return {
    appName: topApp.appName,
    sourceLabel,
    durationSeconds: topApp.totalSeconds,
  };
}

function matchesBreakdownKey(segment: ActivitySegment, key: ReviewBreakdownKey): boolean {
  const productivity = segment.classification?.productivity ?? "neutral";
  if (key === "focus") return productivity === "focus";
  if (key === "drift") return productivity === "drift";
  return productivity !== "focus" && productivity !== "drift";
}

function buildReviewBreakdown(event: EndOfDayReviewEvent): ReviewBreakdownItem[] {
  const totalSeconds = Math.max(0, event.totalSeconds);
  const focusSeconds = Math.max(0, event.focusSeconds);
  const driftSeconds = Math.max(0, event.driftSeconds);
  const otherSeconds = Math.max(0, totalSeconds - focusSeconds - driftSeconds);

  const sourceByKey = new Map((event.breakdownSources ?? []).map((source) => [source.key, source]));

  return [
    { key: "focus", label: "Focus", seconds: focusSeconds, percent: safePercent(focusSeconds, totalSeconds), topSource: sourceByKey.get("focus") ?? null },
    { key: "drift", label: "Drift", seconds: driftSeconds, percent: safePercent(driftSeconds, totalSeconds), topSource: sourceByKey.get("drift") ?? null },
    { key: "other", label: "Neutral", seconds: otherSeconds, percent: safePercent(otherSeconds, totalSeconds), topSource: sourceByKey.get("other") ?? null },
  ];
}

function buildCompactBreakdown(breakdown: ReviewBreakdownItem[]): ReviewBreakdownItem[] {
  return breakdown.slice().sort((left, right) => right.seconds - left.seconds || BREAKDOWN_ORDER[left.key] - BREAKDOWN_ORDER[right.key]);
}

function safePercent(seconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.round((seconds / totalSeconds) * 1000) / 10;
}

function formatReviewPercent(percent: number): string {
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

function sourceLabelForSummary(summary: ReturnType<typeof buildAppUsageSummaries>[number]): string {
  if (summary.siteDomain) return summary.siteDomain;
  if (summary.siteTitle) return summary.siteTitle;
  return summary.appName;
}

function formatReviewDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0 && minutes === 0) return `${hours}h`;
  return secondsToLabel(totalSeconds);
}
