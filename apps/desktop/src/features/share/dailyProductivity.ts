// Per-day focus/drift/neutral series over the last 30 days, computed locally from the
// tracker timeline (nothing leaves the device). Powers the Profile page's 30-day chart.
import { useEffect, useState } from "react";
import {
  classifyActivity,
  isBrowserHistoryImportSegment,
  logicalDayEndExclusiveMs,
  logicalDayIsoDateForDate,
  shiftIsoDate,
} from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import { getLeaderboardWindowStartDay } from "../leaderboard/leaderboardWindow";

export interface DailyProductivityPoint {
  readonly day: string;
  readonly focus: number;
  readonly drift: number;
  readonly neutral: number;
}

/**
 * Pure: split each classified segment across logical days (same clipping as
 * buildDailyTotals) and bucket seconds by productivity. Unknown/pending stays out.
 */
export function buildDailyProductivitySeries(
  segments: ActivitySegment[],
  startDay: string,
  endDay: string,
  options: ClassificationOptions,
  startOfDayMinutes = 0,
): DailyProductivityPoint[] {
  const totals = new Map<string, { focus: number; drift: number; neutral: number }>();

  for (const segment of segments) {
    const { category, productivity } = classifyActivity(segment, options);
    if (category === "unknown") continue;

    let cursor = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();
    while (cursor < end) {
      const dayKey = logicalDayIsoDateForDate(new Date(cursor), startOfDayMinutes);
      const overlapEnd = Math.min(end, logicalDayEndExclusiveMs(dayKey, startOfDayMinutes));
      const overlapSeconds = Math.max(0, Math.round((overlapEnd - cursor) / 1000));

      const bucket = totals.get(dayKey) ?? { focus: 0, drift: 0, neutral: 0 };
      bucket[productivity] += overlapSeconds;
      totals.set(dayKey, bucket);
      cursor = overlapEnd;
    }
  }

  const series: DailyProductivityPoint[] = [];
  for (let day = startDay; day <= endDay; day = shiftIsoDate(day, 1)) {
    const bucket = totals.get(day);
    series.push({ day, focus: bucket?.focus ?? 0, drift: bucket?.drift ?? 0, neutral: bucket?.neutral ?? 0 });
  }
  return series;
}

export interface UseDailyProductivityInput {
  readonly windowEndDay: string;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
  /** Fetch only while the surface that renders the chart is active. */
  readonly enabled: boolean;
}

/** 30-day series from the tracker; null while loading/disabled. */
export function useDailyProductivitySeries(input: UseDailyProductivityInput): DailyProductivityPoint[] | null {
  const { windowEndDay, startOfDayMinutes, includeAiClassifications, includeBuiltInHeuristics, builtInHeuristicsUnavailableSince, enabled } = input;
  const [series, setSeries] = useState<DailyProductivityPoint[] | null>(null);

  useEffect(() => {
    if (!enabled || !windowEndDay) return;
    let cancelled = false;

    void (async () => {
      try {
        const startDay = getLeaderboardWindowStartDay(windowEndDay, "monthly");
        const fetched = await trackerClient.getTimeline(getLogicalDayRange(startDay, windowEndDay, startOfDayMinutes));
        const segments = fetched.filter((segment) => !isBrowserHistoryImportSegment(segment));
        const next = buildDailyProductivitySeries(
          segments,
          startDay,
          windowEndDay,
          { fallbackCandidates: segments, includeAiClassifications, includeBuiltInHeuristics, builtInHeuristicsUnavailableSince },
          startOfDayMinutes,
        );
        if (!cancelled) setSeries(next);
      } catch {
        if (!cancelled) setSeries(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [builtInHeuristicsUnavailableSince, enabled, includeAiClassifications, includeBuiltInHeuristics, startOfDayMinutes, windowEndDay]);

  return series;
}
