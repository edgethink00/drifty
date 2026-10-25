/**
 * A member's focus per logical day for their team, sent only while the team
 * shares focus. Only day totals leave the device. The publish boundary matches
 * the focus card and leaderboard (no imported estimates, passive-supported,
 * excluded, failed-capture or other-device time), and the classification is the
 * member's own, so the team sees the number the member sees.
 */
import {
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  isPassiveSupportedSegment,
  isRemoteDeviceSegment,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";

import { buildDailyProductivitySeries } from "../share/dailyProductivity";

/** How the member's own charts classify activity, passed down from the app. */
export type TeamFocusClassification = {
  readonly includeAiClassifications: boolean;
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
};

export type TeamFocusDayEntry = { readonly activity_date: string; readonly seconds: number };

export function teamFocusDayTotals(
  segments: readonly ActivitySegment[],
  window: { readonly start_date: string; readonly end_date: string },
  classification: TeamFocusClassification,
  startOfDayMinutes: number,
  preferences: Pick<ClassificationOptions, "categoryProductivity" | "deletedCategories"> = {},
): TeamFocusDayEntry[] {
  const publishable = segments.filter(
    (segment) => !isBrowserHistoryImportSegment(segment)
      && !isExcludedSegment(segment)
      && !isFailedForegroundCaptureSegment(segment)
      && !isPassiveSupportedSegment(segment)
      && !isRemoteDeviceSegment(segment),
  );
  const options: ClassificationOptions = {
    fallbackCandidates: publishable,
    includeAiClassifications: classification.includeAiClassifications,
    includeBuiltInHeuristics: classification.includeBuiltInHeuristics,
    builtInHeuristicsUnavailableSince: classification.builtInHeuristicsUnavailableSince,
    ...preferences,
  };
  return buildDailyProductivitySeries(publishable, window.start_date, window.end_date, options, startOfDayMinutes)
    .map((point) => ({ activity_date: point.day, seconds: Math.round(point.focus) }))
    .filter((entry) => entry.seconds > 0);
}
