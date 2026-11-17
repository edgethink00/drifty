// Computes the aggregate for the public focus card (Phase 2 embed feature). Separate from the
// leaderboard publisher: the card carries a richer, card-only aggregate (drift/neutral split,
// focus share, per-day focus series) behind its own opt-in. Only derived aggregates are
// produced here — raw app/site/window/session history never leaves the device. Imported
// (estimated) browser-history segments are excluded, matching the leaderboard boundary.
import {
  buildCategoryDurations,
  buildProductivityDurations,
  buildRollingFocusSeconds,
  CATEGORY_ORDER,
  classifyActivity,
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  isPassiveSupportedSegment,
  isRemoteDeviceSegment,
  logicalDayEndExclusiveMs,
  logicalDayStartMs,
} from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ClassificationOptions, ProductivityLabel } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import { getLeaderboardWindowStartDay } from "../leaderboard/leaderboardWindow";
import { buildDailyProductivitySeries } from "./dailyProductivity";
import { readCategoryProductivityPreferences, readDeletedCategoryCutoffs } from "../settings/categoryCustomizationStore";

export interface DailyFocusPoint {
  readonly day: string;
  readonly focus: number;
  /** Daily drift seconds — published so the chart embed can show focus vs drift. */
  readonly drift: number;
}

export interface CategoryBreakdownEntry {
  readonly category: ActivityCategory;
  readonly seconds: number;
  readonly focusSeconds: number;
  readonly neutralSeconds: number;
  readonly driftSeconds: number;
}

export interface HourlyFocusPoint {
  readonly hour: number;
  readonly focusSeconds: number;
}

export interface FocusCardPayload {
  readonly focus_seconds_today: number;
  readonly focus_seconds_7d: number;
  readonly drift_seconds_7d: number;
  readonly neutral_seconds_7d: number;
  /** Focus as a share of classified time over the last 7 days, 0..1. */
  readonly focus_share: number;
  /** Per-logical-day focus+drift seconds across the 30-day window (30 entries, oldest first). */
  readonly daily_focus: readonly DailyFocusPoint[];
  readonly window_start_date: string;
  readonly window_end_date: string;
  /** Per-detail consent flags — persisted alongside the data so the RPC gate and the row agree. */
  readonly share_category_breakdown: boolean;
  readonly share_hourly_pattern: boolean;
  /** Detail fields exist ONLY while their consent flag is on; off means absent (and cleared server-side). */
  readonly category_breakdown_7d?: readonly CategoryBreakdownEntry[];
  readonly hourly_focus_pattern?: readonly HourlyFocusPoint[];
}

export interface FocusCardInput {
  readonly windowEndDay: string;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
  /** Category productivity preferences; read from Settings by the tracker entry point. */
  readonly categoryProductivity?: ClassificationOptions["categoryProductivity"];
  readonly deletedCategories?: ClassificationOptions["deletedCategories"];
  /** Per-detail opt-ins, all default OFF: a detail is computed and attached only when its flag is on. */
  readonly shareCategoryBreakdown?: boolean;
  readonly shareHourlyPattern?: boolean;
}

const PUBLIC_CATEGORY_ALLOWLIST = new Set<ActivityCategory>(CATEGORY_ORDER.filter((category) => category !== "unknown"));

function bucketSeconds(durations: ReturnType<typeof buildProductivityDurations>, label: ProductivityLabel): number {
  return Math.max(0, Math.round(durations.find((entry) => entry.productivity === label)?.totalSeconds ?? 0));
}

/**
 * Pure: category totals over the week window as {category, seconds}. Uses the same
 * buildCategoryDurations math as the local donut; unknown (unclassified) and zero-second
 * categories are dropped, sorted largest first. Category labels only — never app names.
 */
