import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { MetricTile } from "../../components/MetricTile";
import {
  formatLocalizedCompactDurationFromSeconds,
  formatLocalizedCompactTimeRange,
  formatLocalizedShortDurationFromSeconds,
} from "../../lib/formatting";
import type { ProductivityRun } from "../../lib/productivityRuns";
import type { DisplayLanguage } from "../localization/languagePreference";
import { useLocalization } from "../localization/LocalizationContext";
import { streakBarHeight, type DayPatternMetrics } from "./dayPatternMetrics";

const STREAK_CHART_HEIGHT_PX = 32;
const STREAK_BAR_MIN_HEIGHT_PX = 4;
/** Space kept between the longest streak's time and an edge hour label. */
const STREAK_LABEL_GAP_PX = 8;
const EMPTY_VALUE = "\u2014";

type DayBreakdownPatternsProps = {
  readonly metrics: DayPatternMetrics;
};

/**
 * The Your Day Breakdown summary below the productivity ring and categories:
 * the day's Longest streak on a skyline of focus runs, then four pattern tiles.
 */
export function DayBreakdownPatterns({ metrics }: DayBreakdownPatternsProps) {
  const { effectiveLanguage: language, t } = useLocalization();
  const awaitingClassification = metrics.trackedSeconds > 0 && metrics.classifiedSeconds === 0;
  const emptyDetail = (classifiedEmpty: string) => (awaitingClassification ? t("dashboard.today.driftNotClassified") : classifiedEmpty);
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const { topFocus, topDrift, longestDrift, switches } = metrics;

  return (
    <>
      <LongestStreakSection metrics={metrics} awaitingClassification={awaitingClassification} />
      <div className="kpi-row kpi-row--insights insight-summary day-patterns" aria-label={t("dashboard.today.insightSummary")}>
        <MetricTile
          className="insight-summary__tile insight-summary__tile--top-focus"
          label={t("dashboard.today.topFocus")}
          value={topFocus?.label ?? EMPTY_VALUE}
          valueTitle={topFocus !== null}
          detail={topFocus ? duration(topFocus.seconds) : emptyDetail(t("dashboard.today.patternNoFocus"))}
        />
        <MetricTile
          className="insight-summary__tile insight-summary__tile--top-drift"
          label={t("dashboard.today.topDrift")}
          value={topDrift?.label ?? EMPTY_VALUE}
          valueTitle={topDrift !== null}
          detail={topDrift ? duration(topDrift.seconds) : emptyDetail(t("dashboard.today.noDrift"))}
        />
        <MetricTile
          className="insight-summary__tile insight-summary__tile--longest-drift"
          label={t("dashboard.today.longestDrift")}
          value={longestDrift ? duration(longestDrift.seconds) : EMPTY_VALUE}
          detail={longestDrift
            ? t("dashboard.today.fromTime", { time: formatClock(longestDrift.startMs, language) })
            : emptyDetail(t("dashboard.today.noDrift"))}
        />
        <MetricTile
          className="insight-summary__tile insight-summary__tile--switches"
          label={t("dashboard.today.switches")}
          value={switches ? formatSwitchRate(switches.count, switches.perHour, t) : EMPTY_VALUE}
          detail={switches ? t("dashboard.today.averageValue", { duration: formatLocalizedShortDurationFromSeconds(switches.averageStaySeconds, language) }) : undefined}
        />
      </div>
    </>
  );
}

function LongestStreakSection({ metrics, awaitingClassification }: { readonly metrics: DayPatternMetrics; readonly awaitingClassification: boolean }) {
  const { effectiveLanguage: language, t } = useLocalization();
  const { focusRuns, longestFocus, span } = metrics;
  const title = t("dashboard.today.longestStreak");

  return (
    <div className="flow-compact-split-chart__panel day-streak" aria-label={title}>
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{title}</span>
        <strong>{longestFocus ? formatLocalizedCompactDurationFromSeconds(longestFocus.seconds, language) : EMPTY_VALUE}</strong>
      </div>
      {longestFocus && span ? (
        <StreakSkyline runs={focusRuns} longest={longestFocus} span={span} language={language} />
      ) : (
        <p className="day-streak__empty">
          {awaitingClassification ? t("dashboard.today.longestStreakUnclassified") : t("dashboard.today.longestStreakEmpty")}
        </p>
      )}
    </div>
  );
}

type StreakSkylineProps = {
  readonly runs: readonly ProductivityRun[];
  readonly longest: ProductivityRun;
  readonly span: { readonly startMs: number; readonly endMs: number };
  readonly language: DisplayLanguage;
};

/**
 * Every focus run as a bar on the day's recorded hours: its width is when it
 * happened and its height is how long it lasted (full height at 90 minutes),
 * with the longest run in the solid Focus color.
 */
