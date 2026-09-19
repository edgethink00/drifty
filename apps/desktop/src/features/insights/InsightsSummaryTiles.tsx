import { logicalDayIsoDateForDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";
import type { InsightRange } from "../dashboard/dashboardPeriods";
import { MetricTile } from "../../components/MetricTile";
import { formatDuration, formatLocalizedDuration } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { WeeklyBreakdownDay } from "./insightData";

const KOREAN_WEEKDAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"] as const;

/** Days that carry any tracked activity in the window. */
function countActiveDays(segments: readonly ActivitySegment[]): number {
  const days = new Set<string>();
  for (const segment of segments) {
    if (!Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0) continue;
    const started = new Date(segment.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    days.add(logicalDayIsoDateForDate(started));
  }
  return days.size;
}

type InsightsSummaryTilesProps = {
  readonly compact?: boolean;
  readonly productivityTotals: {
    readonly focus: number;
    readonly neutral: number;
    readonly drift: number;
  };
  readonly range: InsightRange;
  readonly segments: readonly ActivitySegment[];
  readonly weekly: readonly WeeklyBreakdownDay[];
};

/** Headline figures for the Insights usage tab. Every tile is a direct
 *  restatement of the window the user already selected: no comparison against
 *  other users, no projection, and no causal reading. */
export function InsightsSummaryTiles({ productivityTotals, range, segments, weekly, compact = false }: InsightsSummaryTilesProps) {
  const { effectiveLanguage, t } = useLocalization();
  // Outside a single week the weekly buckets are per-weekday averages, so the
  // peak tile must not read as one specific day's total.
  const peakIsAverage = range !== "Week";
  const activeDays = countActiveDays(segments);
  const isKorean = effectiveLanguage === "ko";
  const trackedSeconds = productivityTotals.focus + productivityTotals.neutral + productivityTotals.drift;
  const focusShare = trackedSeconds > 0 ? Math.round((productivityTotals.focus / trackedSeconds) * 100) : 0;
  const driftShare = trackedSeconds > 0 ? Math.round((productivityTotals.drift / trackedSeconds) * 100) : 0;
  const dailyFocusSeconds = activeDays > 0 ? Math.round(productivityTotals.focus / activeDays) : 0;
  const peakDay = weekly.reduce<WeeklyBreakdownDay | null>(
    (best, day) => (day.isActive && day.focusSeconds > 0 && (!best || day.focusSeconds > best.focusSeconds) ? day : best),
    null,
  );
  const peakLabel = peakDay
    ? (isKorean ? KOREAN_WEEKDAYS[peakDay.weekdayIndex] ?? peakDay.weekday : peakDay.weekday)
    : t("trends.summary.empty");

  function duration(totalSeconds: number) {
    return isKorean ? formatLocalizedDuration(totalSeconds, effectiveLanguage) : formatDuration(totalSeconds);
  }

  return (
    <div className={`kpi-row kpi-row--insights insights-summary${compact ? " insights-summary--compact" : ""}`} aria-label={t("trends.summaryAria")}>
      <MetricTile
        className="insight-summary__tile insight-summary__tile--focus"
        label={t("trends.summary.focus")}
        value={duration(productivityTotals.focus)}
        detail={trackedSeconds > 0 ? t("trends.summary.shareOfTracked", { percent: String(focusShare) }) : t("trends.summary.empty")}
      />
      <MetricTile
        className="insight-summary__tile insight-summary__tile--drift"
        label={t("trends.summary.drift")}
        value={duration(productivityTotals.drift)}
        detail={trackedSeconds > 0 ? t("trends.summary.shareOfTracked", { percent: String(driftShare) }) : t("trends.summary.empty")}
      />
      <MetricTile
        className="insight-summary__tile insight-summary__tile--daily"
        label={t("trends.summary.dailyFocus")}
        value={activeDays > 0 ? duration(dailyFocusSeconds) : t("trends.summary.empty")}
        detail={t("trends.summary.acrossDays", { count: String(activeDays) })}
      />
      {!compact && <MetricTile
        className="insight-summary__tile insight-summary__tile--peak"
        label={t("trends.summary.peakWeekday")}
        value={peakLabel}
        detail={peakDay
          ? t(peakIsAverage ? "trends.summary.peakWeekdayAverage" : "trends.summary.peakWeekdayDetail", { duration: duration(peakDay.focusSeconds) })
          : t("trends.summary.peakWeekdayEmpty")}
      />}
    </div>
  );
}

/** The existing peak metric, moved next to the pattern rather than repeated as a tile. */
export function InsightsPeakWeekday({ weekly, range }: Pick<InsightsSummaryTilesProps, "weekly" | "range">) {
  const { effectiveLanguage, t } = useLocalization();
  const peak = weekly.reduce<WeeklyBreakdownDay | null>(
    (best, day) => day.isActive && day.focusSeconds > 0 && (!best || day.focusSeconds > best.focusSeconds) ? day : best,
    null,
  );
  if (!peak) return null;
  const label = effectiveLanguage === "ko" ? KOREAN_WEEKDAYS[peak.weekdayIndex] : peak.weekday;
  const duration = effectiveLanguage === "ko"
    ? formatLocalizedDuration(peak.focusSeconds, effectiveLanguage)
    : formatDuration(peak.focusSeconds);
  return (
    <p className="insights-peak-note">
      <span>{t("trends.summary.peakWeekday")}</span>{" "}
      <strong>{label}</strong>
      <span>{t(range === "Week" ? "trends.summary.peakWeekdayDetail" : "trends.summary.peakWeekdayAverage", { duration })}</span>
    </p>
  );
}