export function buildCategoryBreakdown7d(weekSegments: ActivitySegment[], options: ClassificationOptions): CategoryBreakdownEntry[] {
  const productivityByCategory = new Map<ActivityCategory, Record<ProductivityLabel, number>>();
  for (const segment of weekSegments) {
    const classification = classifyActivity(segment, options);
    if (!PUBLIC_CATEGORY_ALLOWLIST.has(classification.category)) continue;
    const current = productivityByCategory.get(classification.category) ?? { focus: 0, neutral: 0, drift: 0 };
    current[classification.productivity] += Math.max(0, segment.durationSeconds);
    productivityByCategory.set(classification.category, current);
  }

  return buildCategoryDurations(weekSegments, options)
    .filter((entry) => PUBLIC_CATEGORY_ALLOWLIST.has(entry.category) && entry.totalSeconds > 0)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .map((entry) => {
      const productivity = productivityByCategory.get(entry.category) ?? { focus: 0, neutral: 0, drift: 0 };
      return {
        category: entry.category,
        seconds: Math.max(0, Math.round(entry.totalSeconds)),
        focusSeconds: Math.max(0, Math.round(productivity.focus)),
        neutralSeconds: Math.max(0, Math.round(productivity.neutral)),
        driftSeconds: Math.max(0, Math.round(productivity.drift)),
      };
    });
}

/**
 * Pure: focus seconds AVERAGED per local hour-of-day across the 7-day window — 24 entries,
 * hour 0..23, each the window's focus seconds in that wall-clock hour divided by 7. This is
 * an hour-of-day rhythm, deliberately NOT a session timeline: individual days, sessions, and
 * ordering are not recoverable from it. Mirrors buildRollingFocusSeconds (same classification
 * options, same window clipping) so the pattern totals stay consistent with focus_seconds_7d.
 */
export function buildHourlyFocusPattern(
  segments: ActivitySegment[],
  weekStartDay: string,
  windowEndDay: string,
  options: ClassificationOptions,
  startOfDayMinutes = 0,
): HourlyFocusPoint[] {
  const windowStart = logicalDayStartMs(weekStartDay, startOfDayMinutes);
  const windowEnd = logicalDayEndExclusiveMs(windowEndDay, startOfDayMinutes);
  const totals = new Array<number>(24).fill(0);

  for (const segment of segments) {
    const { productivity } = classifyActivity(segment, options);
    if (productivity !== "focus") continue;

    let cursor = Math.max(new Date(segment.startedAt).getTime(), windowStart);
    const end = Math.min(new Date(segment.endedAt).getTime(), windowEnd);
    while (cursor < end) {
      const at = new Date(cursor);
      const nextHourBoundary = new Date(cursor).setMinutes(60, 0, 0);
      const overlapEnd = Math.min(end, nextHourBoundary);
      totals[at.getHours()] += (overlapEnd - cursor) / 1000;
      cursor = overlapEnd;
    }
  }

  return totals.map((seconds, hour) => ({ hour, focusSeconds: Math.max(0, Math.round(seconds / 7)) }));
}

/**
 * Pure: build the card aggregate from the segments fetched for the 30-day window.
 * The daily series covers the full 30 days (graphs + raw data); the headline aggregates
 * (focus/drift/neutral/share) stay scoped to the last 7 days so the card reads "this week".
 * Focus totals use the same rolling-focus math as the leaderboard (clipped to logical days).
 */
