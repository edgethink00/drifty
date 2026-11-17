import {
  buildRollingFocusSeconds,
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  isPassiveSupportedSegment,
  isRemoteDeviceSegment,
} from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import { readCategoryProductivityPreferences, readDeletedCategoryCutoffs } from "../settings/categoryCustomizationStore";
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
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
};

export type PublishLeaderboardPeriodsInput = {
  readonly mode: LeaderboardPublishMode;
  readonly profileDisplayName: string;
  readonly leaderboardWindowEndDay: string;
  readonly timezone: string;
  readonly startOfDayMinutes: number;
  readonly showAiClassificationImpact: boolean;
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
  /** Category productivity preferences; read from Settings when omitted. */
  readonly categoryProductivity?: ClassificationOptions["categoryProductivity"];
  readonly deletedCategories?: ClassificationOptions["deletedCategories"];
  /** Revalidate mutable publication policy after local payload construction. */
  readonly publicationAllowed: () => boolean;
  /** Specific reason if publication is blocked by the assessment gate. */
  readonly publicationBlockedError?: () => string | null;
  readonly publicationBlockedReason?: () => "catching_up" | "checking" | "quota_exceeded" | "plan_check_failed" | "paused" | null;
};

export type PublishLeaderboardPeriodsResult = LeaderboardResult<LeaderboardPublishPayloads> & {
  /** Distinguish gate advice from a failed service request without parsing copy. */
  readonly blockedByAssessment?: true;
};

export async function buildLeaderboardPublishPayloads(
  input: Omit<PublishLeaderboardPeriodsInput, "mode" | "publicationAllowed">,
): Promise<LeaderboardPublishPayloads> {
  const leaderboardWindowEndDay = logicalTodayIsoDate(input.startOfDayMinutes);
  const allPeriodWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, "monthly");
  const fetchedSegments = await trackerClient.getCompactTimeline(getLogicalDayRange(
    allPeriodWindowStartDay,
    leaderboardWindowEndDay,
    input.startOfDayMinutes,
  ));
  // Imported estimates and passive-supported time stay local-only; never publish them
  // to the shared leaderboard totals. Segments synced from another Mac are excluded
  // too — the originating device publishes its own totals, so counting them here
  // would double-publish the same time.
  const allPeriodSegments = fetchedSegments.filter(
    (segment) => !isBrowserHistoryImportSegment(segment)
      && !isExcludedSegment(segment)
      && !isFailedForegroundCaptureSegment(segment)
      && !isPassiveSupportedSegment(segment)
      && !isRemoteDeviceSegment(segment),
  );

  return {
    segmentCount: allPeriodSegments.length,
    payloads: LEADERBOARD_PERIODS.map((period) => buildLeaderboardPublishPayload(period, allPeriodSegments, {
      ...input,
      leaderboardWindowEndDay,
      categoryProductivity: input.categoryProductivity ?? readCategoryProductivityPreferences(),
      deletedCategories: input.deletedCategories ?? readDeletedCategoryCutoffs(),
    })),
  };
}

export async function buildLeaderboardCheckpointPayload(
  input: BuildLeaderboardCheckpointPayloadInput,
): Promise<LeaderboardPublishPayload> {
  const windowStartDay = getLeaderboardWindowStartDay(input.windowEndDay, input.period);
  const fetchedSegments = await trackerClient.getCompactTimeline(getLogicalDayRange(
    windowStartDay,
    input.windowEndDay,
    input.startOfDayMinutes,
  ));
  const publishableSegments = fetchedSegments.filter(
    (segment) => !isBrowserHistoryImportSegment(segment)
      && !isExcludedSegment(segment)
      && !isFailedForegroundCaptureSegment(segment)
      && !isPassiveSupportedSegment(segment)
      && !isRemoteDeviceSegment(segment),
  );

  return buildLeaderboardPublishPayload(input.period, publishableSegments, {
    profileDisplayName: input.profileDisplayName,
    leaderboardWindowEndDay: input.windowEndDay,
    timezone: input.timezone,
    startOfDayMinutes: input.startOfDayMinutes,
    showAiClassificationImpact: input.showAiClassificationImpact,
    includeBuiltInHeuristics: input.includeBuiltInHeuristics,
    builtInHeuristicsUnavailableSince: input.builtInHeuristicsUnavailableSince,
    categoryProductivity: readCategoryProductivityPreferences(),
    deletedCategories: readDeletedCategoryCutoffs(),
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
      return publishOwnFocusTotal(input, undefined, { updateProfile: false, requireOptIn: true });
    }

    return publishOwnFocusTotal(input);
  }));

  return results.find((result) => !result.success) ?? results[0] ?? { success: true, error: null };
}

export async function publishLeaderboardPeriods(input: PublishLeaderboardPeriodsInput): Promise<PublishLeaderboardPeriodsResult> {
  const { publicationAllowed, ...payloadInput } = input;
  const payloads = await buildLeaderboardPublishPayloads(payloadInput);
  if (!publicationAllowed()) {
    const blockedReason = input.publicationBlockedReason?.() ?? "paused";
    const error = input.publicationBlockedError ? input.publicationBlockedError() : (blockedReason === "plan_check_failed"
      ? "Your Cloud plan could not be verified. Open AI settings and refresh your plan, then try again."
      : blockedReason === "quota_exceeded"
      ? "Cloud AI classification limit reached before publishing focus totals."
      : blockedReason === "catching_up"
        ? "AI is catching up on recent activity. You can publish focus totals once catch-up completes."
        : blockedReason === "checking"
          ? "AI connection is being verified. Please try publishing again in a moment."
          : "AI classification is paused. Reconnect AI before publishing focus totals.");
    return {
      success: false,
      error,
      data: payloads,
      blockedByAssessment: true,
    };
  }
  const result = await publishLeaderboardPayloads(input.mode, payloads.payloads);
  if (!result.success) {
    return { success: false, error: result.error ?? "Unable to publish leaderboard", data: payloads };
  }
  return { success: true, error: null, data: payloads };
}

function buildLeaderboardPublishPayload(
  period: LeaderboardPeriod,
  allPeriodSegments: ActivitySegment[],
  input: Omit<PublishLeaderboardPeriodsInput, "mode" | "publicationAllowed">,
): LeaderboardPublishPayload {
  const windowStartDay = getLeaderboardWindowStartDay(input.leaderboardWindowEndDay, period);
  const focusSeconds = buildRollingFocusSeconds(allPeriodSegments, windowStartDay, input.leaderboardWindowEndDay, {
    fallbackCandidates: allPeriodSegments,
    includeAiClassifications: input.showAiClassificationImpact,
    includeBuiltInHeuristics: input.includeBuiltInHeuristics,
    builtInHeuristicsUnavailableSince: input.builtInHeuristicsUnavailableSince,
    categoryProductivity: input.categoryProductivity,
    deletedCategories: input.deletedCategories,
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