function StreakSkyline({ runs, longest, span, language }: StreakSkylineProps) {
  const { t } = useLocalization();
  const spanMs = Math.max(1, span.endMs - span.startMs);
  const toPercent = (ms: number) => (Math.min(Math.max(ms - span.startMs, 0), spanMs) / spanMs) * 100;
  const rangeLabel = formatLocalizedCompactTimeRange(new Date(longest.startMs), new Date(longest.endMs), language);
  const startLabel = formatStreakEdgeHour(span.startMs, language);
  const endLabel = formatStreakEdgeHour(span.endMs, language);
  const centerPercent = toPercent((longest.startMs + longest.endMs) / 2);
  const labels = useStreakLabelLayout(centerPercent, `${startLabel}|${rangeLabel}|${endLabel}`);
  const rangeStyle: CSSProperties = labels.layout
    ? { left: `${labels.layout.left}px` }
    : { left: `${centerPercent}%`, transform: "translateX(-50%)" };

  return (
    <>
      <div
        className="day-streak__chart"
        role="img"
        aria-label={t("dashboard.today.longestStreakChart", { count: runs.length, start: startLabel, end: endLabel, range: rangeLabel })}
      >
        {runs.map((run) => {
          const left = toPercent(run.startMs);
          return (
            <span
              key={run.startMs}
              className={`day-streak__bar${run === longest ? " day-streak__bar--longest" : ""}`}
              style={{
                left: `${left}%`,
                width: `${toPercent(run.endMs) - left}%`,
                height: `${streakBarHeight(run.seconds, STREAK_CHART_HEIGHT_PX, STREAK_BAR_MIN_HEIGHT_PX)}px`,
              }}
              title={`${formatLocalizedCompactTimeRange(new Date(run.startMs), new Date(run.endMs), language)} · ${formatLocalizedCompactDurationFromSeconds(run.seconds, language)}`}
            />
          );
        })}
      </div>
      <div className="day-streak__labels" ref={labels.rowRef} aria-hidden="true">
        <span className="day-streak__edge" ref={labels.startRef} style={labels.layout?.hideStart ? { visibility: "hidden" } : undefined}>{startLabel}</span>
        <span className="day-streak__range" ref={labels.rangeRef} style={rangeStyle}>{rangeLabel}</span>
        <span className="day-streak__edge day-streak__edge--end" ref={labels.endRef} style={labels.layout?.hideEnd ? { visibility: "hidden" } : undefined}>{endLabel}</span>
      </div>
    </>
  );
}

type StreakLabelLayout = { readonly left: number; readonly hideStart: boolean; readonly hideEnd: boolean };

/**
 * Centers the longest streak's time under its bar but keeps it inside the
 * chart, and hides an edge hour label it would overlap. Without layout (tests,
 * first paint) the time stays centered under the bar.
 */
function useStreakLabelLayout(centerPercent: number, labelText: string) {
  const rowRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLSpanElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<StreakLabelLayout | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const range = rangeRef.current;
    if (!row || !range) return undefined;
    const measure = () => {
      const width = row.clientWidth;
      const own = range.offsetWidth;
      if (width <= 0 || own <= 0) {
        setLayout(null);
        return;
      }
      const left = Math.max(0, Math.min(width - own, (centerPercent / 100) * width - own / 2));
      const next: StreakLabelLayout = {
        left,
        hideStart: left < (startRef.current?.offsetWidth ?? 0) + STREAK_LABEL_GAP_PX,
        hideEnd: left + own > width - (endRef.current?.offsetWidth ?? 0) - STREAK_LABEL_GAP_PX,
      };
      setLayout((current) => (current
        && current.left === next.left
        && current.hideStart === next.hideStart
        && current.hideEnd === next.hideEnd ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(range);
    return () => observer.disconnect();
  }, [centerPercent, labelText]);

  return { rowRef, startRef, rangeRef, endRef, layout };
}

/** A real switch never rounds down to "0 / h". */
function formatSwitchRate(count: number, perHour: number, t: ReturnType<typeof useLocalization>["t"]): string {
  if (count > 0 && perHour < 0.5) return t("dashboard.today.switchesUnderOnePerHour");
  return t("dashboard.today.switchesPerHour", { count: Math.round(perHour) });
}

/** Edge hours follow the Focus/Drift chart axis: "9 AM" and "9시". */
function formatStreakEdgeHour(ms: number, language: DisplayLanguage): string {
  const hour = new Date(ms).getHours();
  if (language === "ko") return `${hour}시`;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** One clock time in the same form as the streak range: "9:40 PM", "오후 9:40". */
function formatClock(ms: number, language: DisplayLanguage): string {
  const time = new Date(ms);
  return formatLocalizedCompactTimeRange(time, time, language);
}