export function buildFocusCardPayload(monthSegments: ActivitySegment[], input: FocusCardInput): FocusCardPayload {
  const publishableMonthSegments = monthSegments.filter((segment) => !isPassiveSupportedSegment(segment) && !isExcludedSegment(segment));
  const monthStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "monthly");
  const weekStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "weekly");
  const sod = input.startOfDayMinutes;
  const options = {
    fallbackCandidates: publishableMonthSegments,
    includeAiClassifications: input.includeAiClassifications,
    includeBuiltInHeuristics: input.includeBuiltInHeuristics,
    builtInHeuristicsUnavailableSince: input.builtInHeuristicsUnavailableSince,
    categoryProductivity: input.categoryProductivity,
    deletedCategories: input.deletedCategories,
  };

  const focus7d = Math.round(buildRollingFocusSeconds(publishableMonthSegments, weekStartDay, input.windowEndDay, options, sod));
  const focusToday = Math.round(buildRollingFocusSeconds(publishableMonthSegments, input.windowEndDay, input.windowEndDay, options, sod));

  // Drift/neutral/share stay week-scoped: keep only segments overlapping the 7-day window
  // (same set a 7-day tracker fetch would return).
  const weekWindowStartMs = logicalDayStartMs(weekStartDay, sod);
  const weekSegments = publishableMonthSegments.filter((segment) => new Date(segment.endedAt).getTime() > weekWindowStartMs);
  const durations = buildProductivityDurations(weekSegments, { ...options, fallbackCandidates: weekSegments });
  const focusBucket = bucketSeconds(durations, "focus");
  const driftSeconds = bucketSeconds(durations, "drift");
  const neutralSeconds = bucketSeconds(durations, "neutral");
  const classified = focusBucket + driftSeconds + neutralSeconds;
  const focusShare = classified > 0 ? focusBucket / classified : 0;

  // Daily series via the same classify-and-split math as the local 30-day chart, so the
  // published chart embed matches what the user saw in-app.
  const dailyFocus: DailyFocusPoint[] = buildDailyProductivitySeries(publishableMonthSegments, monthStartDay, input.windowEndDay, options, sod)
    .map((point) => ({ day: point.day, focus: point.focus, drift: point.drift }));

  // Detail opt-ins: each field is computed AND attached only while its flag is on, so the
  // upsert clears the stored column the moment consent is withdrawn (service maps absent → []).
  const shareCategoryBreakdown = input.shareCategoryBreakdown === true;
  const shareHourlyPattern = input.shareHourlyPattern === true;
  const weekOptions = { ...options, fallbackCandidates: weekSegments };

  return {
    focus_seconds_today: focusToday,
    focus_seconds_7d: focus7d,
    drift_seconds_7d: driftSeconds,
    neutral_seconds_7d: neutralSeconds,
    focus_share: Number(focusShare.toFixed(4)),
    daily_focus: dailyFocus,
    window_start_date: monthStartDay,
    window_end_date: input.windowEndDay,
    share_category_breakdown: shareCategoryBreakdown,
    share_hourly_pattern: shareHourlyPattern,
    ...(shareCategoryBreakdown ? { category_breakdown_7d: buildCategoryBreakdown7d(weekSegments, weekOptions) } : {}),
    ...(shareHourlyPattern ? { hourly_focus_pattern: buildHourlyFocusPattern(publishableMonthSegments, weekStartDay, input.windowEndDay, options, sod) } : {}),
  };
}

/** Fetch the 30-day window from the tracker and compute the card payload. */
export async function buildFocusCardPayloadFromTracker(input: FocusCardInput): Promise<FocusCardPayload> {
  const monthStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "monthly");
  const fetched = await trackerClient.getCompactTimeline(getLogicalDayRange(monthStartDay, input.windowEndDay, input.startOfDayMinutes));
  // Same publish boundary as the leaderboard: imported estimates, passive-supported
  // time, and segments synced from other devices never feed this published card.
  const monthSegments = fetched.filter(
    (segment) => !isBrowserHistoryImportSegment(segment)
      && !isExcludedSegment(segment)
      && !isFailedForegroundCaptureSegment(segment)
      && !isPassiveSupportedSegment(segment)
      && !isRemoteDeviceSegment(segment),
  );
  return buildFocusCardPayload(monthSegments, {
    ...input,
    categoryProductivity: input.categoryProductivity ?? readCategoryProductivityPreferences(),
    deletedCategories: input.deletedCategories ?? readDeletedCategoryCutoffs(),
  });
}
