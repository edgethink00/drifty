import { buildRollingFocusSeconds, isBrowserHistoryImportSegment, isRemoteDeviceSegment } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import { buildLeaderboardAutoPublishPayloadKey } from "./leaderboardAutoPublishState";
import { getLeaderboardWindowStartDay } from "./leaderboardWindow";
import {
  LEADERBOARD_PERIODS,
  publishOwnFocusTotal,
  type LeaderboardPeriod,
  type LeaderboardResult,
} from "./leaderboardService";

export type LeaderboardPublishMode = "join" | "auto";

export type LeaderboardPublishPayload = {
  readonly profileDisplayName: string;
  readonly period: LeaderboardPeriod;
  readonly focusSeconds: number;
  readonly windowStartDay: string;
  readonly windowEndDay: string;
  readonly timezone: string;
  readonly payloadKey: string;
};

export type LeaderboardPublishPayloads = {
  readonly segmentCount: number;
  readonly payloads: readonly LeaderboardPublishPayload[];
};

export type BuildLeaderboardCheckpointPayloadInput = {
  readonly period: Extract<LeaderboardPeriod, "daily" | "weekly">;
  readonly profileDisplayName: string;
  readonly windowEndDay: string;
  readonly timezone: string;
  readonly startOfDayMinutes: number;
  readonly showAiClassificationImpact: boolean;
};

export type PublishLeaderboardPeriodsInput = {
  readonly mode: LeaderboardPublishMode;
  readonly profileDisplayName: string;
  readonly leaderboardWindowEndDay: string;
  readonly timezone: string;
  readonly startOfDayMinutes: number;
  readonly showAiClassificationImpact: boolean;
};

export type PublishLeaderboardPeriodsResult = LeaderboardResult<LeaderboardPublishPayloads>;

export async function buildLeaderboardPublishPayloads(input: Omit<PublishLeaderboardPeriodsInput, "mode">): Promise<LeaderboardPublishPayloads> {
  const leaderboardWindowEndDay = logicalTodayIsoDate(input.startOfDayMinutes);
  const allPeriodWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, "monthly");
  const fetchedSegments = await trackerClient.getTimeline(getLogicalDayRange(
    allPeriodWindowStartDay,
    leaderboardWindowEndDay,
    input.startOfDayMinutes,
  ));
  // Imported (estimated) browser-history segments stay local-only; never publish them
  // to the shared leaderboard totals. Segments synced from another Mac are excluded
  // too — the originating device publishes its own totals, so counting them here
  // would double-publish the same time.
  const allPeriodSegments = fetchedSegments.filter(
    (segment) => !isBrowserHistoryImportSegment(segment) && !isRemoteDeviceSegment(segment),
  );

  return {
    segmentCount: allPeriodSegments.length,
    payloads: LEADERBOARD_PERIODS.map((period) => buildLeaderboardPublishPayload(period, allPeriodSegments, {
      ...input,
      leaderboardWindowEndDay,
    })),
  };
}

export async function buildLeaderboardCheckpointPayload(
  input: BuildLeaderboardCheckpointPayloadInput,
): Promise<LeaderboardPublishPayload> {
  const windowStartDay = getLeaderboardWindowStartDay(input.windowEndDay, input.period);
  const fetchedSegments = await trackerClient.getTimeline(getLogicalDayRange(
    windowStartDay,
    input.windowEndDay,
    input.startOfDayMinutes,
  ));
  const publishableSegments = fetchedSegments.filter(
    (segment) => !isBrowserHistoryImportSegment(segment) && !isRemoteDeviceSegment(segment),
  );

  return buildLeaderboardPublishPayload(input.period, publishableSegments, {
    profileDisplayName: input.profileDisplayName,
    leaderboardWindowEndDay: input.windowEndDay,
    timezone: input.timezone,
    startOfDayMinutes: input.startOfDayMinutes,
    showAiClassificationImpact: input.showAiClassificationImpact,
  });
}

export async function publishLeaderboardPayloads(
  mode: LeaderboardPublishMode,
  payloads: readonly LeaderboardPublishPayload[],
): Promise<LeaderboardResult> {
  const results = await Promise.all(payloads.map((payload) => {
    const input = {
      profileDisplayName: payload.profileDisplayName,
      period: payload.period,
      focus_seconds: payload.focusSeconds,
      focus_seconds_7d: payload.focusSeconds,
      window_start_date: payload.windowStartDay,
      window_end_date: payload.windowEndDay,
      timezone: payload.timezone,
    };

    if (mode === "auto") {
      return publishOwnFocusTotal(input, undefined, { updateProfile: false });
    }

    return publishOwnFocusTotal(input);
  }));

  return results.find((result) => !result.success) ?? results[0] ?? { success: true, error: null };
}

export async function publishLeaderboardPeriods(input: PublishLeaderboardPeriodsInput): Promise<PublishLeaderboardPeriodsResult> {
  const payloads = await buildLeaderboardPublishPayloads(input);
  const result = await publishLeaderboardPayloads(input.mode, payloads.payloads);
  if (!result.success) {
    return { success: false, error: result.error ?? "Unable to publish leaderboard", data: payloads };
  }
  return { success: true, error: null, data: payloads };
}

function buildLeaderboardPublishPayload(
  period: LeaderboardPeriod,
  allPeriodSegments: ActivitySegment[],
  input: Omit<PublishLeaderboardPeriodsInput, "mode">,
): LeaderboardPublishPayload {
  const windowStartDay = getLeaderboardWindowStartDay(input.leaderboardWindowEndDay, period);
  const focusSeconds = buildRollingFocusSeconds(allPeriodSegments, windowStartDay, input.leaderboardWindowEndDay, {
    fallbackCandidates: allPeriodSegments,
    includeAiClassifications: input.showAiClassificationImpact,
  }, input.startOfDayMinutes);

  return {
    profileDisplayName: input.profileDisplayName,
    period,
    focusSeconds,
    windowStartDay,
    windowEndDay: input.leaderboardWindowEndDay,
    timezone: input.timezone,
    payloadKey: buildLeaderboardAutoPublishPayloadKey({
      profileDisplayName: input.profileDisplayName,
      period,
      focusSeconds,
      windowStartDay,
      windowEndDay: input.leaderboardWindowEndDay,
      timezone: input.timezone,
    }),
  };
}
