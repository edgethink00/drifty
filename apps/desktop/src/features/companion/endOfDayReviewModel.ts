import type { CloudQuotaRecovery } from "../classification/cloudQuotaGuidance";
import {
  aggregateDeviceElapsedTime,
  activityTimeBounds,
  activitySecondsWithinInterval,
  buildAppUsageSummaries,
  buildProductivityDurations,
  classifyActivityDetailed,
  clipDeviceElapsedTimeSegment,
  isBrowserHistoryImportSegment,
  isFailedForegroundCaptureSegment,
  logicalDayEndExclusiveMs,
  logicalDayStartMs,
  shiftIsoDate,
  secondsToLabel,
  type ActivitySegment,
  type AppIconMap,
  type ClassificationOptions,
} from "@drifty/domain";
import type { CompanionDayReviewLayout } from "./companionPillLayout";
import type { LeaderboardCelebration } from "./companionLeaderboardMilestones";
import { joinProductivityRuns, longestProductivityRun, toProductivityRunPart } from "../../lib/productivityRuns";
import type {
  ClassificationAvailabilityReason,
  ClassificationProviderRoute,
  ClassificationRecoveryAction,
} from "../classification/classificationAvailability";

/**
 * UI-neutral data contract shared by the production Companion renderer and
 * the retained legacy design reference. Runtime modules must depend on this
 * model instead of importing the legacy component module.
 */
export type EndOfDayReviewBreakdownKey = "focus" | "drift" | "other" | "unclassified";

export type EndOfDayReviewTopSource = {
  appName: string;
  bundleId?: string | null;
  iconSrc?: string | null;
  sourceLabel: string;
  durationSeconds: number;
};

export type EndOfDayReviewBreakdownSource = EndOfDayReviewTopSource & {
  key: EndOfDayReviewBreakdownKey;
};

export type EndOfDayReviewCategorySummary = {
  label: string;
  durationSeconds: number;
  percent: number;
};

export type EndOfDayReviewSourceSummary = EndOfDayReviewTopSource & {
  percent: number;
};

export type EndOfDayReviewComparison = {
  focusDeltaSeconds: number;
  driftDeltaSeconds: number;
  otherDeltaSeconds: number;
  /** sameTime: yesterday up to this time of day (a live evening review). wholeDay: two finished days (a catch-up review). */
  scope?: "sameTime" | "wholeDay";
};

export type EndOfDayReviewDailySignals = {
  deepSessionCount: number;
  longestFocusRunSeconds: number;
  /** ISO timestamp of when the longest focus run began; null when there was none. */
  longestFocusRunStartedAt?: string | null;
  peakHourLabel: string | null;
  peakHourFocusSeconds: number;
};

export type EndOfDayReviewPendingAssessment = {
  state: "pending";
  route: ClassificationProviderRoute;
  reason: ClassificationAvailabilityReason;
  recoveryAction: ClassificationRecoveryAction;
  cloudQuota?: CloudQuotaRecovery;
  unavailableSince?: string | null;
  pendingSeconds?: number;
};

export type EndOfDayReviewEvent = {
  kind: "endOfDayReview";
  /** Presentation choice carried into the dedicated Companion webview. */
  layout?: CompanionDayReviewLayout;
  placement?: "top-right";
  day: string;
  generatedAt: string;
  /** Producer deadline for a queued/deferred card. */
  expiresAt?: string;
  /** Logical day whose single interruption slot this card consumes. */
  presentationDay?: string;
  trackedLabel: string;
  focusLabel: string;
  driftLabel: string;
  totalSeconds: number;
  focusSeconds: number;
  driftSeconds: number;
  neutralSeconds?: number;
  unclassifiedSeconds?: number;
  topSource: EndOfDayReviewTopSource | null;
  breakdownSources?: EndOfDayReviewBreakdownSource[];
  categorySummaries?: EndOfDayReviewCategorySummary[];
  sourceSummaries?: EndOfDayReviewSourceSummary[];
  highlightLabel?: string;
  comparison?: EndOfDayReviewComparison;
  dailySignals?: EndOfDayReviewDailySignals;
  leaderboardCelebration?: LeaderboardCelebration;
  /**
   * The day was captured, but its AI-derived evaluation is not currently
   * trustworthy. Renderers must keep raw/descriptive facts and withhold
   * focus, drift, comparison, record, and rank conclusions.
   */
  assessment?: EndOfDayReviewPendingAssessment;
  isMock?: boolean;
};

/** Yesterday must have been watched for at least this long (imports excluded) to be compared against. */
export const END_OF_DAY_REVIEW_COMPARISON_MIN_OBSERVED_SECONDS = 3 * 60 * 60;

/**
 * Today against yesterday up to the same point of the day: a review at 8 PM compares with yesterday
 * until 8 PM, and a catch-up review of a finished day compares whole days. Yesterday only counts when
 * Drifty watched enough of it; time rebuilt from browser history is not a day Drifty saw.
 */
