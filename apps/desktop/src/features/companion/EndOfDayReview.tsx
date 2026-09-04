import { useState, type CSSProperties, type MouseEvent } from "react";
import { secondsToLabel } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { DismissIcon, SettingsIcon } from "./DriftAlarmIcons";
import { buildDonutArcSegments } from "../../lib/donutArcPath";
import driftyWordmarkUrl from "../../assets/drifty-wordmark.png";
import type { LeaderboardCelebration } from "./companionLeaderboardMilestones";
import type {
  EndOfDayReviewBreakdownKey,
  EndOfDayReviewCategorySummary,
  EndOfDayReviewEvent,
  EndOfDayReviewSourceSummary,
  EndOfDayReviewTopSource,
} from "./endOfDayReviewModel";

type ReviewBreakdownKey = EndOfDayReviewBreakdownKey;

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

type ReviewMeterStyle = CSSProperties & {
  "--meter-value": string;
  "--meter-color": string;
};

type ReviewCategoryStyle = CSSProperties & {
  "--category-color": string;
  "--category-share"?: string;
};

const REVIEW_GRAPH_RADIUS = 40;
const BREAKDOWN_ORDER: Record<ReviewBreakdownKey, number> = { focus: 0, drift: 1, other: 2, unclassified: 3 };
const REVIEW_CATEGORY_COLORS = [
  "var(--productivity-focus)",
  "#64645f",
  "#918f87",
  "#a9554f",
  "#bd6257",
] as const;

/**
 * Retained visual reference for the pre-Companion `Summary - Today` panel.
 * Product surfaces must render `CompanionPillDayReview`; this component is
 * intentionally isolated from App, bridge, and watcher runtime wiring.
 */

