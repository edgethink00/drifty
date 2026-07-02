import {
  buildEffectiveProductivityDurations,
  buildRollingFocusSeconds,
  shiftIsoDate,
} from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";

import { getLogicalDayRange } from "../../lib/formatting";
import { DEFAULT_TEAM_PERIOD, type TeamPeriod } from "./teamService";

export type TeamFocusWindow = {
  readonly period: TeamPeriod;
  readonly window_start_date: string;
  readonly window_end_date: string;
};

export type TeamFocusAggregate = TeamFocusWindow & {
  readonly display_name: string;
  readonly role_label: string;
  readonly focus_seconds: number;
  readonly focus_score: number;
  readonly active_seconds: number;
  readonly timezone: string;
};

export type TeamFocusAggregateResult =
  | { readonly success: true; readonly error: null; readonly data: TeamFocusAggregate }
  | { readonly success: false; readonly error: string; readonly reason: "invalid_period" };

export type TeamFocusAggregateInput = {
  readonly localActivity: ActivitySegment[];
  readonly period: TeamPeriod | string | null | undefined;
  readonly windowEndDay: string;
  readonly displayName: string | null | undefined;
  readonly roleLabel: string | null | undefined;
  readonly timezone?: string | null;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
};

export function getTeamFocusWindow(period: TeamPeriod | string | null | undefined, windowEndDay: string): TeamFocusWindow | null {
  const parsedPeriod = parseTeamPeriod(period);
  if (!parsedPeriod) return null;

  switch (parsedPeriod) {
    case "daily":
      return { period: parsedPeriod, window_start_date: windowEndDay, window_end_date: windowEndDay };
    case "weekly":
      return { period: parsedPeriod, window_start_date: shiftIsoDate(windowEndDay, -6), window_end_date: windowEndDay };
    case "monthly":
      return { period: parsedPeriod, window_start_date: shiftIsoDate(windowEndDay, -29), window_end_date: windowEndDay };
    default:
      return assertNever(parsedPeriod);
  }
}

export function buildTeamFocusAggregate(input: TeamFocusAggregateInput): TeamFocusAggregateResult {
  const window = getTeamFocusWindow(input.period, input.windowEndDay);
  if (!window) {
    return { success: false, error: "Unsupported team focus period.", reason: "invalid_period" };
  }

  const classificationOptions: ClassificationOptions = {
    fallbackCandidates: input.localActivity,
    includeAiClassifications: input.includeAiClassifications,
  };
  const focusSeconds = buildRollingFocusSeconds(
    input.localActivity,
    window.window_start_date,
    window.window_end_date,
    classificationOptions,
    input.startOfDayMinutes,
  );
  const windowedActivity = clipLocalActivityToWindow(
    input.localActivity,
    window.window_start_date,
    window.window_end_date,
    input.startOfDayMinutes,
  );
  const windowedClassificationOptions: ClassificationOptions = {
    fallbackCandidates: windowedActivity,
    includeAiClassifications: input.includeAiClassifications,
  };
  const activeSeconds = buildEffectiveProductivityDurations(windowedActivity, windowedClassificationOptions)
    .reduce((sum, duration) => sum + Math.max(0, duration.totalSeconds), 0);

  return {
    success: true,
    error: null,
    data: {
      ...window,
      display_name: displayNameOrFallback(input.displayName),
      role_label: roleLabelOrFallback(input.roleLabel),
      focus_seconds: Math.max(0, focusSeconds),
      focus_score: activeSeconds > 0 ? roundToTwoDecimals(focusSeconds / activeSeconds * 100) : 0,
      active_seconds: activeSeconds,
      timezone: timezoneOrFallback(input.timezone),
    },
  };
}

export function roundToTwoDecimals(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function parseTeamPeriod(period: TeamPeriod | string | null | undefined): TeamPeriod | null {
  switch (period) {
    case "daily":
    case "weekly":
    case "monthly":
      return period;
    default:
      return null;
  }
}

export function getDefaultTeamFocusWindow(windowEndDay: string): TeamFocusWindow {
  return getTeamFocusWindow(DEFAULT_TEAM_PERIOD, windowEndDay) ?? {
    period: DEFAULT_TEAM_PERIOD,
    window_start_date: shiftIsoDate(windowEndDay, -6),
    window_end_date: windowEndDay,
  };
}

function clipLocalActivityToWindow(
  localActivity: ActivitySegment[],
  windowStartDay: string,
  windowEndDay: string,
  startOfDayMinutes: number,
): ActivitySegment[] {
  const windowRange = getLogicalDayRange(windowStartDay, windowEndDay, startOfDayMinutes);
  const windowStartMs = new Date(windowRange.start).getTime();
  const windowEndExclusiveMs = new Date(windowRange.end).getTime() + 1000;

  return localActivity.flatMap((activity) => {
    const startedAtMs = new Date(activity.startedAt).getTime();
    const endedAtMs = new Date(activity.endedAt).getTime();
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) return [];

    const clippedStartMs = Math.max(startedAtMs, windowStartMs);
    const clippedEndMs = Math.min(endedAtMs, windowEndExclusiveMs);
    if (clippedEndMs <= clippedStartMs) return [];

    const durationSeconds = Math.round((clippedEndMs - clippedStartMs) / 1000);
    if (durationSeconds <= 0) return [];

    return [{
      ...activity,
      startedAt: new Date(clippedStartMs).toISOString(),
      endedAt: new Date(clippedEndMs).toISOString(),
      durationSeconds,
    }];
  });
}

function displayNameOrFallback(displayName: string | null | undefined): string {
  return displayName?.trim() || "Drifty member";
}

function roleLabelOrFallback(roleLabel: string | null | undefined): string {
  return roleLabel?.trim() || "Member";
}

function timezoneOrFallback(timezone: string | null | undefined): string {
  return timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function assertNever(value: never): never {
  throw new Error(`Unexpected team focus period: ${String(value)}`);
}