export function buildEndOfDayReviewComparison({
  day,
  generatedAt,
  previousDaySegments,
  current,
  classificationOptions,
  startOfDayMinutes = 0,
}: {
  day: string;
  generatedAt: string;
  previousDaySegments: readonly ActivitySegment[];
  current: { readonly focusSeconds: number; readonly driftSeconds: number; readonly neutralSeconds: number };
  classificationOptions?: ClassificationOptions;
  startOfDayMinutes?: number;
}): EndOfDayReviewComparison | undefined {
  const observed = aggregateDeviceElapsedTime(previousDaySegments.filter((segment) => !isBrowserHistoryImportSegment(segment) && !isFailedForegroundCaptureSegment(segment)));
  const observedSeconds = observed.reduce((total, segment) => total + Math.max(0, segment.durationSeconds), 0);
  if (observedSeconds < END_OF_DAY_REVIEW_COMPARISON_MIN_OBSERVED_SECONDS) return undefined;
  const previousDay = shiftIsoDate(day, -1);
  const elapsedMs = Date.parse(generatedAt) - logicalDayStartMs(day, startOfDayMinutes);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return undefined;
  const previousDayEndMs = logicalDayEndExclusiveMs(previousDay, startOfDayMinutes);
  // Compare the same local clock, even when DST makes these days differ in length.
  const previousClock = new Date(generatedAt);
  previousClock.setDate(previousClock.getDate() - 1);
  const cutoffMs = Math.min(previousClock.getTime(), previousDayEndMs);
  const window = { start: logicalDayStartMs(previousDay, startOfDayMinutes), end: cutoffMs };
  const clipped = observed.map((segment) => clipDeviceElapsedTimeSegment(segment, window));
  const previous = buildProductivityDurations(clipped, classificationOptions);
  const secondsOf = (label: "focus" | "drift" | "neutral") => previous.find((entry) => entry.productivity === label)?.totalSeconds ?? 0;
  return {
    focusDeltaSeconds: Math.round(current.focusSeconds - secondsOf("focus")),
    driftDeltaSeconds: Math.round(current.driftSeconds - secondsOf("drift")),
    otherDeltaSeconds: Math.round(current.neutralSeconds - secondsOf("neutral")),
    scope: cutoffMs >= previousDayEndMs ? "wholeDay" : "sameTime",
  };
}

export function buildEndOfDayReviewSummary({
  day,
  generatedAt,
  segments,
  previousDaySegments,
  startOfDayMinutes = 0,
  appIcons = {},
  classificationOptions,
  leaderboardCelebration,
  assessment,
  isMock = false,
}: {
  day: string;
  generatedAt: string;
  segments: ActivitySegment[];
  /** The previous logical day, for the "vs yesterday" rows. Omitted or too thin: no comparison. */
  previousDaySegments?: readonly ActivitySegment[];
  startOfDayMinutes?: number;
  appIcons?: AppIconMap;
  classificationOptions?: ClassificationOptions;
  leaderboardCelebration?: LeaderboardCelebration;
  assessment?: EndOfDayReviewPendingAssessment;
  isMock?: boolean;
}): EndOfDayReviewEvent {
  segments = aggregateDeviceElapsedTime(segments);
  const totalSeconds = segments.reduce((total, segment) => total + segment.durationSeconds, 0);
  const productivityDurations = buildProductivityDurations(segments, classificationOptions);
  const focusSeconds = productivityDurations.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const driftSeconds = productivityDurations.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0;
  const neutralSeconds = productivityDurations.find((entry) => entry.productivity === "neutral")?.totalSeconds ?? 0;
  const unclassifiedSeconds = Math.max(0, totalSeconds - focusSeconds - driftSeconds - neutralSeconds);
  const dailySignals = buildEndOfDayReviewDailySignals(segments, classificationOptions);
  const resolvedAssessment = assessment ? {
    ...assessment,
    pendingSeconds: assessment.pendingSeconds ?? sumPendingEndOfDayReviewSeconds(
      segments,
      assessment.unavailableSince,
      classificationOptions,
    ),
  } : undefined;
  const resolvedLeaderboardCelebration = resolvedAssessment
    ? undefined
    : leaderboardCelebration ?? (isMock ? {
    period: "daily" as const,
    rank: 2 as const,
    participantCount: 14,
    focusSeconds,
    windowEndDay: day,
    } : undefined);

  return {
    kind: "endOfDayReview",
    placement: "top-right",
    day,
    generatedAt,
    trackedLabel: `${formatReviewDuration(totalSeconds)} tracked`,
    focusLabel: `${formatReviewDuration(focusSeconds)} focus`,
    driftLabel: `${formatReviewDuration(driftSeconds)} drift`,
    totalSeconds,
    focusSeconds,
    driftSeconds,
    neutralSeconds,
    unclassifiedSeconds,
    topSource: buildTopSourceFromSegments(segments, appIcons),
    breakdownSources: buildBreakdownSources(segments, appIcons, classificationOptions),
    categorySummaries: buildCategorySummaries(segments, totalSeconds, classificationOptions),
    sourceSummaries: buildSourceSummaries(segments, totalSeconds, appIcons),
    /* The Dev preview keeps its reviewed fixed rows; a live review compares
       with yesterday up to the same point of the day when yesterday was
       watched long enough. */
    highlightLabel: resolvedAssessment
      ? undefined
      : resolvedLeaderboardCelebration
      ? `#${resolvedLeaderboardCelebration.rank} of ${resolvedLeaderboardCelebration.participantCount} · 8 PM`
      : isMock ? "Best this week" : undefined,
    comparison: resolvedAssessment ? undefined : isMock ? {
      focusDeltaSeconds: 38 * 60,
      driftDeltaSeconds: -9 * 60,
      otherDeltaSeconds: 5 * 60,
    } : previousDaySegments ? buildEndOfDayReviewComparison({
      day,
      generatedAt,
      previousDaySegments,
      current: { focusSeconds, driftSeconds, neutralSeconds },
      classificationOptions,
      startOfDayMinutes,
    }) : undefined,
    dailySignals: resolvedAssessment ? undefined : dailySignals,
    leaderboardCelebration: resolvedLeaderboardCelebration,
    assessment: resolvedAssessment,
    isMock: isMock || undefined,
  };
}