export function LegacyEndOfDayReview({
  event,
  isMock = false,
  onOpenDashboard,
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
      <div className="eodr-chrome">
        <div className="eodr-brand">
          <img className="window-logo" src={driftyWordmarkUrl} alt="Drifty" />
          <h2>Summary - Today</h2>
        </div>
        <div className="eodr-actions">
          <button type="button" className="icon-btn" aria-label="Review settings" onClick={onOpenNotificationSettings}>
            <SettingsIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="Close end-of-day review" onClick={onClose}>
            <DismissIcon />
          </button>
        </div>
      </div>

      {event.leaderboardCelebration?.period === "daily" ? (
        <DailyLeaderboardCheckpoint celebration={event.leaderboardCelebration} />
      ) : null}

      {hasTrackedTime ? (
        <div className="end-of-day-review__tracked">
          <ReviewMetrics event={event} />

          <div className="end-of-day-review__body">
            <div className="end-of-day-review__compact">
              <ReviewDonut breakdown={compactBreakdown} leadingItem={compactBreakdown[0]} />
              <ReviewBreakdown breakdown={compactBreakdown} onShowHover={showBreakdownHover} onHideHover={() => setBreakdownHover(null)} />
            </div>
          </div>

          <div className="end-of-day-review__table-stack" aria-label="End-of-day review tables">
            <ReviewCategoryTable categories={event.categorySummaries ?? []} totalSeconds={event.totalSeconds} />
            <ReviewSourceList sources={event.sourceSummaries ?? []} totalSeconds={event.totalSeconds} />
          </div>
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
      </div>
      {breakdownHover ? <ReviewBreakdownHoverCard hover={breakdownHover} /> : null}
    </aside>
  );
}

function DailyLeaderboardCheckpoint({ celebration }: { celebration: LeaderboardCelebration }) {
  return (
    <section className="eodr-rank-checkpoint" aria-label="8 PM leaderboard checkpoint">
      <span className="eodr-rank-checkpoint__eyebrow">8 PM checkpoint</span>
      <strong>
        #{celebration.rank}
        <small>of {celebration.participantCount} active people</small>
      </strong>
      <p>Today’s leaderboard as of 8:00 PM</p>
    </section>
  );
}

function ReviewMetrics({ event }: { event: EndOfDayReviewEvent }) {
  const metrics = [
    { label: "Tracked", value: formatReviewDuration(event.totalSeconds), percent: 100, color: "var(--review-tone)", delta: "Local total" },
    { label: "Focus", value: formatReviewDuration(event.focusSeconds), percent: safePercent(event.focusSeconds, event.totalSeconds), color: "var(--productivity-focus)", delta: event.focusLabel },
    { label: "Drift", value: formatReviewDuration(event.driftSeconds), percent: safePercent(event.driftSeconds, event.totalSeconds), color: "var(--productivity-drift)", delta: event.driftLabel },
  ];

  return (
    <div className="end-of-day-review__summary" aria-label="Focus and drift summary">
      {metrics.map((metric) => {
        const style: ReviewMeterStyle = {
          "--meter-value": `${metric.percent}%`,
          "--meter-color": metric.color,
        };

        return (
          <div className="eodr-metric" style={style} key={metric.label}>
            <span className="eodr-metric__label">{metric.label}</span>
            <strong className="eodr-metric__value">{metric.value}</strong>
            <span className="eodr-meter" aria-hidden="true"><span /></span>
            <span className="eodr-metric__delta">{metric.delta}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReviewDonut({ breakdown, leadingItem }: { breakdown: ReviewBreakdownItem[]; leadingItem: ReviewBreakdownItem | undefined }) {
  const segments = buildDonutArcSegments(breakdown, (item) => item.percent / 100, 50, 50, REVIEW_GRAPH_RADIUS);

  return (
    <div className="eodr-dial-shell">
      <svg
        className="eodr-dial"
        viewBox="0 0 100 100"
        role="img"
        aria-label="End-of-day focus and drift breakdown"
        focusable="false"
      >
        <circle className="eodr-dial__track" cx="50" cy="50" r={REVIEW_GRAPH_RADIUS} />
        {segments.map(({ entry, pathData }) => (
          <path
            key={entry.key}
            className={`eodr-dial__segment eodr-dial__segment--${entry.key}`}
            d={pathData}
          />
        ))}
      </svg>
      <div className="eodr-dial__center" aria-hidden="true"><strong>{formatReviewPercent(leadingItem?.percent ?? 0)}</strong></div>
    </div>
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

function ReviewCategoryTable({ categories, totalSeconds }: { categories: EndOfDayReviewCategorySummary[]; totalSeconds: number }) {
  return (
    <div className="end-of-day-review__category" aria-label="Category breakdown">
      <div className="eodr-category-head">
        <span className="eodr-category-title">Categories</span>
        <strong className="eodr-category-total">{formatReviewDuration(totalSeconds)}</strong>
      </div>
      <div className="eodr-category-stack-bar" aria-label="Category share">
        {categories.map((category, index) => {
          const style: ReviewCategoryStyle = {
            "--category-share": `${category.percent}%`,
            "--category-color": REVIEW_CATEGORY_COLORS[index % REVIEW_CATEGORY_COLORS.length],
          };
          return <i key={category.label} style={style} />;
        })}
      </div>
      <div className="eodr-category-list">
        {categories.map((category, index) => {
          const style: ReviewCategoryStyle = {
            "--category-color": REVIEW_CATEGORY_COLORS[index % REVIEW_CATEGORY_COLORS.length],
          };
          return (
            <div className="eodr-category-row" style={style} key={category.label}>
              <b className="eodr-category-dot" aria-hidden="true" />
              <strong>{category.label}</strong>
              <span>{formatReviewDuration(category.durationSeconds)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewSourceList({ sources, totalSeconds }: { sources: EndOfDayReviewSourceSummary[]; totalSeconds: number }) {
  return (
    <div className="end-of-day-review__sources" aria-label="Most used apps">
      <span>Most used apps</span>
      <div className="eodr-source-list">
        {sources.map((source) => (
          <div className="eodr-source-row" key={`${source.appName}:${source.sourceLabel}`}>
            <ReviewSourceIcon source={source} />
            <div className="eodr-source-meta">
              <strong>{source.appName}</strong>
              {source.sourceLabel !== source.appName ? <em>{source.sourceLabel}</em> : null}
            </div>
            <span className="eodr-source-stat">{formatReviewDuration(source.durationSeconds)} · {formatReviewPercent(safePercent(source.durationSeconds, totalSeconds))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewSourceIcon({ source }: { source: EndOfDayReviewSourceSummary }) {
  if (source.iconSrc) {
    return (
      <span className="src-tile src-tile--app-icon" aria-hidden="true">
        <AppGlyph appName={source.appName} iconSrc={source.iconSrc} size="sm" />
      </span>
    );
  }

  const sourceName = `${source.appName} ${source.sourceLabel}`.toLowerCase();

  if (sourceName.includes("vs code") || sourceName.includes("visual studio code") || source.appName.toLowerCase() === "code") {
    return (
      <span className="src-tile src-tile--code" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4" />
        </svg>
      </span>
    );
  }

  if (sourceName.includes("figma")) {
    return (
      <span className="src-tile" aria-hidden="true">
        <span className="glyph glyph--design">Fi</span>
      </span>
    );
  }

  if (sourceName.includes("youtube") || sourceName.includes("youtube.com")) {
    return (
      <span className="src-tile src-tile--yt" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 7.3v9.4l7.5-4.7z" /></svg>
      </span>
    );
  }

  return (
    <span className="src-tile" aria-hidden="true">
      <AppGlyph appName={source.appName} size="sm" />
    </span>
  );
}

function buildReviewBreakdown(event: EndOfDayReviewEvent): ReviewBreakdownItem[] {
  const totalSeconds = Math.max(0, event.totalSeconds);
  const focusSeconds = Math.max(0, event.focusSeconds);
  const driftSeconds = Math.max(0, event.driftSeconds);
  const unclassifiedSeconds = Math.max(0, event.unclassifiedSeconds ?? 0);
  const otherSeconds = Math.max(0, event.neutralSeconds ?? totalSeconds - focusSeconds - driftSeconds - unclassifiedSeconds);

  const sourceByKey = new Map((event.breakdownSources ?? []).map((source) => [source.key, source]));

  const breakdown: ReviewBreakdownItem[] = [
    { key: "focus", label: "Focus", seconds: focusSeconds, percent: safePercent(focusSeconds, totalSeconds), topSource: sourceByKey.get("focus") ?? null },
    { key: "drift", label: "Drift", seconds: driftSeconds, percent: safePercent(driftSeconds, totalSeconds), topSource: sourceByKey.get("drift") ?? null },
    { key: "other", label: "Neutral", seconds: otherSeconds, percent: safePercent(otherSeconds, totalSeconds), topSource: sourceByKey.get("other") ?? null },
  ];
  if (unclassifiedSeconds > 0) {
    breakdown.push({
      key: "unclassified",
      label: "Unclassified",
      seconds: unclassifiedSeconds,
      percent: safePercent(unclassifiedSeconds, totalSeconds),
      topSource: sourceByKey.get("unclassified") ?? null,
    });
  }
  return breakdown;
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

function formatReviewDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0 && minutes === 0) return `${hours}h`;
  return secondsToLabel(totalSeconds);
}
