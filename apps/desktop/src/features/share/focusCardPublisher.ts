// Computes the aggregate for the public focus card (Phase 2 embed feature). Separate from the
// leaderboard publisher: the card carries a richer, card-only aggregate (drift/neutral split,
// focus share, per-day focus series) behind its own opt-in. Only derived aggregates are
// produced here — raw app/site/window/session history never leaves the device. Imported
// (estimated) browser-history segments are excluded, matching the leaderboard boundary.
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
import { buildDailyProductivitySeries } from "./dailyProductivity";

export interface DailyFocusPoint {
  readonly day: string;
  readonly focus: number;
  /** Daily drift seconds — published so the chart embed can show focus vs drift. */
  readonly drift: number;
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
}

export interface FocusCardInput {
  readonly windowEndDay: string;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
}

function bucketSeconds(durations: ReturnType<typeof buildProductivityDurations>, label: ProductivityLabel): number {
  return Math.max(0, Math.round(durations.find((entry) => entry.productivity === label)?.totalSeconds ?? 0));
}

/**
 * Pure: build the card aggregate from the segments fetched for the 30-day window.
 * The daily series covers the full 30 days (graphs + raw data); the headline aggregates
 * (focus/drift/neutral/share) stay scoped to the last 7 days so the card reads "this week".
 * Focus totals use the same rolling-focus math as the leaderboard (clipped to logical days).
 */
export function buildFocusCardPayload(monthSegments: ActivitySegment[], input: FocusCardInput): FocusCardPayload {
  const monthStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "monthly");
  const weekStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "weekly");
  const sod = input.startOfDayMinutes;
  const options = { fallbackCandidates: monthSegments, includeAiClassifications: input.includeAiClassifications };

  const focus7d = Math.round(buildRollingFocusSeconds(monthSegments, weekStartDay, input.windowEndDay, options, sod));
  const focusToday = Math.round(buildRollingFocusSeconds(monthSegments, input.windowEndDay, input.windowEndDay, options, sod));

  // Drift/neutral/share stay week-scoped: keep only segments overlapping the 7-day window
  // (same set a 7-day tracker fetch would return).
  const weekWindowStartMs = logicalDayStartMs(weekStartDay, sod);
  const weekSegments = monthSegments.filter((segment) => new Date(segment.endedAt).getTime() > weekWindowStartMs);
  const durations = buildProductivityDurations(weekSegments, { ...options, fallbackCandidates: weekSegments });
  const focusBucket = bucketSeconds(durations, "focus");
  const driftSeconds = bucketSeconds(durations, "drift");
  const neutralSeconds = bucketSeconds(durations, "neutral");
  const classified = focusBucket + driftSeconds + neutralSeconds;
  const focusShare = classified > 0 ? focusBucket / classified : 0;

  // Daily series via the same classify-and-split math as the local 30-day chart, so the
  // published chart embed matches what the user saw in-app.
  const dailyFocus: DailyFocusPoint[] = buildDailyProductivitySeries(monthSegments, monthStartDay, input.windowEndDay, options, sod)
    .map((point) => ({ day: point.day, focus: point.focus, drift: point.drift }));

  return {
    focus_seconds_today: focusToday,
    focus_seconds_7d: focus7d,
    drift_seconds_7d: driftSeconds,
    neutral_seconds_7d: neutralSeconds,
    focus_share: Number(focusShare.toFixed(4)),
    daily_focus: dailyFocus,
    window_start_date: monthStartDay,
    window_end_date: input.windowEndDay,
  };
}

/** Fetch the 30-day window from the tracker and compute the card payload. */
export async function buildFocusCardPayloadFromTracker(input: FocusCardInput): Promise<FocusCardPayload> {
  const monthStartDay = getLeaderboardWindowStartDay(input.windowEndDay, "monthly");
  const fetched = await trackerClient.getTimeline(getLogicalDayRange(monthStartDay, input.windowEndDay, input.startOfDayMinutes));
  // Same publish boundary as the leaderboard: imported estimates and segments
  // synced from other Macs never feed this device's published card.
  const monthSegments = fetched.filter(
    (segment) => !isBrowserHistoryImportSegment(segment) && !isRemoteDeviceSegment(segment),
  );
  return buildFocusCardPayload(monthSegments, input);
}