export function sumPendingEndOfDayReviewSeconds(
  segments: readonly ActivitySegment[],
  unavailableSince: string | null | undefined,
  classificationOptions?: ClassificationOptions,
): number {
  const cutoffMs = unavailableSince ? new Date(unavailableSince).getTime() : Number.NEGATIVE_INFINITY;
  const hasValidCutoff = Number.isFinite(cutoffMs);
  return aggregateDeviceElapsedTime(segments).reduce((total, segment) => {
    const startedAtMs = new Date(segment.startedAt).getTime();
    if (hasValidCutoff && (!Number.isFinite(startedAtMs) || startedAtMs < cutoffMs)) return total;
    if (classifyActivityDetailed(segment, classificationOptions).category !== "unknown") return total;
    return total + Math.max(0, segment.durationSeconds);
  }, 0);
}

const DEEP_SESSION_MIN_SECONDS = 45 * 60;

export function buildEndOfDayReviewDailySignals(
  segments: ActivitySegment[],
  classificationOptions?: ClassificationOptions,
): EndOfDayReviewDailySignals {
  const focusSourceSegments = aggregateDeviceElapsedTime(segments)
    .filter((segment) => {
      const classification = classifyActivityDetailed(segment, classificationOptions);
      return classification.category !== "unknown" && classification.productivity === "focus";
    });
  const focusSegments = focusSourceSegments
    .map((segment) => ({
      source: segment,
      startedAt: new Date(activityTimeBounds(segment).start),
      endedAt: new Date(activityTimeBounds(segment).end),
      durationSeconds: Math.max(0, segment.durationSeconds),
    }))
    .filter((segment) => Number.isFinite(segment.startedAt.getTime()) && Number.isFinite(segment.endedAt.getTime()))
    .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());

  /* Breakdown's Longest streak uses this same run rule. */
  const focusRuns = joinProductivityRuns(focusSourceSegments.map(toProductivityRunPart));
  const deepRuns = focusRuns.filter((run) => run.seconds >= DEEP_SESSION_MIN_SECONDS);
  /* Ties go to the earlier run, so the caption points at the first time the
     day reached its best stretch. */
  const longestRun = longestProductivityRun(focusRuns);
  const focusByHour = new Map<number, number>();
  for (const segment of focusSegments) {
    let cursorMs = segment.startedAt.getTime();
    const endMs = Math.max(cursorMs, segment.endedAt.getTime());
    while (cursorMs < endMs) {
      const hour = new Date(cursorMs);
      // Subtract within the current offset: setMinutes(0) can jump backward
      // into the first occurrence of a repeated hour when DST ends.
      const hourStartMs = cursorMs - (hour.getMinutes() * 60 + hour.getSeconds()) * 1000 - hour.getMilliseconds();
      const hourEndMs = hourStartMs + 60 * 60 * 1000;
      const overlapSeconds = activitySecondsWithinInterval(segment.source, cursorMs, Math.min(endMs, hourEndMs));
      focusByHour.set(hourStartMs, (focusByHour.get(hourStartMs) ?? 0) + overlapSeconds);
      cursorMs = Math.min(endMs, hourEndMs);
    }
  }

  const peak = Array.from(focusByHour.entries())
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
  const peakDate = peak ? new Date(peak[0]) : null;

  return {
    deepSessionCount: deepRuns.length,
    longestFocusRunSeconds: longestRun?.seconds ?? 0,
    longestFocusRunStartedAt: longestRun ? new Date(longestRun.startMs).toISOString() : null,
    peakHourLabel: peakDate ? `${String(peakDate.getHours()).padStart(2, "0")}:00` : null,
    peakHourFocusSeconds: Math.round(peak?.[1] ?? 0),
  };
}

