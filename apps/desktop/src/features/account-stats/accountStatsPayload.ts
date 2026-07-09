// Computes the USER-PRIVATE account activity summary the Mac app publishes to
// `account_activity_summaries` so drifty.so's account page can render a web dashboard.
// Unlike the public focus card, this row is self-view only (owner-only RLS, no RPC), so
// every field is ALWAYS computed — there are no per-field consent flags. It is still
// aggregate-only by design: bucketed second totals, category totals, an hour-of-day
// rhythm, top-app totals, and a per-day series. Raw app/site/window/session history
// never leaves the device. Imported (estimated) browser-history segments are excluded,
// matching the leaderboard and focus-card boundary. Segments synced in from another
// Mac are excluded too — each Mac publishes only its own local time, otherwise two
// synced devices would each publish an inflated total that double-counts the other's
// activity.
import {
  buildProductivityDurations,
  buildRollingFocusSeconds,
  isBrowserHistoryImportSegment,
  isRemoteDeviceSegment,
  logicalDayStartMs,
} from "@drifty/domain";
import type { ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import { getLeaderboardWindowStartDay } from "../leaderboard/leaderboardWindow";
import {
  buildCategoryBreakdown7d,
  buildHourlyFocusPattern,
  buildTopApps7d,
} from "../share/focusCardPublisher";
import type { CategoryBreakdownEntry, HourlyFocusPoint, TopAppEntry } from "../share/focusCardPublisher";
import { buildDailyProductivitySeries } from "../share/dailyProductivity";
import type { DailyProductivityPoint } from "../share/dailyProductivity";

/** CamelCase mirror of the `account_activity_summaries` columns; the service maps to snake_case. */
export interface AccountStatsPayload {
  readonly focusSecondsToday: number;
  readonly driftSecondsToday: number;
  readonly neutralSecondsToday: number;
  readonly categoryBreakdownToday: readonly CategoryBreakdownEntry[];
  readonly focusSeconds7d: number;
  readonly driftSeconds7d: number;
  readonly neutralSeconds7d: number;
  /** Focus as a share of classified time over the last 7 days, 0..1 (4 decimals). */
  readonly focusShare7d: number;
  readonly categoryBreakdown7d: readonly CategoryBreakdownEntry[];
  /** 24 entries of {hour, focusSeconds}: focus averaged per hour-of-day across the 7-day window. */
  readonly hourlyPattern7d: readonly HourlyFocusPoint[];
  /** Max 5 of {appName, seconds}; only apps with >= 15 minutes over the week. */
  readonly topApps7d: readonly TopAppEntry[];
  /** Per-logical-day {day, focus, drift, neutral} seconds across the 30-day window. */
  readonly dailySeries30d: readonly DailyProductivityPoint[];
  readonly windowEndDate: string;
  readonly timezone: string;
}

export interface AccountStatsInput {
  readonly windowEndDay: string;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
}

function bucketSeconds(durations: ReturnType<typeof buildProductivityDurations>, label: ProductivityLabel): number {
  return Math.max(0, Math.round(durations.find((entry) => entry.productivity === label)?.totalSeconds ?? 0));
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Pure: build the account summary from the segments fetched for the 30-day window.
 * Window math mirrors buildFocusCardPayload exactly: focus totals use the same rolling-focus
 * clipping as the leaderboard; drift/neutral/share stay scoped by keeping only segments that
 * overlap the sub-window (same set a 7-day / 1-day tracker fetch would return); the daily
 * series carries the full 30 days.
 */
export function buildAccountStatsPayload(monthSegments: ActivitySegment[], input: AccountStatsInput): AccountStatsPayload {
  const monthStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "monthly");
  const weekStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "weekly");
  const sod = input.startOfDayMinutes;
  const options = { fallbackCandidates: monthSegments, includeAiClassifications: input.includeAiClassifications };

  const focus7d = Math.round(buildRollingFocusSeconds(monthSegments, weekStartDay, input.windowEndDay, options, sod));
  const focusToday = Math.round(buildRollingFocusSeconds(monthSegments, input.windowEndDay, input.windowEndDay, options, sod));

  // 7-day slice: keep only segments overlapping the week window (same as focusCardPublisher).
  const weekWindowStartMs = logicalDayStartMs(weekStartDay, sod);
  const weekSegments = monthSegments.filter((segment) => new Date(segment.endedAt).getTime() > weekWindowStartMs);
  const weekOptions = { ...options, fallbackCandidates: weekSegments };
  const weekDurations = buildProductivityDurations(weekSegments, weekOptions);
  const drift7d = bucketSeconds(weekDurations, "drift");
  const neutral7d = bucketSeconds(weekDurations, "neutral");
  const focusBucket7d = bucketSeconds(weekDurations, "focus");
  const classified7d = focusBucket7d + drift7d + neutral7d;
  const focusShare7d = classified7d > 0 ? focusBucket7d / classified7d : 0;

  // Today slice: the analogous 1-logical-day cut of the month window.
  const todayWindowStartMs = logicalDayStartMs(input.windowEndDay, sod);
  const todaySegments = monthSegments.filter((segment) => new Date(segment.endedAt).getTime() > todayWindowStartMs);
  const todayOptions = { ...options, fallbackCandidates: todaySegments };
  const todayDurations = buildProductivityDurations(todaySegments, todayOptions);

  return {
    focusSecondsToday: focusToday,
    driftSecondsToday: bucketSeconds(todayDurations, "drift"),
    neutralSecondsToday: bucketSeconds(todayDurations, "neutral"),
    // buildCategoryBreakdown7d is generic over the segment slice it is given — over the
    // today slice it yields today's category totals with the same math as the local donut.
    categoryBreakdownToday: buildCategoryBreakdown7d(todaySegments, todayOptions),
    focusSeconds7d: focus7d,
    driftSeconds7d: drift7d,
    neutralSeconds7d: neutral7d,
    focusShare7d: Number(focusShare7d.toFixed(4)),
    categoryBreakdown7d: buildCategoryBreakdown7d(weekSegments, weekOptions),
    hourlyPattern7d: buildHourlyFocusPattern(monthSegments, weekStartDay, input.windowEndDay, options, sod),
    topApps7d: buildTopApps7d(weekSegments),
    dailySeries30d: buildDailyProductivitySeries(monthSegments, monthStartDay, input.windowEndDay, options, sod),
    windowEndDate: input.windowEndDay,
    timezone: resolveTimezone(),
  };
}

/** Fetch the 30-day window from the tracker and compute the account summary. */
export async function buildAccountStatsPayloadFromTracker(input: AccountStatsInput): Promise<AccountStatsPayload> {
  const monthStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "monthly");
  const fetched = await trackerClient.getTimeline(getLogicalDayRange(monthStartDay, input.windowEndDay, input.startOfDayMinutes));
  const monthSegments = fetched.filter(
    (segment) => !isBrowserHistoryImportSegment(segment) && !isRemoteDeviceSegment(segment),
  );
  return buildAccountStatsPayload(monthSegments, input);
}
