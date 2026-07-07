// Computes the aggregate for the public focus card (Phase 2 embed feature). Separate from the
// leaderboard publisher: the card carries a richer, card-only aggregate (drift/neutral split,
// focus share, per-day focus series) behind its own opt-in. Only derived aggregates are
// produced here — raw app/site/window/session history never leaves the device. Imported
// (estimated) browser-history segments are excluded, matching the leaderboard boundary.
import {
  buildProductivityDurations,
  buildRollingFocusSeconds,
  isBrowserHistoryImportSegment,
  shiftIsoDate,
} from "@drifty/domain";
import type { ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import { getLeaderboardWindowStartDay } from "../leaderboard/leaderboardWindow";

export interface DailyFocusPoint {
  readonly day: string;
  readonly focus: number;
}

export interface FocusCardPayload {
  readonly focus_seconds_today: number;
  readonly focus_seconds_7d: number;
  readonly drift_seconds_7d: number;
  readonly neutral_seconds_7d: number;
  /** Focus as a share of classified time, 0..1. */
  readonly focus_share: number;
  /** Per-logical-day focus seconds across the 7-day window (7 entries). */
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
 * Pure: build the card aggregate from the segments already fetched for the 7-day window.
 * Focus totals use the same rolling-focus math as the leaderboard (clipped to logical days);
 * drift/neutral + focus_share come from the classified-time split over the window.
 */
export function buildFocusCardPayload(weekSegments: ActivitySegment[], input: FocusCardInput): FocusCardPayload {
  const startDay = getLeaderboardWindowStartDay(input.windowEndDay, "weekly");
  const options = { fallbackCandidates: weekSegments, includeAiClassifications: input.includeAiClassifications };
  const sod = input.startOfDayMinutes;

  const focus7d = Math.round(buildRollingFocusSeconds(weekSegments, startDay, input.windowEndDay, options, sod));
  const focusToday = Math.round(buildRollingFocusSeconds(weekSegments, input.windowEndDay, input.windowEndDay, options, sod));

  const durations = buildProductivityDurations(weekSegments, options);
  const focusBucket = bucketSeconds(durations, "focus");
  const driftSeconds = bucketSeconds(durations, "drift");
  const neutralSeconds = bucketSeconds(durations, "neutral");
  const classified = focusBucket + driftSeconds + neutralSeconds;
  const focusShare = classified > 0 ? focusBucket / classified : 0;

  const dailyFocus: DailyFocusPoint[] = [];
  for (let day = startDay; day <= input.windowEndDay; day = shiftIsoDate(day, 1)) {
    dailyFocus.push({ day, focus: Math.round(buildRollingFocusSeconds(weekSegments, day, day, options, sod)) });
  }

  return {
    focus_seconds_today: focusToday,
    focus_seconds_7d: focus7d,
    drift_seconds_7d: driftSeconds,
    neutral_seconds_7d: neutralSeconds,
    focus_share: Number(focusShare.toFixed(4)),
    daily_focus: dailyFocus,
    window_start_date: startDay,
    window_end_date: input.windowEndDay,
  };
}

/** Fetch the 7-day window from the tracker and compute the card payload. */
export async function buildFocusCardPayloadFromTracker(input: FocusCardInput): Promise<FocusCardPayload> {
  const startDay = getLeaderboardWindowStartDay(input.windowEndDay, "weekly");
  const fetched = await trackerClient.getTimeline(getLogicalDayRange(startDay, input.windowEndDay, input.startOfDayMinutes));
  const weekSegments = fetched.filter((segment) => !isBrowserHistoryImportSegment(segment));
  return buildFocusCardPayload(weekSegments, input);
}