function buildCategorySummaries(
  segments: ActivitySegment[],
  totalSeconds: number,
  classificationOptions?: ClassificationOptions,
): EndOfDayReviewCategorySummary[] {
  const totals = new Map<string, number>();

  for (const segment of segments) {
    const category = classifyActivityDetailed(segment, classificationOptions).category;
    totals.set(category, (totals.get(category) ?? 0) + segment.durationSeconds);
  }

  return Array.from(totals.entries())
    .map(([category, durationSeconds]) => ({
      label: formatCategoryLabel(category),
      durationSeconds,
      percent: safePercent(durationSeconds, totalSeconds),
    }))
    .sort((left, right) => right.durationSeconds - left.durationSeconds || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function buildSourceSummaries(
  segments: ActivitySegment[],
  totalSeconds: number,
  appIcons: AppIconMap,
): EndOfDayReviewSourceSummary[] {
  return buildAppUsageSummaries(segments, { limit: 3, groupBy: "app" }).map((summary) => {
    const appSegments = segments.filter((segment) => segment.appName === summary.appName);
    const topSource = buildAppUsageSummaries(appSegments, { limit: 1 })[0];
    const sourceLabel = topSource ? sourceLabelForSummary(topSource) : summary.appName;
    const bundleId = summary.bundleId ?? null;

    return {
      appName: summary.appName,
      bundleId,
      iconSrc: resolveAppIconSrc(summary.appName, bundleId, appIcons),
      sourceLabel,
      durationSeconds: summary.totalSeconds,
      percent: safePercent(summary.totalSeconds, totalSeconds),
    };
  });
}

function buildBreakdownSources(
  segments: ActivitySegment[],
  appIcons: AppIconMap,
  classificationOptions?: ClassificationOptions,
): EndOfDayReviewBreakdownSource[] {
  const keys: EndOfDayReviewBreakdownKey[] = ["focus", "drift", "other", "unclassified"];
  return keys.flatMap((key) => {
    const source = buildTopSourceFromSegments(
      segments.filter((segment) => matchesBreakdownKey(segment, key, classificationOptions)),
      appIcons,
    );
    return source ? [{ ...source, key }] : [];
  });
}

function buildTopSourceFromSegments(
  segments: ActivitySegment[],
  appIcons: AppIconMap,
): EndOfDayReviewTopSource | null {
  const topApp = buildAppUsageSummaries(segments, { limit: 1, groupBy: "app" })[0];
  if (!topApp) return null;

  const appSegments = segments.filter((segment) => segment.appName === topApp.appName);
  const topSource = buildAppUsageSummaries(appSegments, { limit: 1 })[0];
  const sourceLabel = topSource ? sourceLabelForSummary(topSource) : topApp.appName;
  const bundleId = topApp.bundleId ?? null;

  return {
    appName: topApp.appName,
    bundleId,
    iconSrc: resolveAppIconSrc(topApp.appName, bundleId, appIcons),
    sourceLabel,
    durationSeconds: topApp.totalSeconds,
  };
}

function resolveAppIconSrc(appName: string, bundleId: string | null, appIcons: AppIconMap): string | null {
  if (bundleId && appIcons[bundleId]) return appIcons[bundleId];
  return appIcons[appName] ?? null;
}

function matchesBreakdownKey(
  segment: ActivitySegment,
  key: EndOfDayReviewBreakdownKey,
  classificationOptions?: ClassificationOptions,
): boolean {
  const classification = classifyActivityDetailed(segment, classificationOptions);
  if (key === "unclassified") return classification.category === "unknown";
  if (classification.category === "unknown") return false;
  if (key === "focus") return classification.productivity === "focus";
  if (key === "drift") return classification.productivity === "drift";
  return classification.productivity !== "focus" && classification.productivity !== "drift";
}

function safePercent(seconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.round((seconds / totalSeconds) * 1000) / 10;
}

function formatCategoryLabel(category: string): string {
  return category
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}

function sourceLabelForSummary(summary: ReturnType<typeof buildAppUsageSummaries>[number]): string {
  if (summary.siteDomain) return summary.siteDomain;
  if (summary.siteTitle) return summary.siteTitle;
  return summary.appName;
}

function formatReviewDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0 && minutes === 0) return `${hours}h`;
  return secondsToLabel(totalSeconds);
}
