import type {
  ActivityCategory,
  ActivityClassification,
  ActivitySegment,
  ClassificationOptions,
  ClassificationRuleOption,
  FlowIntervalMinutes,
  FlowBlock,
  FlowBlockContribution,
  HourBucket,
  HourlyBucket,
  ProductivityBasis,
  ProductivityLabel,
  SiteDuration,
} from "./activity";
import { isCustomActivityCategory, isExcludedSegment, isFailedForegroundCaptureSegment } from "./activity";
import { aggregateDeviceElapsedTime, activitySecondsWithinInterval, activityTimeBounds } from "./deviceElapsedTime";
import { canonicalizeClassificationRuleSiteUrl } from "./classificationRuleUrl";
import {
  DRIFTY_PRODUCTIVITY_RUBRIC_V1,
  scoreDriftyProductivityRubricV1,
  type DriftyProductivityRubricVersion,
  type ProductivityRubricScore,
  type ProductivityScoreDimensionKey,
} from "./productivityRubric";
import { classifyYouTubeActivity, classifyYouTubeWindowTitle } from "./youtubeClassification";
import { classifySocialActivity } from "./socialClassification";

const UI_LOCALE = "en-US";
const MINUTES_PER_DAY = 24 * 60;
const timelineTimeFormatter = new Intl.DateTimeFormat(UI_LOCALE, {
  hour: "numeric",
  minute: "2-digit",
});

export interface AppDuration {
  appName: string;
  bundleId?: string | null;
  durationSeconds: number;
}

export interface AppUsageSummary {
  rank: number;
  appName: string;
  bundleId: string | null;
  usageKind: "app" | "site";
  siteDomain: string | null;
  siteTitle: string | null;
  browserName: string | null;
  totalSeconds: number;
  sessionCount: number;
  activeDays: number;
  averageSessionSeconds: number;
  shareOfTotal: number;
  firstStartedAt: string;
  lastEndedAt: string;
}

export interface DailyTotal {
  day: string;
  totalSeconds: number;
}

export interface CategoryDuration {
  category: ActivityCategory;
  totalSeconds: number;
  segments: number;
  ratio: number;
  /** The neutral part of totalSeconds; an added productivity level shows it under its own name. */
  neutralSeconds?: number;
}

export interface ProductivityDuration {
  productivity: ProductivityLabel;
  totalSeconds: number;
  segments: number;
  ratio: number;
}

export interface DayRibbonSegment {
  id: string;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  classificationSource?: ClassificationSource | null;
  aiClassification?: boolean | null;
  aiCachedClassification?: boolean | null;
  classificationReason?: string | null;
  startMinute: number;
  endMinute: number;
  totalSeconds: number;
  activities: Array<{
    appName: string;
    windowTitle?: string | null;
    siteDomain?: string | null;
    siteTitle?: string | null;
    durationSeconds: number;
    classificationSource?: ClassificationSource | null;
    aiClassification?: boolean | null;
    aiCachedClassification?: boolean | null;
    classificationReason?: string | null;
  }>;
}

export type ClassificationSurface = "browser" | "app";
export type ClassificationSource = "youtube" | "domain-db" | "app-db" | "context" | "fallback" | "llm" | "manual" | "rule" | "stored" | "unknown" | "sustained-social-dwell";

export interface ActivityClassificationDetail extends ActivityClassification {
  surface: ClassificationSurface;
  source: ClassificationSource;
  confidence: number;
  reason: string;
  aiCached?: boolean | null;
  /** True when the user's category productivity preference set `productivity`. */
  productivityPreference?: boolean | null;
}

export type ProductivityPersonaId =
  | "deep_diver"
  | "deep_focus_deep_drift"
  | "drift_diver"
  | "focus_sprinter"
  | "reactive_operator"
  | "night_owl"
  | "balanced_builder";

export type ProductivityPersonaName =
  | "Deep Diver"
  | "Deep Focus, Deep Drift"
  | "Drift Diver"
  | "Focus Sprinter"
  | "Reactive Operator"
  | "Night Owl"
  | "Balanced Builder";

export type ProductivityPersonaAxisKey = "focus" | "drift" | "switching" | "surfaces" | "reactive" | "night";

export interface ProductivityPersonaAxis {
  key: ProductivityPersonaAxisKey;
  label: string;
  value: number;
}

export interface ProductivityPersonaMetrics {
  totalSeconds: number;
  focusSeconds: number;
  focusShare: number;
  neutralSeconds: number;
  neutralShare: number;
  driftSeconds: number;
  driftShare: number;
  focusAverageSegmentSeconds: number;
  driftAverageSegmentSeconds: number;
  contextSwitches: number;
  switchRatePerHour: number;
  uniqueSurfaceCount: number;
  topSurfaceShare: number;
  communicationSeconds: number;
  communicationShare: number;
  reactiveSeconds: number;
  reactiveShare: number;
  nightSeconds: number;
  nightShare: number;
  activeDays: number;
}

export interface ProductivityPersonaReport {
  personaId: ProductivityPersonaId;
  personaName: ProductivityPersonaName;
  rubricVersion: DriftyProductivityRubricVersion;
  scores: ProductivityRubricScore;
  axes: ProductivityPersonaAxis[];
  metrics: ProductivityPersonaMetrics;
}

export function totalDurationSeconds(segments: ActivitySegment[]): number {
  segments = aggregateDeviceElapsedTime(segments);
  return segments.reduce((total, segment) => total + segment.durationSeconds, 0);
}

export function groupSegmentsByApp(segments: ActivitySegment[]): AppDuration[] {
  segments = aggregateDeviceElapsedTime(segments);
  const totals = new Map<string, AppDuration>();

  for (const segment of segments) {
    const existing = totals.get(segment.appName) ?? {
      appName: segment.appName,
      bundleId: segment.bundleId ?? null,
      durationSeconds: 0,
    };

    existing.durationSeconds += segment.durationSeconds;
    if (!existing.bundleId && segment.bundleId) {
      existing.bundleId = segment.bundleId;
    }

    totals.set(segment.appName, existing);
  }

  return Array.from(totals.values()).sort((left, right) => right.durationSeconds - left.durationSeconds);
}

/**
 * The row an activity segment counts toward in app usage lists. Sites group by
 * domain (or page title when the domain is missing), case-insensitively; apps
 * group by name. Anything that needs to show the records behind one of those
 * rows must use this key so the records add up to the row.
 */
export function appUsageGroupKey(segment: ActivitySegment, groupBy: "app" | "activity" = "activity"): string {
  const siteLabel = groupBy === "activity" ? normalizedSiteDomain(segment) ?? normalizedSiteTitle(segment) : null;
  return siteLabel ? `site:${siteLabel.toLowerCase()}` : `app:${segment.appName}`;
}

/** The {@link appUsageGroupKey} of a summary built by {@link buildAppUsageSummaries}. */
export function appUsageSummaryGroupKey(summary: Pick<AppUsageSummary, "appName" | "usageKind">): string {
  return summary.usageKind === "site" ? `site:${summary.appName.toLowerCase()}` : `app:${summary.appName}`;
}

export function buildAppUsageSummaries(
  segments: ActivitySegment[],
  options: { limit?: number; groupBy?: "app" | "activity" } = {},
): AppUsageSummary[] {
  segments = aggregateDeviceElapsedTime(segments);
  const groupBy = options.groupBy ?? "activity";
  let unavailableCaptureSeconds = 0;
  const totals = new Map<
    string,
    {
      appName: string;
      bundleId: string | null;
      usageKind: "app" | "site";
      siteDomain: string | null;
      siteTitle: string | null;
      browserName: string | null;
      totalSeconds: number;
      sessionCount: number;
      activeDays: Set<string>;
      firstStartedAt: string;
      lastEndedAt: string;
    }
  >();

  for (const segment of segments) {
    if (isFailedForegroundCaptureSegment(segment)) {
      // Older Windows builds stored failed foreground reads as app activity.
      unavailableCaptureSeconds += segment.durationSeconds;
      continue;
    }
    if (isExcludedSegment(segment)) continue;
    const siteDomain = groupBy === "activity" ? normalizedSiteDomain(segment) : null;
    const siteTitle = groupBy === "activity" ? normalizedSiteTitle(segment) : null;
    const siteLabel = siteDomain ?? siteTitle;
    const groupKey = appUsageGroupKey(segment, groupBy);
    const existing = totals.get(groupKey) ?? {
      appName: siteLabel ?? segment.appName,
      bundleId: siteLabel ? null : segment.bundleId ?? null,
      usageKind: siteLabel ? "site" : "app",
      siteDomain,
      siteTitle: siteLabel ? siteTitle : null,
      browserName: siteLabel ? segment.browserName ?? segment.appName : null,
      totalSeconds: 0,
      sessionCount: 0,
      activeDays: new Set<string>(),
      firstStartedAt: segment.startedAt,
      lastEndedAt: segment.endedAt,
    };

    existing.totalSeconds += segment.durationSeconds;
    existing.sessionCount += 1;
    if (existing.usageKind === "app" && !existing.bundleId && segment.bundleId) {
      existing.bundleId = segment.bundleId;
    }
    if (existing.usageKind === "site" && !existing.siteTitle) {
      existing.siteTitle = normalizedSiteTitle(segment);
    }
    if (existing.usageKind === "site" && !existing.browserName) {
      existing.browserName = segment.browserName ?? segment.appName;
    }
    if (segment.startedAt < existing.firstStartedAt) {
      existing.firstStartedAt = segment.startedAt;
    }
    if (segment.endedAt > existing.lastEndedAt) {
      existing.lastEndedAt = segment.endedAt;
    }

    const bounds = activityTimeBounds(segment);
    let cursor = bounds.start;
    const end = bounds.end;

    while (cursor < end) {
      const current = new Date(cursor);
      const dayKey = logicalDayIsoDateForDate(current);
      existing.activeDays.add(dayKey);
      cursor = Math.min(end, logicalDayEndExclusiveMs(dayKey));
    }

    totals.set(groupKey, existing);
  }

  const totalSeconds = totalDurationSeconds(segments) - unavailableCaptureSeconds;
  const summaries = Array.from(totals.values())
    .sort((left, right) => {
      if (right.totalSeconds !== left.totalSeconds) return right.totalSeconds - left.totalSeconds;
      if (left.appName < right.appName) return -1;
      if (left.appName > right.appName) return 1;
      return 0;
    })
    .map((entry, index) => ({
      rank: index + 1,
      appName: entry.appName,
      bundleId: entry.bundleId,
      usageKind: entry.usageKind,
      siteDomain: entry.siteDomain,
      siteTitle: entry.siteTitle,
      browserName: entry.browserName,
      totalSeconds: entry.totalSeconds,
      sessionCount: entry.sessionCount,
      activeDays: entry.activeDays.size,
      averageSessionSeconds: entry.sessionCount > 0 ? entry.totalSeconds / entry.sessionCount : 0,
      shareOfTotal: totalSeconds > 0 ? entry.totalSeconds / totalSeconds : 0,
      firstStartedAt: entry.firstStartedAt,
      lastEndedAt: entry.lastEndedAt,
    }));

  return typeof options.limit === 'number' ? summaries.slice(0, options.limit) : summaries;
}

export function buildHourlyBuckets(segments: ActivitySegment[]): HourlyBucket[] {
  segments = aggregateDeviceElapsedTime(segments);
  const buckets = new Map<number, number>();

  for (const segment of segments) {
    const hour = new Date(segment.startedAt).getHours();
    buckets.set(hour, (buckets.get(hour) ?? 0) + segment.durationSeconds);
  }

  return Array.from({ length: 24 }, (_, hour) => ({
    hourLabel: `${hour.toString().padStart(2, "0")}:00`,
    durationSeconds: buckets.get(hour) ?? 0,
  }));
}

export function buildHourlySummary(segments: ActivitySegment[]): HourBucket[] {
  segments = aggregateDeviceElapsedTime(segments);
  const buckets = new Map<string, HourBucket>();

  for (const segment of segments) {
    const startedAt = new Date(segment.startedAt);
    const year = startedAt.getFullYear();
    const month = `${startedAt.getMonth() + 1}`.padStart(2, "0");
    const day = `${startedAt.getDate()}`.padStart(2, "0");
    const hour = `${startedAt.getHours()}`.padStart(2, "0");
    const bucketKey = `${year}-${month}-${day}T${hour}:00`;
    const bucket = buckets.get(bucketKey) ?? {
      hour: bucketKey,
      totalSeconds: 0,
      appBreakdown: [],
    };

    bucket.totalSeconds += segment.durationSeconds;

    const existing = bucket.appBreakdown.find((entry) => entry.appName === segment.appName);
    if (existing) {
      existing.totalSeconds += segment.durationSeconds;
    } else {
      bucket.appBreakdown.push({
        appName: segment.appName,
        totalSeconds: segment.durationSeconds,
      });
    }

    bucket.appBreakdown.sort((a, b) => b.totalSeconds - a.totalSeconds);
    buckets.set(bucketKey, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

export function topApps(segments: ActivitySegment[], limit = 5) {
  return buildAppUsageSummaries(segments, { limit, groupBy: "app" })
    .map((entry) => ({ appName: entry.appName, bundleId: entry.bundleId, totalSeconds: entry.totalSeconds }));
}

function normalizedSiteDomain(segment: ActivitySegment): string | null {
  const domain = segment.siteDomain?.trim().toLowerCase();
  return domain && domain.length > 0 ? domain : null;
}

function normalizedSiteTitle(segment: ActivitySegment): string | null {
  const title = segment.siteTitle?.trim();
  return title && title.length > 0 ? title : null;
}

export function topSites(segments: ActivitySegment[], limit = 5): SiteDuration[] {
  segments = aggregateDeviceElapsedTime(segments);
  const totals = new Map<string, SiteDuration>();

  for (const segment of segments) {
    if (!segment.siteDomain) continue;
    const existing = totals.get(segment.siteDomain) ?? {
      siteDomain: segment.siteDomain,
      totalSeconds: 0,
      visits: 0,
      browserName: segment.browserName ?? null,
    };
    existing.totalSeconds += segment.durationSeconds;
    existing.visits += 1;
    totals.set(segment.siteDomain, existing);
  }

  return Array.from(totals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .slice(0, limit);
}

export function formatTimelineItems(segments: ActivitySegment[]) {
  return segments
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((segment) => ({
      ...segment,
      durationLabel: secondsToLabel(segment.durationSeconds),
      startedLabel: timelineTimeFormatter.format(new Date(segment.startedAt)),
      endedLabel: timelineTimeFormatter.format(new Date(segment.endedAt)),
    }));
}

export function secondsToLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function shiftIsoDate(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(year, month - 1, date + delta);
  const nextYear = next.getFullYear();
  const nextMonth = `${next.getMonth() + 1}`.padStart(2, "0");
  const nextDate = `${next.getDate()}`.padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDate}`;
}

type FlowBlockCandidate = {
  block: FlowBlock;
  strongestOverlapSeconds: number;
};

// The per-bucket share one candidate (colorKey) accumulated. The winner's block carries the
// whole list so the UI can explain a flat cell whose color hides its runner-ups.
function flowBlockContributionFromCandidate(candidate: FlowBlockCandidate): FlowBlockContribution {
  const { block } = candidate;
  return {
    colorKey: block.colorKey,
    appName: block.appName,
    bundleId: block.bundleId ?? null,
    browserName: block.browserName ?? null,
    siteDomain: block.siteDomain ?? null,
    siteTitle: block.siteTitle ?? null,
    category: block.category,
    productivity: block.productivity,
    durationSeconds: block.durationSeconds,
    sourceSegmentIds: block.sourceSegmentIds ?? [],
  };
}

type FlowBlockBuildContext = {
  readonly classificationBySegmentId: ReadonlyMap<string, ActivityClassificationDetail>;
  readonly effectiveProductivityBySegmentId: ReadonlyMap<string, EffectiveProductivityResolution>;
};

// One segment's overlap contribution to a single flow-chart bucket. Emitted in the same
// segment-then-bucket order used by `buildFlowBlocks`, so any aggregation built on top of
// this iterator sees candidates inserted in the exact order `buildFlowBlocks` relies on.
interface FlowBucketContribution {
  readonly segment: ActivitySegment;
  /** `${day}-${minuteOfDay}-${colorKey}` — one accumulation candidate per colorKey per bucket. */
  readonly candidateKey: string;
  /** `${day}-${minuteOfDay}` — the visible block the winning candidate fills. */
  readonly bucketKey: string;
  readonly colorKey: string;
  readonly minuteOfDay: number;
  readonly hour: number;
  readonly quarter: number;
  readonly overlapSeconds: number;
}

// Shared bucketing pass for the flow chart: walks each segment across `intervalMinutes`
// buckets, filters to the logical `day`, and reports the clamped overlap seconds per bucket.
// `buildFlowBlocks` and `selectFlowVisibleSegmentIds` both consume this so the winner rule
// (colorKey grouping + overlap accumulation + logical-day filtering) stays defined once.
function forEachFlowBucketContribution(
  segments: ActivitySegment[],
  day: string,
  intervalMinutes: FlowIntervalMinutes,
  boundaryMinutes: number,
  visit: (contribution: FlowBucketContribution) => void,
): void {
  const intervalMs = intervalMinutes * 60 * 1000;
  segments = aggregateDeviceElapsedTime(segments);

  for (const segment of segments) {
    const bounds = activityTimeBounds(segment);
    const start = new Date(bounds.start);
    const end = new Date(bounds.end);
    let cursor = new Date(start);

    while (cursor < end) {
      const bucketMinute = Math.floor(cursor.getMinutes() / intervalMinutes) * intervalMinutes;
      // A local setter resolves an ambiguous fall-back time to its first
      // occurrence. Round within this actual occurrence so the next bucket
      // always advances, including the repeated hour (or half-hour).
      const offsetInBucket = (cursor.getMinutes() - bucketMinute) * 60_000
        + cursor.getSeconds() * 1000 + cursor.getMilliseconds();
      const blockStart = new Date(cursor.getTime() - offsetInBucket);
      const blockEnd = new Date(blockStart.getTime() + intervalMs);

      if (logicalDayIsoDateForDate(blockStart, boundaryMinutes) !== day) {
        cursor = blockEnd;
        continue;
      }

      const hour = blockStart.getHours();
      const minuteOfDay = hour * 60 + bucketMinute;
      const quarter = Math.floor(bucketMinute / 15);
      const colorKey = segment.siteDomain || segment.appName;
      const overlapSeconds = activitySecondsWithinInterval(segment, blockStart.getTime(), blockEnd.getTime());

      if (overlapSeconds <= 0) {
        cursor = blockEnd;
        continue;
      }

      visit({
        segment,
        candidateKey: `${day}-${minuteOfDay}-${colorKey}`,
        bucketKey: `${day}-${minuteOfDay}`,
        colorKey,
        minuteOfDay,
        hour,
        quarter,
        overlapSeconds,
      });

      cursor = blockEnd;
    }
  }
}

// The descriptive (non-positional) fields a flow block shows on hover, taken from the
// segment that currently owns the block (its strongest single-bucket overlap).
function flowBlockDescriptorFromSegment(
  segment: ActivitySegment,
  classification: ActivityClassificationDetail,
  effectiveProductivity: EffectiveProductivityResolution,
  colorKey: string,
  projectColor: string | null = null,
  projectId: string | null = null,
) {
  return {
    appName: segment.appName,
    bundleId: segment.bundleId ?? null,
    windowTitle: segment.windowTitle ?? null,
    browserName: segment.browserName ?? null,
    siteDomain: segment.siteDomain ?? null,
    siteTitle: segment.siteTitle ?? null,
    siteUrl: segment.siteUrl ?? null,
    youtubeVideoId: segment.youtubeVideoId ?? null,
    youtubePlaylistId: segment.youtubePlaylistId ?? null,
    youtubeIsShorts: segment.youtubeIsShorts ?? null,
    youtubeCategory: segment.youtubeCategory ?? null,
    youtubeChannelId: segment.youtubeChannelId ?? null,
    youtubeChannelName: segment.youtubeChannelName ?? null,
    youtubeTitle: segment.youtubeTitle ?? null,
    youtubeDescription: segment.youtubeDescription ?? null,
    youtubeKeywords: segment.youtubeKeywords ?? null,
    youtubeDurationSeconds: segment.youtubeDurationSeconds ?? null,
    youtubeViewCount: segment.youtubeViewCount ?? null,
    youtubeIsLive: segment.youtubeIsLive ?? null,
    youtubeIsUnlisted: segment.youtubeIsUnlisted ?? null,
    youtubePublishDate: segment.youtubePublishDate ?? null,
    youtubeUploadDate: segment.youtubeUploadDate ?? null,
    category: classification.category,
    productivity: effectiveProductivity.productivity,
    sourceProductivity: classification.productivity,
    productivityBasis: effectiveProductivity.basis,
    classificationSource: classification.source,
    aiClassification: classification.source === "llm",
    aiCachedClassification: classification.aiCached ?? null,
    classificationReason: classification.reason,
    projectId,
    projectColor,
    deviceId: segment.deviceId ?? null,
    colorKey,
  } as const;
}

export function buildFlowBlocks(
  segments: ActivitySegment[],
  day: string,
  intervalMinutes: FlowIntervalMinutes = 5,
  options?: ClassificationOptions,
  startOfDayMinutes = 0,
  projectColorBySegment?: ReadonlyMap<string, string>,
  projectIdBySegment?: ReadonlyMap<string, string>,
  projectSegments?: readonly ActivitySegment[],
): FlowBlock[] {
  segments = aggregateDeviceElapsedTime(segments);
  const context = createFlowBlockBuildContext(segments, options);
  return buildFlowBlocksWithContext(
    segments,
    day,
    intervalMinutes,
    startOfDayMinutes,
    context,
    projectColorBySegment,
    projectIdBySegment,
    projectSegments,
  );
}

/**
 * Builds several interval views while sharing classification and contextual
 * productivity work. This keeps display-only density preferences from
 * multiplying the most expensive part of Flow aggregation.
 */
export function buildFlowBlocksForIntervals<TInterval extends FlowIntervalMinutes>(
  segments: ActivitySegment[],
  day: string,
  intervalMinutes: readonly TInterval[],
  options?: ClassificationOptions,
  startOfDayMinutes = 0,
  projectColorBySegment?: ReadonlyMap<string, string>,
  projectIdBySegment?: ReadonlyMap<string, string>,
  projectSegments?: readonly ActivitySegment[],
): ReadonlyMap<TInterval, FlowBlock[]> {
  segments = aggregateDeviceElapsedTime(segments);
  const blocksByInterval = new Map<TInterval, FlowBlock[]>();
  if (intervalMinutes.length === 0) return blocksByInterval;

  const context = createFlowBlockBuildContext(segments, options);
  for (const interval of new Set(intervalMinutes)) {
    blocksByInterval.set(interval, buildFlowBlocksWithContext(
      segments,
      day,
      interval,
      startOfDayMinutes,
      context,
      projectColorBySegment,
      projectIdBySegment,
      projectSegments,
    ));
  }
  return blocksByInterval;
}

function buildFlowBlocksWithContext(
  segments: ActivitySegment[],
  day: string,
  intervalMinutes: FlowIntervalMinutes,
  startOfDayMinutes: number,
  context: FlowBlockBuildContext,
  projectColorBySegment?: ReadonlyMap<string, string>,
  projectIdBySegment?: ReadonlyMap<string, string>,
  projectSegments?: readonly ActivitySegment[],
): FlowBlock[] {
  const candidates = new Map<string, FlowBlockCandidate>();
  const candidatesByBucket = new Map<string, FlowBlockCandidate[]>();
  const { classificationBySegmentId, effectiveProductivityBySegmentId } = context;
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const classificationFor = (segment: ActivitySegment): ActivityClassificationDetail => {
    const classification = classificationBySegmentId.get(segment.id);
    if (!classification) throw new Error(`Missing Flow classification for segment: ${segment.id}`);
    return classification;
  };

  forEachFlowBucketContribution(segments, day, intervalMinutes, boundaryMinutes, ({ segment, candidateKey, bucketKey, minuteOfDay, hour, quarter, colorKey, overlapSeconds }) => {
    const classification = classificationFor(segment);
    const effectiveProductivity = effectiveProductivityBySegmentId.get(segment.id) ?? directProductivity(classification.productivity);
    const projectColor = projectColorBySegment?.get(segment.id) ?? null;
    const projectId = projectIdBySegment?.get(segment.id) ?? null;
    const descriptor = flowBlockDescriptorFromSegment(segment, classification, effectiveProductivity, colorKey, projectColor, projectId);
    const existing = candidates.get(candidateKey);

    if (!existing) {
      const candidate: FlowBlockCandidate = {
        block: {
          id: `${day}-${minuteOfDay}`,
          sourceSegmentIds: [segment.id],
          day,
          hour,
          quarter,
          minuteOfDay,
          ...descriptor,
          durationSeconds: overlapSeconds,
        },
        strongestOverlapSeconds: overlapSeconds,
      };
      candidates.set(candidateKey, candidate);
      const bucketCandidates = candidatesByBucket.get(bucketKey);
      if (bucketCandidates) bucketCandidates.push(candidate);
      else candidatesByBucket.set(bucketKey, [candidate]);
      return;
    }

    existing.block.durationSeconds += overlapSeconds;
    if (!existing.block.sourceSegmentIds?.includes(segment.id)) {
      existing.block = {
        ...existing.block,
        sourceSegmentIds: [...(existing.block.sourceSegmentIds ?? []), segment.id],
      };
    }
    if (existing.strongestOverlapSeconds < overlapSeconds) {
      existing.block = {
        ...existing.block,
        ...descriptor,
        sourceSegmentIds: existing.block.sourceSegmentIds,
        durationSeconds: existing.block.durationSeconds,
      };
      existing.strongestOverlapSeconds = overlapSeconds;
    }
  });

  const blocks = new Map<string, FlowBlock>();
  for (const [bucketKey, bucketCandidates] of candidatesByBucket) {
    // Strict `<` keeps the first-seen candidate on ties (selectFlowVisibleSegmentIds mirrors this).
    let winner = bucketCandidates[0];
    for (const candidate of bucketCandidates) {
      if (winner.block.durationSeconds < candidate.block.durationSeconds) winner = candidate;
    }
    const runnerUps = bucketCandidates
      .filter((candidate) => candidate !== winner)
      .sort((left, right) => right.block.durationSeconds - left.block.durationSeconds);
    blocks.set(bucketKey, {
      ...winner.block,
      composition: [winner, ...runnerUps].map(flowBlockContributionFromCandidate),
    });
  }

  const projectByBucket = projectSegments
    ? dominantProjectByFlowBucket(
        projectSegments,
        day,
        intervalMinutes,
        boundaryMinutes,
        projectColorBySegment,
        projectIdBySegment,
      )
    : null;
  return Array.from(blocks.values())
    .map((block) => {
      const project = projectByBucket?.get(`${block.day}-${block.minuteOfDay}`);
      return project
        ? { ...block, projectId: project.projectId, projectColor: project.projectColor }
        : block;
    })
    .sort((left, right) => logicalMinuteOfDay(left.minuteOfDay, boundaryMinutes) - logicalMinuteOfDay(right.minuteOfDay, boundaryMinutes));
}

type ProjectFlowBucketWeight = {
  readonly projectId: string | null;
  readonly projectColor: string | null;
  durationSeconds: number;
};

function dominantProjectByFlowBucket(
  projectSegments: readonly ActivitySegment[],
  day: string,
  intervalMinutes: FlowIntervalMinutes,
  boundaryMinutes: number,
  projectColorBySegment?: ReadonlyMap<string, string>,
  projectIdBySegment?: ReadonlyMap<string, string>,
): Map<string, ProjectFlowBucketWeight> {
  const weights = new Map<string, Map<string, ProjectFlowBucketWeight>>();
  forEachFlowBucketContribution(
    [...projectSegments],
    day,
    intervalMinutes,
    boundaryMinutes,
    ({ segment, bucketKey, overlapSeconds }) => {
      const projectId = projectIdBySegment?.get(segment.id) ?? null;
      const projectColor = projectColorBySegment?.get(segment.id) ?? null;
      const projectKey = projectId ?? "";
      const byProject = weights.get(bucketKey) ?? new Map<string, ProjectFlowBucketWeight>();
      const current = byProject.get(projectKey) ?? { projectId, projectColor, durationSeconds: 0 };
      current.durationSeconds += overlapSeconds;
      byProject.set(projectKey, current);
      weights.set(bucketKey, byProject);
    },
  );

  const dominant = new Map<string, ProjectFlowBucketWeight>();
  for (const [bucketKey, byProject] of weights) {
    for (const candidate of byProject.values()) {
      const current = dominant.get(bucketKey);
      if (!current || candidate.durationSeconds > current.durationSeconds) dominant.set(bucketKey, candidate);
    }
  }
  return dominant;
}

type FlowVisibleCandidate = {
  readonly bucketKey: string;
  durationSeconds: number;
  readonly segmentIds: Set<string>;
};

// The set of segment ids that fill each bucket's *winning* candidate at the given zoom —
// exactly the segments whose overlap the flow chart aggregates into the block it draws (and
// whose fields it surfaces on hover). Mirrors `buildFlowBlocks`' winner rule: candidates are
// grouped by colorKey (`siteDomain || appName`) per bucket, overlap seconds accumulate per
// candidate, and the candidate with the most accumulated seconds wins each bucket (ties keep
// the first-seen candidate, matching `buildFlowBlocks`' strict `<` replacement). Membership
// depends only on durations, so it is independent of classification state (`options` is
// accepted for signature parity with `buildFlowBlocks`). Used by the first-day gate to reveal
// once every visible block is classified, rather than after the entire day is classified.
export function selectFlowVisibleSegmentIds(
  segments: ActivitySegment[],
  day: string,
  intervalMinutes: FlowIntervalMinutes = 5,
  options?: ClassificationOptions,
  startOfDayMinutes = 0,
): Set<string> {
  segments = aggregateDeviceElapsedTime(segments);
  void options;
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const candidates = new Map<string, FlowVisibleCandidate>();

  forEachFlowBucketContribution(segments, day, intervalMinutes, boundaryMinutes, ({ segment, candidateKey, bucketKey, overlapSeconds }) => {
    const existing = candidates.get(candidateKey);
    if (!existing) {
      candidates.set(candidateKey, { bucketKey, durationSeconds: overlapSeconds, segmentIds: new Set([segment.id]) });
      return;
    }
    existing.durationSeconds += overlapSeconds;
    existing.segmentIds.add(segment.id);
  });

  // Resolve the winning candidate per bucket in candidate-insertion order (strict `<`) so a
  // later, equal-duration candidate never displaces an earlier one — same as buildFlowBlocks.
  const winners = new Map<string, FlowVisibleCandidate>();
  for (const candidate of candidates.values()) {
    const existing = winners.get(candidate.bucketKey);
    if (!existing || existing.durationSeconds < candidate.durationSeconds) {
      winners.set(candidate.bucketKey, candidate);
    }
  }

  const visible = new Set<string>();
  for (const winner of winners.values()) {
    for (const id of winner.segmentIds) visible.add(id);
  }
  return visible;
}

export function buildDailyTotals(segments: ActivitySegment[], startDay: string, endDay: string, startOfDayMinutes = 0): DailyTotal[] {
  segments = aggregateDeviceElapsedTime(segments);
  const totals = new Map<string, number>();
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);

  for (const segment of segments) {
    const bounds = activityTimeBounds(segment);
    let cursor = bounds.start;
    const end = bounds.end;

    while (cursor < end) {
      const current = new Date(cursor);
      const dayKey = logicalDayIsoDateForDate(current, boundaryMinutes);
      const overlapEnd = Math.min(end, logicalDayEndExclusiveMs(dayKey, boundaryMinutes));
      const overlapSeconds = activitySecondsWithinInterval(segment, cursor, overlapEnd);

      totals.set(dayKey, (totals.get(dayKey) ?? 0) + overlapSeconds);
      cursor = overlapEnd;
    }
  }

  const days: DailyTotal[] = [];
  let currentDay = startDay;

  while (currentDay <= endDay) {
    days.push({ day: currentDay, totalSeconds: totals.get(currentDay) ?? 0 });
    currentDay = shiftIsoDate(currentDay, 1);
  }

  return days;
}

export function buildRollingFocusSeconds(segments: ActivitySegment[], startDay: string, endDay: string, options?: ClassificationOptions, startOfDayMinutes = 0): number {
  segments = aggregateDeviceElapsedTime(segments);
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const windowStart = logicalDayStartMs(startDay, boundaryMinutes);
  const windowEnd = logicalDayEndExclusiveMs(endDay, boundaryMinutes);

  if (windowEnd <= windowStart) return 0;

  let totalSeconds = 0;

  for (const segment of segments) {
    if (isExcludedSegment(segment)) continue;
    const { productivity } = classifyActivity(segment, options);
    if (productivity !== "focus") continue;

    const { start: segmentStart, end: segmentEnd } = activityTimeBounds(segment);

    // A newly captured context is stored as a point segment until a later
    // matching sample extends it, while durationSeconds already contains the
    // sampled activity. Preserve that recorded sample instead of dropping it
    // from the leaderboard solely because its timestamp span is zero.
    if (segmentEnd === segmentStart) {
      if (segmentStart >= windowStart && segmentStart < windowEnd && Number.isFinite(segment.durationSeconds)) {
        totalSeconds += Math.max(0, Math.round(segment.durationSeconds));
      }
      continue;
    }

    const clippedStart = Math.max(segmentStart, windowStart);
    const clippedEnd = Math.min(segmentEnd, windowEnd);

    if (clippedEnd <= clippedStart) continue;

    totalSeconds += activitySecondsWithinInterval(segment, clippedStart, clippedEnd);
  }

  return totalSeconds;
}

export function classifyActivity(segment: ActivitySegment, options?: ClassificationOptions): ActivityClassification {
  const { category, productivity } = classifyActivityDetailed(segment, options);
  return { category, productivity };
}

export function classifyActivityDetailed(segment: ActivitySegment, options?: ClassificationOptions): ActivityClassificationDetail {
  return applyDeletedCategory(
    segment,
    applyCategoryProductivityPreference(
      resolveActivityClassificationDetail(segment, options),
      options?.categoryProductivity,
    ),
    options?.deletedCategories,
  );
}

/**
 * Deleting a category means "stop using it from now on": activity that started
 * at or after the deletion is not filed under it, so it reads as unclassified
 * until the classifier picks one of the remaining categories. Earlier records
 * and manual corrections keep it.
 */
function applyDeletedCategory(
  segment: ActivitySegment,
  classification: ActivityClassificationDetail,
  deletedCategories: ClassificationOptions["deletedCategories"],
): ActivityClassificationDetail {
  if (!deletedCategories || classification.source === "manual") return classification;
  if (!isCategoryDeletedAt(classification.category, segment.startedAt, deletedCategories)) return classification;
  return unknownDetail(classification.surface, "Category deleted on this device");
}

/** Whether activity starting at startedAt falls after the category's deletion. */
export function isCategoryDeletedAt(
  category: ActivityCategory,
  startedAt: string,
  deletedCategories: ClassificationOptions["deletedCategories"],
): boolean {
  const deletedAt = deletedCategories?.[category];
  if (!deletedAt) return false;
  const deletedMs = Date.parse(deletedAt);
  const startedMs = Date.parse(startedAt);
  return Number.isFinite(deletedMs) && Number.isFinite(startedMs) && startedMs >= deletedMs;
}

/**
 * Manual corrections and user rules already state the user's productivity for
 * that exact activity, so a category-wide preference never overrides them.
 */
function applyCategoryProductivityPreference(
  classification: ActivityClassificationDetail,
  preferences: ClassificationOptions["categoryProductivity"],
): ActivityClassificationDetail {
  if (!preferences) return classification;
  if (classification.source === "manual" || classification.source === "rule") return classification;
  if (classification.category === "unknown") return classification;
  const preferred = preferences[classification.category];
  if (!preferred) return classification;
  return { ...classification, productivity: preferred, productivityPreference: true };
}

function resolveActivityClassificationDetail(segment: ActivitySegment, options?: ClassificationOptions): ActivityClassificationDetail {
  if (isExcludedSegment(segment)) {
    return detail(
      { category: "unknown", productivity: "neutral" },
      "app",
      "fallback",
      1,
      "Activity excluded by privacy settings",
    );
  }
  const stored = segment.classification;
  const storedUsable = stored && (stored.aiResult !== true || options?.includeAiClassifications !== false) ? stored : null;
  const surface: ClassificationSurface = isBrowserActivity(segment) ? "browser" : "app";

  // Precedence: manual correction > user rule > other stored (llm/rule batch) > heuristics.
  // Live rules must beat stored llm results to mirror apply_classification_rules, which
  // overwrites llm rows when stamping rules onto persisted segments.
  if (storedUsable && storedUsable.source === "manual") {
    return detail(
      { category: storedUsable.category, productivity: storedUsable.productivity },
      surface,
      "manual",
      storedUsable.confidence,
      storedUsable.reason ?? "Stored activity classification",
    );
  }

  const matchedRule = findMatchingClassificationRule(segment, options?.rules);
  if (matchedRule) {
    return detail(
      { category: matchedRule.category, productivity: matchedRule.productivity },
      surface,
      "rule",
      matchedRule.confidence ?? 1,
      `Matched local ${matchedRule.targetKind} rule: ${matchedRule.targetValue}`,
    );
  }

  // Historical built-in heuristic snapshots used source=rule without a rule id.
  // A synced rule snapshot also lacks a local FK. Keep the origin result
  // authoritative without inferring whether it came from a user rule or an
  // automatic rule; the wire payload does not distinguish those cases.
  const stampedHeuristic = storedUsable?.source === "rule"
    && !storedUsable.classificationRuleId
    && storedUsable.ruleSnapshotKind !== "synced-rule";
  if (storedUsable && stampedHeuristic && !shouldIncludeBuiltInHeuristics(segment, options)) {
    return detail(
      { category: storedUsable.category, productivity: storedUsable.productivity },
      surface,
      "stored",
      storedUsable.confidence,
      storedUsable.reason ?? "Stored built-in classification",
    );
  }
  if (storedUsable && !stampedHeuristic) {
    const source: ClassificationSource = storedUsable.source === "llm" || storedUsable.source === "rule" || storedUsable.source === "app-db" || storedUsable.source === "domain-db" || storedUsable.source === "youtube" ? storedUsable.source : "stored";
    return detail(
      { category: storedUsable.category, productivity: storedUsable.productivity },
      surface,
      source,
      storedUsable.confidence,
      storedUsable.reason ?? "Stored activity classification",
      source === "llm" && storedUsable.reusedAiResult === true ? { aiCached: true } : undefined,
    );
  }

  if (!shouldIncludeBuiltInHeuristics(segment, options)) {
    return unknownDetail(surface, "Automatic classification is unavailable for this activity");
  }

  return isBrowserActivity(segment) ? classifyBrowserActivity(segment) : classifyAppActivity(segment);
}

function shouldIncludeBuiltInHeuristics(segment: ActivitySegment, options?: ClassificationOptions): boolean {
  const unavailableSince = options?.builtInHeuristicsUnavailableSince;
  if (!unavailableSince) return options?.includeBuiltInHeuristics !== false;
  const cutoffMs = new Date(unavailableSince).getTime();
  const segmentStartMs = new Date(segment.startedAt).getTime();
  if (!Number.isFinite(cutoffMs) || !Number.isFinite(segmentStartMs)) return options?.includeBuiltInHeuristics !== false;
  return segmentStartMs < cutoffMs;
}

export function findMatchingClassificationRule(segment: ActivitySegment, rules?: ClassificationRuleOption[]): ClassificationRuleOption | null {
  if (!rules || rules.length === 0) return null;

  for (const rule of rules) {
    if (rule.enabled === false || rule.matchScope !== "detail") continue;
    if (ruleSurfaceMatches(segment, rule) && ruleDetailMatches(segment, rule)) return rule;
  }

  for (const rule of rules) {
    if (rule.enabled === false || rule.matchScope === "detail") continue;
    if (ruleSurfaceMatches(segment, rule)) return rule;
  }

  return null;
}

function ruleSurfaceMatches(segment: ActivitySegment, rule: ClassificationRuleOption): boolean {
  if (rule.targetKind === "site") {
    const host = normalizeRuleSiteTarget(segment.siteDomain || segment.siteUrl);
    const target = normalizeRuleSiteTarget(rule.targetValue);
    return Boolean(host && target && (host === target || host.endsWith(`.${target}`)));
  }

  const bundleId = segment.bundleId?.trim() ?? "";
  if (bundleId && bundleId === rule.targetValue.trim()) return true;
  const normalizedTarget = normalizeRuleAppTarget(rule.targetValue);
  return Boolean(normalizedTarget && normalizeRuleAppTarget(segment.appName) === normalizedTarget);
}

function ruleDetailMatches(segment: ActivitySegment, rule: ClassificationRuleOption): boolean {
  if (!rule.detailKind) return false;
  const target = normalizeRuleDetailTarget(rule.detailKind, rule.detailValue);
  if (!target) return false;
  return ruleDetailValues(segment, rule.detailKind).some((value) => value === target);
}

function ruleDetailValues(segment: ActivitySegment, detailKind: NonNullable<ClassificationRuleOption["detailKind"]>): string[] {
  if (detailKind === "siteUrl") {
    const normalized = canonicalizeClassificationRuleSiteUrl(segment.siteUrl);
    return normalized ? [normalized] : [];
  }
  if (detailKind === "title") {
    return [
      normalizeRuleDetailValue(segment.youtubeTitle),
      normalizeRuleDetailValue(segment.siteTitle),
      normalizeRuleDetailValue(segment.windowTitle),
    ].filter((value) => value.length > 0);
  }
  return [normalizeRuleDetailValue(segment[detailKind])].filter((value) => value.length > 0);
}

// Mirrors the tracker's _normalize_site_target so live matching agrees with the stored batch.
function normalizeRuleSiteTarget(value?: string | null): string {
  let host = normalizeText(value);
  // Bare IPv6 is the legacy tracker representation. URL() supplies the
  // same bracketed/compressed identity as the current persisted rule.
  if (host.includes(":")) {
    try {
      const candidate = host.includes("://") ? host : host.startsWith("[") ? `https://${host}` : `https://[${host}]`;
      const parsed = new URL(candidate);
      if (parsed.hostname.startsWith("[")) return parsed.hostname;
    } catch { /* Ordinary hosts with ports continue through the existing path. */ }
  }
  const schemeIndex = host.indexOf("://");
  if (schemeIndex !== -1) host = host.slice(schemeIndex + 3);
  host = host.split("/")[0].split("?")[0].split("#")[0];
  const credentialsIndex = host.lastIndexOf("@");
  if (credentialsIndex !== -1) host = host.slice(credentialsIndex + 1);
  host = host.split(":")[0];
  while (host.startsWith("www.")) host = host.slice(4);
  return host.replace(/^\.+|\.+$/g, "");
}

function normalizeRuleAppTarget(value?: string | null): string {
  return normalizeText(value).split(/\s+/).filter(Boolean).join(" ");
}

function normalizeRuleDetailValue(value?: string | null): string {
  return normalizeText(value).split(/\s+/).filter(Boolean).join(" ");
}

function normalizeRuleDetailTarget(
  detailKind: NonNullable<ClassificationRuleOption["detailKind"]>,
  value?: string | null,
): string {
  if (detailKind === "siteUrl") return canonicalizeClassificationRuleSiteUrl(value) ?? "";
  return normalizeRuleDetailValue(value);
}

export function categorizeActivity(segment: ActivitySegment, options?: ClassificationOptions): ProductivityLabel {
  return classifyActivity(segment, options).productivity;
}

const PRESERVED_FOCUS_STRIKE_MAX_GAP_SECONDS = 5 * 60;

/**
 * Sum the live run ending at a Focus segment.
 *
 * A run follows Drifty's productivity verdict rather than app identity: moving
 * from VS Code to Figma keeps the run alive when both segments classify as
 * Focus. Any observed Drift/Neutral segment, or an uncaptured gap over five
 * minutes, ends it.
 */
export function computeCurrentFocusStrikeSeconds(
  segments: ActivitySegment[],
  currentFocusSegment: ActivitySegment,
  options?: ClassificationOptions,
): number | null {
  if (categorizeActivity(currentFocusSegment, options) !== "focus") return null;

  const sourceSegments = segments.some((segment) => segment.id === currentFocusSegment.id)
    ? segments
    : [...segments, currentFocusSegment];
  const orderedSegments = [...sourceSegments].sort((left, right) => {
    const leftStart = new Date(left.startedAt).getTime();
    const rightStart = new Date(right.startedAt).getTime();
    if (leftStart !== rightStart) return leftStart - rightStart;
    return new Date(left.endedAt).getTime() - new Date(right.endedAt).getTime();
  });
  const currentIndex = orderedSegments.findIndex((segment) => segment.id === currentFocusSegment.id);
  if (currentIndex !== orderedSegments.length - 1) return null;

  let boundaryStartMs = new Date(currentFocusSegment.startedAt).getTime();
  if (!Number.isFinite(boundaryStartMs)) return null;
  let strikeSeconds = Math.max(0, currentFocusSegment.durationSeconds);

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const segment = orderedSegments[index];
    const segmentEndMs = new Date(segment.endedAt).getTime();
    const segmentStartMs = new Date(segment.startedAt).getTime();
    if (!Number.isFinite(segmentEndMs) || !Number.isFinite(segmentStartMs)) break;
    if (segmentEndMs > boundaryStartMs) continue;

    const gapSeconds = Math.max(0, Math.round((boundaryStartMs - segmentEndMs) / 1000));
    if (gapSeconds > PRESERVED_FOCUS_STRIKE_MAX_GAP_SECONDS) break;
    if (categorizeActivity(segment, options) !== "focus") break;

    strikeSeconds += Math.max(0, segment.durationSeconds);
    boundaryStartMs = segmentStartMs;
  }

  return strikeSeconds > 0 ? strikeSeconds : null;
}

export function computePreservedFocusStrikeSeconds(
  segments: ActivitySegment[],
  currentDriftSegment: ActivitySegment,
  options?: ClassificationOptions,
): number | null {
  if (categorizeActivity(currentDriftSegment, options) !== "drift") return null;

  const sourceSegments = segments.some((segment) => segment.id === currentDriftSegment.id)
    ? segments
    : [...segments, currentDriftSegment];
  const orderedSegments = [...sourceSegments].sort((left, right) => {
    const leftStart = new Date(left.startedAt).getTime();
    const rightStart = new Date(right.startedAt).getTime();
    if (leftStart !== rightStart) return leftStart - rightStart;
    return new Date(left.endedAt).getTime() - new Date(right.endedAt).getTime();
  });
  const currentIndex = orderedSegments.findIndex((segment) => segment.id === currentDriftSegment.id);
  if (currentIndex !== orderedSegments.length - 1) return null;
  let boundaryStartMs = new Date(currentDriftSegment.startedAt).getTime();
  if (!Number.isFinite(boundaryStartMs)) return null;
  let preservedSeconds = 0;

  for (let index = currentIndex >= 0 ? currentIndex - 1 : orderedSegments.length - 1; index >= 0; index -= 1) {
    const segment = orderedSegments[index];
    const segmentEndMs = new Date(segment.endedAt).getTime();
    const segmentStartMs = new Date(segment.startedAt).getTime();
    if (!Number.isFinite(segmentEndMs) || !Number.isFinite(segmentStartMs)) return preservedSeconds > 0 ? preservedSeconds : null;
    if (segmentEndMs > boundaryStartMs) continue;

    const gapSeconds = Math.max(0, Math.round((boundaryStartMs - segmentEndMs) / 1000));
    if (gapSeconds > PRESERVED_FOCUS_STRIKE_MAX_GAP_SECONDS) break;
    if (categorizeActivity(segment, options) !== "focus") break;

    preservedSeconds += segment.durationSeconds;
    boundaryStartMs = segmentStartMs;
  }

  return preservedSeconds > 0 ? preservedSeconds : null;
}

export function buildCategoryDurations(segments: ActivitySegment[], options?: ClassificationOptions): CategoryDuration[] {
  segments = aggregateDeviceElapsedTime(segments);
  const totals: CategoryDuration[] = CATEGORY_ORDER.map((category) => ({
    category,
    totalSeconds: 0,
    segments: 0,
    ratio: 0,
    neutralSeconds: 0,
  }));
  const totalSeconds = totalDurationSeconds(segments);

  for (const segment of segments) {
    if (isExcludedSegment(segment)) continue;
    const { category, productivity } = classifyActivity(segment, options);
    let target = totals.find((entry) => entry.category === category);
    // A user-added category joins the list the first time it has time,
    // ahead of unclassified, which stays last.
    if (!target && isCustomActivityCategory(category)) {
      target = { category, totalSeconds: 0, segments: 0, ratio: 0, neutralSeconds: 0 };
      totals.splice(totals.length - 1, 0, target);
    }
    if (!target) continue;
    target.totalSeconds += segment.durationSeconds;
    target.segments += 1;
    if (productivity === "neutral") target.neutralSeconds = (target.neutralSeconds ?? 0) + segment.durationSeconds;
  }

  return totals.map((entry) => ({
    ...entry,
    ratio: totalSeconds > 0 ? entry.totalSeconds / totalSeconds : 0,
  }));
}

/**
 * Direct classified productivity totals. This is the canonical Focus hours
 * metric for Day, Week, Trends, share, and leaderboard. Contextual smoothing
 * of short utility/communication belongs in buildEffectiveProductivityDurations
 * for timeline coloring, not this number.
 */
export function buildProductivityDurations(segments: ActivitySegment[], options?: ClassificationOptions): ProductivityDuration[] {
  segments = aggregateDeviceElapsedTime(segments);
  const totals = PRODUCTIVITY_ORDER.map((productivity) => ({
    productivity,
    totalSeconds: 0,
    segments: 0,
    ratio: 0,
  }));

  for (const segment of segments) {
    const { category, productivity } = classifyActivity(segment, options);
    // Unclassified time (pending AI, blank screens, LLM unknown) is not a
    // productivity verdict; keep it out of the buckets and the ratio
    // denominator so charts describe classified time only.
    if (category === "unknown") continue;
    const target = totals.find((entry) => entry.productivity === productivity);
    if (!target) continue;
    target.totalSeconds += segment.durationSeconds;
    target.segments += 1;
  }

  const classifiedSeconds = totals.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  return totals.map((entry) => ({
    ...entry,
    ratio: classifiedSeconds > 0 ? entry.totalSeconds / classifiedSeconds : 0,
  }));
}

export function buildEffectiveProductivityDurations(segments: ActivitySegment[], options?: ClassificationOptions): ProductivityDuration[] {
  segments = aggregateDeviceElapsedTime(segments);
  const totals = PRODUCTIVITY_ORDER.map((productivity) => ({
    productivity,
    totalSeconds: 0,
    segments: 0,
    ratio: 0,
  }));
  const effectiveProductivityBySegmentId = buildEffectiveProductivityBySegmentId(segments, options);

  for (const segment of segments) {
    const classification = classifyActivityDetailed(segment, options);
    if (classification.category === "unknown") continue;
    const effectiveProductivity = effectiveProductivityBySegmentId.get(segment.id) ?? directProductivity(classification.productivity);
    const target = totals.find((entry) => entry.productivity === effectiveProductivity.productivity);
    if (!target) continue;
    target.totalSeconds += segment.durationSeconds;
    target.segments += 1;
  }

  const classifiedSeconds = totals.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  return totals.map((entry) => ({
    ...entry,
    ratio: classifiedSeconds > 0 ? entry.totalSeconds / classifiedSeconds : 0,
  }));
}

export function buildDayRibbonSegments(segments: ActivitySegment[], day: string, options?: ClassificationOptions, startOfDayMinutes = 0): DayRibbonSegment[] {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const dayStart = logicalDayStartMs(day, boundaryMinutes);
  const dayEnd = logicalDayEndExclusiveMs(day, boundaryMinutes);
  const clipped: Array<{
    category: ActivityCategory;
    productivity: ProductivityLabel;
    classificationSource?: ClassificationSource | null;
    aiClassification?: boolean | null;
    aiCachedClassification?: boolean | null;
    classificationReason?: string | null;
    startMinute: number;
    endMinute: number;
    activity: DayRibbonSegment["activities"][number];
  }> = [];

  for (const segment of segments) {
    const startMs = Math.max(new Date(segment.startedAt).getTime(), dayStart);
    const endMs = Math.min(new Date(segment.endedAt).getTime(), dayEnd);
    if (endMs <= startMs) continue;

    const classification = classifyActivityDetailed(segment, options);
    clipped.push({
      category: classification.category,
      productivity: classification.productivity,
      classificationSource: classification.source,
      aiClassification: classification.source === "llm",
      aiCachedClassification: classification.aiCached ?? null,
      classificationReason: classification.reason,
      startMinute: Math.max(0, Math.floor((startMs - dayStart) / 60000)),
      endMinute: Math.min(24 * 60, Math.ceil((endMs - dayStart) / 60000)),
      activity: {
        appName: segment.appName,
        windowTitle: segment.windowTitle ?? null,
        siteDomain: segment.siteDomain ?? null,
        siteTitle: segment.siteTitle ?? null,
        durationSeconds: Math.max(0, Math.round((endMs - startMs) / 1000)),
        classificationSource: classification.source,
        aiClassification: classification.source === "llm",
        aiCachedClassification: classification.aiCached ?? null,
        classificationReason: classification.reason,
      },
    });
  }

  clipped.sort((left, right) => left.startMinute - right.startMinute);

  const merged: DayRibbonSegment[] = [];

  for (const segment of clipped) {
    const previous = merged[merged.length - 1];
    if (previous && previous.category === segment.category && previous.endMinute >= segment.startMinute) {
      previous.endMinute = Math.max(previous.endMinute, segment.endMinute);
      previous.totalSeconds = Math.max((previous.endMinute - previous.startMinute) * 60, previous.totalSeconds);
      if (segment.aiClassification) previous.aiClassification = true;
      if (segment.aiCachedClassification) previous.aiCachedClassification = true;
      previous.activities.push(segment.activity);
      continue;
    }

    merged.push({
      id: `${segment.category}-${segment.startMinute}-${segment.endMinute}`,
      category: segment.category,
      productivity: segment.productivity,
      classificationSource: segment.classificationSource,
      aiClassification: segment.aiClassification,
      aiCachedClassification: segment.aiCachedClassification,
      classificationReason: segment.classificationReason,
      startMinute: segment.startMinute,
      endMinute: segment.endMinute,
      totalSeconds: Math.max((segment.endMinute - segment.startMinute) * 60, 60),
      activities: [segment.activity],
    });
  }

  return merged;
}

const PRODUCTIVITY_PERSONAS: Record<ProductivityPersonaId, { id: ProductivityPersonaId; name: ProductivityPersonaName }> = {
  deep_diver: { id: "deep_diver", name: "Deep Diver" },
  deep_focus_deep_drift: { id: "deep_focus_deep_drift", name: "Deep Focus, Deep Drift" },
  drift_diver: { id: "drift_diver", name: "Drift Diver" },
  focus_sprinter: { id: "focus_sprinter", name: "Focus Sprinter" },
  reactive_operator: { id: "reactive_operator", name: "Reactive Operator" },
  night_owl: { id: "night_owl", name: "Night Owl" },
  balanced_builder: { id: "balanced_builder", name: "Balanced Builder" },
};

export function buildProductivityPersona(segments: ActivitySegment[], options?: ClassificationOptions): ProductivityPersonaReport {
  segments = aggregateDeviceElapsedTime(segments);
  const orderedSegments = segments.slice().sort((left, right) => {
    const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
    if (startedAtOrder !== 0) return startedAtOrder;
    return left.id.localeCompare(right.id);
  });
  const metrics = buildProductivityPersonaMetrics(orderedSegments, options ?? {});
  const scores = scoreDriftyProductivityRubricV1(metrics);
  const persona = resolveProductivityPersona(metrics, scores);

  return {
    personaId: persona.id,
    personaName: persona.name,
    rubricVersion: DRIFTY_PRODUCTIVITY_RUBRIC_V1.version,
    scores,
    axes: buildProductivityPersonaAxes(metrics),
    metrics,
  };
}

function buildProductivityPersonaMetrics(segments: ActivitySegment[], options: ClassificationOptions): ProductivityPersonaMetrics {
  let focusSeconds = 0;
  let neutralSeconds = 0;
  let driftSeconds = 0;
  let unclassifiedSeconds = 0;
  let focusSegments = 0;
  let driftSegments = 0;
  let communicationSeconds = 0;
  let nightSeconds = 0;
  let contextSwitches = 0;
  const activeDays = new Set<string>();
  const surfaceTotals = new Map<string, number>();

  let previousSurfaceKey: string | null = null;

  for (const segment of segments) {
    const classification = classifyActivity(segment, options);
    const durationSeconds = segment.durationSeconds;
    const surfaceKey = personaSurfaceKey(segment);

    if (previousSurfaceKey !== null && previousSurfaceKey !== surfaceKey) {
      contextSwitches += 1;
    }
    previousSurfaceKey = surfaceKey;

    surfaceTotals.set(surfaceKey, (surfaceTotals.get(surfaceKey) ?? 0) + durationSeconds);

    const bounds = activityTimeBounds(segment);
    let cursor = bounds.start;
    const end = bounds.end;
    while (cursor < end) {
      const current = new Date(cursor);
      const dayKey = logicalDayIsoDateForDate(current);
      activeDays.add(dayKey);
      const dayStart = logicalDayStartMs(dayKey);
      const nightStart = dayStart + 22 * 60 * 60 * 1000;
      const nightEnd = dayStart + 29 * 60 * 60 * 1000;
      const overlapStart = Math.max(cursor, nightStart);
      const overlapEnd = Math.min(end, nightEnd);
      if (overlapEnd > overlapStart) {
        nightSeconds += activitySecondsWithinInterval(segment, overlapStart, overlapEnd);
      }
      cursor = Math.min(end, logicalDayEndExclusiveMs(dayKey));
    }

    if (classification.productivity === "focus") {
      focusSeconds += durationSeconds;
      focusSegments += 1;
    } else if (classification.productivity === "drift") {
      driftSeconds += durationSeconds;
      driftSegments += 1;
    } else if (classification.category !== "unknown") {
      neutralSeconds += durationSeconds;
    } else {
      unclassifiedSeconds += durationSeconds;
    }

    if (classification.category === "communication") {
      communicationSeconds += durationSeconds;
    }
  }

  const totalSeconds = totalDurationSeconds(segments);
  // Productivity shares describe classified time only; unclassified time
  // (pending AI, blank screens) must not dilute focus/neutral/drift ratios.
  const classifiedSeconds = totalSeconds - unclassifiedSeconds;
  const topSurfaceSeconds = Math.max(0, ...surfaceTotals.values());
  const totalHours = totalSeconds / 3600;

  return {
    totalSeconds,
    focusSeconds,
    focusShare: classifiedSeconds > 0 ? focusSeconds / classifiedSeconds : 0,
    neutralSeconds,
    neutralShare: classifiedSeconds > 0 ? neutralSeconds / classifiedSeconds : 0,
    driftSeconds,
    driftShare: classifiedSeconds > 0 ? driftSeconds / classifiedSeconds : 0,
    focusAverageSegmentSeconds: focusSegments > 0 ? focusSeconds / focusSegments : 0,
    driftAverageSegmentSeconds: driftSegments > 0 ? driftSeconds / driftSegments : 0,
    contextSwitches,
    switchRatePerHour: totalHours > 0 ? contextSwitches / totalHours : 0,
    uniqueSurfaceCount: surfaceTotals.size,
    topSurfaceShare: totalSeconds > 0 ? topSurfaceSeconds / totalSeconds : 0,
    communicationSeconds,
    communicationShare: totalSeconds > 0 ? communicationSeconds / totalSeconds : 0,
    reactiveSeconds: communicationSeconds,
    reactiveShare: totalSeconds > 0 ? communicationSeconds / totalSeconds : 0,
    nightSeconds,
    nightShare: totalSeconds > 0 ? nightSeconds / totalSeconds : 0,
    activeDays: activeDays.size,
  };
}

function buildProductivityPersonaAxes(metrics: ProductivityPersonaMetrics): ProductivityPersonaAxis[] {
  return [
    { key: "focus", label: "Focus", value: metrics.focusShare },
    { key: "drift", label: "Drift", value: metrics.driftShare },
    { key: "switching", label: "Switching", value: clamp(metrics.switchRatePerHour / 12, 0, 1) },
    { key: "surfaces", label: "Surfaces", value: clamp(metrics.uniqueSurfaceCount / 10, 0, 1) },
    { key: "reactive", label: "Reactive", value: metrics.reactiveShare },
    { key: "night", label: "Night", value: metrics.nightShare },
  ];
}

function resolveProductivityPersona(
  metrics: ProductivityPersonaMetrics,
  scores: ProductivityRubricScore,
): { id: ProductivityPersonaId; name: ProductivityPersonaName } {
  const { personas } = DRIFTY_PRODUCTIVITY_RUBRIC_V1;
  const focusQualityScore = scoreForDimension(scores, "focus_quality");
  const driftControlScore = scoreForDimension(scores, "drift_control");
  const switchingStabilityScore = scoreForDimension(scores, "switching_stability");

  if (metrics.nightShare >= personas.nightOwl.nightShareMinimum) return PRODUCTIVITY_PERSONAS.night_owl;
  if (
    metrics.focusShare >= personas.deepFocusDeepDrift.focusShareMinimum &&
    metrics.driftShare >= personas.deepFocusDeepDrift.driftShareMinimum
  ) {
    return PRODUCTIVITY_PERSONAS.deep_focus_deep_drift;
  }
  if (
    metrics.focusShare >= personas.deepDiver.focusShareMinimum &&
    metrics.focusAverageSegmentSeconds >= personas.deepDiver.focusAverageSegmentSecondsMinimum &&
    metrics.switchRatePerHour <= personas.deepDiver.switchRatePerHourMaximum &&
    focusQualityScore >= personas.deepDiver.focusQualityScoreMinimum &&
    switchingStabilityScore >= personas.deepDiver.switchingStabilityScoreMinimum
  ) {
    return PRODUCTIVITY_PERSONAS.deep_diver;
  }
  if (
    metrics.driftShare >= personas.driftDiver.driftShareMinimum &&
    metrics.driftAverageSegmentSeconds >= personas.driftDiver.driftAverageSegmentSecondsMinimum &&
    driftControlScore <= personas.driftDiver.driftControlScoreMaximum
  ) {
    return PRODUCTIVITY_PERSONAS.drift_diver;
  }
  if (
    metrics.focusShare >= personas.focusSprinter.focusShareMinimum &&
    metrics.focusAverageSegmentSeconds < personas.focusSprinter.focusAverageSegmentSecondsMaximum
  ) {
    return PRODUCTIVITY_PERSONAS.focus_sprinter;
  }
  if (metrics.reactiveShare >= personas.reactiveOperator.reactiveShareMinimum) {
    return PRODUCTIVITY_PERSONAS.reactive_operator;
  }
  return PRODUCTIVITY_PERSONAS.balanced_builder;
}

function scoreForDimension(scores: ProductivityRubricScore, key: ProductivityScoreDimensionKey): number {
  return scores.dimensions.find((dimension) => dimension.key === key)?.score ?? 0;
}

function personaSurfaceKey(segment: ActivitySegment): string {
  const normalizedDomain = normalizeDomain(segment.siteDomain);
  if (normalizedDomain) {
    return `site:${normalizedDomain}`;
  }
  return `app:${normalizeText(segment.appName)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export const CATEGORY_ORDER: ActivityCategory[] = [
  "workspace",
  "learning",
  "communication",
  "music",
  "game",
  "social_media",
  "entertainment",
  "shopping",
  "utility",
  "unknown",
];

export const PRODUCTIVITY_ORDER: ProductivityLabel[] = ["focus", "neutral", "drift"];

const PRODUCTIVITY_CONTEXT_ACTIVE_SECONDS = 5 * 60;
const PRODUCTIVITY_CONTEXT_MAX_WINDOW_SECONDS = 10 * 60;
const MINIMUM_CONTEXT_WINDOW_TRACKED_SECONDS = 2 * 60;
const CONTEXT_WINDOW_STRONG_SHARE = 0.7;
const CONTEXTUAL_PRODUCTIVITY_MAX_PASSES = 6;
const COMMUNICATION_EPISODE_MAX_GAP_SECONDS = 60;
const MIXED_COMMUNICATION_CONTEXTUAL_FOCUS_SECONDS = 5 * 60;
const WORK_PRIMARY_COMMUNICATION_SHORT_SECONDS = 8 * 60;
const WORK_PRIMARY_COMMUNICATION_EXTENDED_SECONDS = 20 * 60;
const UTILITY_CONTEXTUAL_SECONDS = 90;

type ClassifiedSegment = {
  readonly segment: ActivitySegment;
  readonly classification: ActivityClassificationDetail;
  readonly startMs: number;
  readonly endMs: number;
};

type EffectiveProductivityResolution = {
  readonly productivity: ProductivityLabel;
  readonly basis: ProductivityBasis;
};

type CommunicationClass = "work_primary" | "mixed" | "unknown";

type ContextWindowStats = {
  readonly trackedSeconds: number;
  readonly strongFocusSeconds: number;
  readonly driftSeconds: number;
  readonly strongFocus: boolean;
  readonly driftDominated: boolean;
};

type ContextWindowDirection = "before" | "after";

const WORK_PRIMARY_COMMUNICATION_APP_NAMES: readonly string[] = [
  "slack",
  "microsoft teams",
  "teams",
  "zoom",
  "zoom.us",
  "gmail",
  "mail",
  "microsoft outlook",
  "outlook",
  "calendar",
  "google calendar",
] as const;
const WORK_PRIMARY_COMMUNICATION_BUNDLE_IDS: readonly string[] = [
  "com.tinyspeck.slackmacgap",
  "com.microsoft.teams",
  "com.microsoft.teams2",
  "us.zoom.xos",
  "com.apple.mail",
  "com.microsoft.outlook",
] as const;
const WORK_PRIMARY_COMMUNICATION_DOMAINS: readonly string[] = [
  "slack.com",
  "mail.google.com",
  "gmail.com",
  "outlook.live.com",
  "outlook.office.com",
  "teams.microsoft.com",
  "zoom.us",
  "meet.google.com",
  "calendar.google.com",
] as const;
const MIXED_COMMUNICATION_APP_NAMES: readonly string[] = ["kakaotalk", "discord", "telegram", "whatsapp", "messages"] as const;
const MIXED_COMMUNICATION_BUNDLE_IDS: readonly string[] = [
  "com.kakao.kakaotalkmac",
  "com.hnc.discord",
  "org.telegram.desktop",
  "com.apple.messages",
] as const;
const MIXED_COMMUNICATION_DOMAINS: readonly string[] = ["discord.com", "whatsapp.com", "web.whatsapp.com", "telegram.org", "web.telegram.org"] as const;

function createFlowBlockBuildContext(
  segments: ActivitySegment[],
  options?: ClassificationOptions,
): FlowBlockBuildContext {
  const classifiedSegments = classifiedSegmentsInTimeOrder(segments, options);
  return {
    classificationBySegmentId: new Map(
      classifiedSegments.map(({ segment, classification }) => [segment.id, classification]),
    ),
    effectiveProductivityBySegmentId: buildEffectiveProductivityFromClassifiedSegments(classifiedSegments),
  };
}

function buildEffectiveProductivityBySegmentId(segments: ActivitySegment[], options?: ClassificationOptions): Map<string, EffectiveProductivityResolution> {
  return buildEffectiveProductivityFromClassifiedSegments(classifiedSegmentsInTimeOrder(segments, options));
}

function buildEffectiveProductivityFromClassifiedSegments(
  classifiedSegments: readonly ClassifiedSegment[],
): Map<string, EffectiveProductivityResolution> {
  const productivities = new Map<string, EffectiveProductivityResolution>();
  const episodes = communicationEpisodes(classifiedSegments);

  for (const item of classifiedSegments) {
    productivities.set(item.segment.id, defaultEffectiveProductivityForClassification(item.classification));
  }

  for (let pass = 0; pass < CONTEXTUAL_PRODUCTIVITY_MAX_PASSES; pass += 1) {
    let changed = false;

    for (const episode of episodes) {
      const productivity = communicationEpisodeProductivity(episode, classifiedSegments, productivities);
      for (const item of episode) {
        if (item.classification.productivity !== "neutral") continue;
        if (item.classification.productivityPreference) continue;
        changed = setEffectiveProductivity(productivities, item, productivity) || changed;
      }
    }

    for (const item of classifiedSegments) {
      if (item.classification.category !== "utility") continue;
      if (item.classification.productivity !== "neutral") continue;
      if (item.classification.productivityPreference) continue;
      changed = setEffectiveProductivity(productivities, item, utilityProductivity(item, classifiedSegments, productivities)) || changed;
    }

    if (!changed) break;
  }

  return productivities;
}

export type ProjectAttributionBasis = "direct" | "contextual";

export interface EffectiveProjectResolution {
  readonly projectId: string | null;
  readonly basis: ProjectAttributionBasis;
}

/**
 * Contextual project smoothing — the project analog of the neutral-adaptive
 * productivity resolution. An unassigned segment inherits a project when that
 * project dominates its surrounding window (same window/share thresholds the
 * productivity smoothing uses, so both layers reach equally far). Only DIRECT
 * (AI/manual) assignments seed the context, so contextual fills never cascade.
 */
export function buildContextualProjectBySegmentId(
  segments: ActivitySegment[],
  assignmentBySegmentId: ReadonlyMap<string, string | null>,
  options?: ClassificationOptions,
): Map<string, EffectiveProjectResolution> {
  const classifiedSegments = classifiedSegmentsInTimeOrder(segments, options);
  const result = new Map<string, EffectiveProjectResolution>();
  for (const item of classifiedSegments) {
    result.set(item.segment.id, { projectId: assignmentBySegmentId.get(item.segment.id) ?? null, basis: "direct" });
  }
  for (const item of classifiedSegments) {
    if (result.get(item.segment.id)?.projectId) continue;
    const dominant = dominantProjectInWindow(classifiedSegments, assignmentBySegmentId, item);
    if (dominant) result.set(item.segment.id, { projectId: dominant, basis: "contextual" });
  }
  return result;
}

function dominantProjectInWindow(
  classifiedSegments: readonly ClassifiedSegment[],
  assignmentBySegmentId: ReadonlyMap<string, string | null>,
  anchor: ClassifiedSegment,
): string | null {
  const maxWindowMs = PRODUCTIVITY_CONTEXT_MAX_WINDOW_SECONDS * 1000;
  const windowStartMs = anchor.startMs - maxWindowMs;
  const windowEndMs = anchor.endMs + maxWindowMs;
  const secondsByProject = new Map<string, number>();
  let trackedSeconds = 0;

  for (const item of classifiedSegments) {
    if (item.segment.id === anchor.segment.id) continue;
    if (item.endMs <= windowStartMs) continue;
    if (item.startMs >= windowEndMs) break;
    const projectId = assignmentBySegmentId.get(item.segment.id) ?? null;
    if (!projectId) continue;
    const overlapSeconds = clippedOverlapSeconds(item, windowStartMs, windowEndMs);
    if (overlapSeconds <= 0) continue;
    secondsByProject.set(projectId, (secondsByProject.get(projectId) ?? 0) + overlapSeconds);
    trackedSeconds += overlapSeconds;
  }

  if (trackedSeconds < MINIMUM_CONTEXT_WINDOW_TRACKED_SECONDS) return null;
  let topProjectId: string | null = null;
  let topSeconds = 0;
  for (const [projectId, seconds] of secondsByProject) {
    if (seconds > topSeconds) {
      topSeconds = seconds;
      topProjectId = projectId;
    }
  }
  return topProjectId && topSeconds / trackedSeconds >= CONTEXT_WINDOW_STRONG_SHARE ? topProjectId : null;
}

function classifiedSegmentsInTimeOrder(segments: ActivitySegment[], options?: ClassificationOptions): ClassifiedSegment[] {
  return segments.flatMap((segment): ClassifiedSegment[] => {
    // Flow buckets include the forward interval of a projected live point
    // sample. Classify the same bounds so its first render has a matching entry.
    const { start: startMs, end: endMs } = activityTimeBounds(segment);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    return [{
      segment,
      classification: classifyActivityDetailed(segment, options),
      startMs,
      endMs,
    }];
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

function defaultEffectiveProductivityForClassification(classification: ActivityClassificationDetail): EffectiveProductivityResolution {
  return directProductivity(classification.productivity);
}

function directProductivity(productivity: ProductivityLabel): EffectiveProductivityResolution {
  return { productivity, basis: "direct" };
}

function resolveEffectiveProductivity(productivity: ProductivityLabel, sourceProductivity: ProductivityLabel): EffectiveProductivityResolution {
  return {
    productivity,
    basis: productivity === sourceProductivity ? "direct" : "contextual",
  };
}

function setEffectiveProductivity(
  productivities: Map<string, EffectiveProductivityResolution>,
  item: ClassifiedSegment,
  productivity: ProductivityLabel,
): boolean {
  const nextProductivity = resolveEffectiveProductivity(productivity, item.classification.productivity);
  const currentProductivity = productivities.get(item.segment.id);
  if (
    currentProductivity?.productivity === nextProductivity.productivity
    && currentProductivity.basis === nextProductivity.basis
  ) {
    return false;
  }
  productivities.set(item.segment.id, nextProductivity);
  return true;
}

function communicationEpisodes(classifiedSegments: readonly ClassifiedSegment[]): ClassifiedSegment[][] {
  const episodes: ClassifiedSegment[][] = [];
  let current: ClassifiedSegment[] = [];

  for (const item of classifiedSegments) {
    if (item.classification.category !== "communication") {
      pushCommunicationEpisode(episodes, current);
      current = [];
      continue;
    }

    const previous = current[current.length - 1];
    if (previous && item.startMs - previous.endMs > COMMUNICATION_EPISODE_MAX_GAP_SECONDS * 1000) {
      pushCommunicationEpisode(episodes, current);
      current = [];
    }
    current.push(item);
  }

  pushCommunicationEpisode(episodes, current);
  return episodes;
}

function pushCommunicationEpisode(episodes: ClassifiedSegment[][], episode: ClassifiedSegment[]): void {
  if (episode.length > 0) episodes.push(episode);
}

function communicationEpisodeProductivity(
  episode: readonly ClassifiedSegment[],
  classifiedSegments: readonly ClassifiedSegment[],
  productivities: ReadonlyMap<string, EffectiveProductivityResolution>,
): ProductivityLabel {
  const first = episode[0];
  const last = episode[episode.length - 1];
  if (!first || !last) return "neutral";

  const durationSeconds = Math.round((last.endMs - first.startMs) / 1000);
  const before = contextWindowStats(classifiedSegments, productivities, first.startMs, "before");
  const after = contextWindowStats(classifiedSegments, productivities, last.endMs, "after");
  const communicationClass = episodeCommunicationClass(episode);

  if (communicationClass === "mixed") {
    return durationSeconds <= MIXED_COMMUNICATION_CONTEXTUAL_FOCUS_SECONDS && before.strongFocus && after.strongFocus
      ? "focus"
      : "neutral";
  }

  if (communicationClass !== "work_primary") return "neutral";
  if (
    durationSeconds <= WORK_PRIMARY_COMMUNICATION_SHORT_SECONDS
    && ((before.strongFocus && !after.driftDominated) || (after.strongFocus && !before.driftDominated))
  ) {
    return "focus";
  }
  if (durationSeconds <= WORK_PRIMARY_COMMUNICATION_EXTENDED_SECONDS && before.strongFocus && after.strongFocus) {
    return "focus";
  }
  return "neutral";
}

function episodeCommunicationClass(episode: readonly ClassifiedSegment[]): CommunicationClass {
  let hasWorkPrimary = false;

  for (const item of episode) {
    const communicationClass = segmentCommunicationClass(item.segment);
    if (communicationClass === "mixed") return "mixed";
    if (communicationClass === "work_primary") hasWorkPrimary = true;
  }

  return hasWorkPrimary ? "work_primary" : "unknown";
}

function segmentCommunicationClass(segment: ActivitySegment): CommunicationClass {
  const appName = normalizeText(segment.appName);
  const bundleId = normalizeText(segment.bundleId);
  const domain = communicationDomain(segment);

  if (
    matchesKnownText(appName, MIXED_COMMUNICATION_APP_NAMES)
    || matchesKnownText(bundleId, MIXED_COMMUNICATION_BUNDLE_IDS)
    || matchesKnownDomain(domain, MIXED_COMMUNICATION_DOMAINS)
  ) {
    return "mixed";
  }

  if (
    matchesKnownText(appName, WORK_PRIMARY_COMMUNICATION_APP_NAMES)
    || matchesKnownText(bundleId, WORK_PRIMARY_COMMUNICATION_BUNDLE_IDS)
    || matchesKnownDomain(domain, WORK_PRIMARY_COMMUNICATION_DOMAINS)
  ) {
    return "work_primary";
  }

  return "unknown";
}

function matchesKnownText(value: string, candidates: readonly string[]): boolean {
  return Boolean(value && candidates.includes(value));
}

function communicationDomain(segment: ActivitySegment): string {
  const rawDomain = segment.siteDomain || segment.siteUrl;
  if (!rawDomain) return "";

  const normalized = normalizeDomain(rawDomain);
  if (normalized && !normalized.includes("/") && !normalized.includes(":")) return normalized;

  const trimmed = rawDomain.trim();
  try {
    return normalizeDomain(new URL(trimmed).hostname);
  } catch {
    try {
      return normalizeDomain(new URL(`https://${trimmed}`).hostname);
    } catch {
      return "";
    }
  }
}

function matchesKnownDomain(domain: string, domains: readonly string[]): boolean {
  return Boolean(domain && domains.some((candidate) => domainMatches(domain, candidate)));
}

function contextWindowStats(
  classifiedSegments: readonly ClassifiedSegment[],
  productivities: ReadonlyMap<string, EffectiveProductivityResolution>,
  anchorMs: number,
  direction: ContextWindowDirection,
): ContextWindowStats {
  let trackedSeconds = 0;
  let strongFocusSeconds = 0;
  let driftSeconds = 0;
  const maxWindowMs = PRODUCTIVITY_CONTEXT_MAX_WINDOW_SECONDS * 1000;
  const activeTargetSeconds = PRODUCTIVITY_CONTEXT_ACTIVE_SECONDS;

  const addTrackedSeconds = (item: ClassifiedSegment, overlapSeconds: number): void => {
    const countedSeconds = Math.min(overlapSeconds, activeTargetSeconds - trackedSeconds);
    if (countedSeconds <= 0) return;

    trackedSeconds += countedSeconds;
    const productivity = contextualProductivity(item, productivities);
    if (productivity === "focus") {
      strongFocusSeconds += countedSeconds;
    }
    if (productivity === "drift") {
      driftSeconds += countedSeconds;
    }
  };

  if (direction === "before") {
    const windowStartMs = anchorMs - maxWindowMs;
    for (let index = classifiedSegments.length - 1; index >= 0; index -= 1) {
      const item = classifiedSegments[index];
      if (!item) continue;
      if (item.endMs <= windowStartMs) break;
      if (item.startMs >= anchorMs) continue;

      addTrackedSeconds(item, clippedOverlapSeconds(item, windowStartMs, anchorMs));
      if (trackedSeconds >= activeTargetSeconds) break;
    }
  } else {
    const windowEndMs = anchorMs + maxWindowMs;
    for (const item of classifiedSegments) {
      if (item.startMs >= windowEndMs) break;
      if (item.endMs <= anchorMs) continue;

      addTrackedSeconds(item, clippedOverlapSeconds(item, anchorMs, windowEndMs));
      if (trackedSeconds >= activeTargetSeconds) break;
    }
  }

  return {
    trackedSeconds,
    strongFocusSeconds,
    driftSeconds,
    strongFocus: trackedSeconds >= MINIMUM_CONTEXT_WINDOW_TRACKED_SECONDS && strongFocusSeconds / trackedSeconds >= CONTEXT_WINDOW_STRONG_SHARE,
    driftDominated: trackedSeconds >= MINIMUM_CONTEXT_WINDOW_TRACKED_SECONDS && driftSeconds / trackedSeconds >= CONTEXT_WINDOW_STRONG_SHARE,
  };
}

function clippedOverlapSeconds(item: ClassifiedSegment, windowStartMs: number, windowEndMs: number): number {
  const overlapStartMs = Math.max(item.startMs, windowStartMs);
  const overlapEndMs = Math.min(item.endMs, windowEndMs);
  return activitySecondsWithinInterval(item.segment, overlapStartMs, overlapEndMs);
}

function contextualProductivity(
  item: ClassifiedSegment,
  productivities: ReadonlyMap<string, EffectiveProductivityResolution>,
): ProductivityLabel {
  return productivities.get(item.segment.id)?.productivity ?? defaultEffectiveProductivityForClassification(item.classification).productivity;
}

function utilityProductivity(
  item: ClassifiedSegment,
  classifiedSegments: readonly ClassifiedSegment[],
  productivities: ReadonlyMap<string, EffectiveProductivityResolution>,
): ProductivityLabel {
  const durationSeconds = Math.round((item.endMs - item.startMs) / 1000);
  if (durationSeconds > UTILITY_CONTEXTUAL_SECONDS) return "neutral";

  const before = contextWindowStats(classifiedSegments, productivities, item.startMs, "before");
  const after = contextWindowStats(classifiedSegments, productivities, item.endMs, "after");
  if (before.strongFocus && after.strongFocus) return "focus";
  if (before.driftDominated && after.driftDominated) return "drift";
  return "neutral";
}

type ClassificationMode = "single-purpose" | "multipurpose";

interface ClassificationRegistryEntry {
  id: string;
  mode: ClassificationMode;
  category?: ActivityCategory;
  productivity?: ProductivityLabel;
  confidence: number;
  appNames?: string[];
  bundleIds?: string[];
  domains?: string[];
}

const KNOWN_BROWSER_APP_NAMES = ["safari", "google chrome", "arc", "brave browser", "chromium", "microsoft edge", "firefox", "comet"];
const KNOWN_BROWSER_BUNDLE_IDS = [
  "com.apple.safari",
  "com.google.chrome",
  "company.thebrowser.browser",
  "com.brave.browser",
  "org.chromium.chromium",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "ai.perplexity.comet",
];

const APP_CLASSIFICATIONS: ClassificationRegistryEntry[] = [
  { id: "visual-studio-code", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.9, appNames: ["code", "visual studio code"], bundleIds: ["com.microsoft.vscode"] },
  { id: "cursor", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, appNames: ["cursor"] },
  { id: "xcode", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.9, appNames: ["xcode"], bundleIds: ["com.apple.dt.xcode"] },
  { id: "jetbrains-ides", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, appNames: ["intellij idea", "pycharm", "webstorm", "clion", "goland", "rider", "datagrip", "rubymine", "phpstorm"] },
  { id: "cmux", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, appNames: ["cmux"], bundleIds: ["dev.cmux", "com.cmuxterm.app"] },
  { id: "terminal", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, appNames: ["terminal", "iterm2", "warp"], bundleIds: ["com.apple.terminal", "com.googlecode.iterm2", "dev.warp.warp-stable"] },
  { id: "docker-desktop", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, appNames: ["docker desktop", "docker"] },
  { id: "postman", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, appNames: ["postman"] },
  { id: "figma", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.8, appNames: ["figma"] },
  { id: "microsoft-office", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, appNames: ["microsoft powerpoint", "microsoft word", "microsoft excel"], bundleIds: ["com.microsoft.powerpoint", "com.microsoft.word", "com.microsoft.excel"] },
  { id: "linear", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.8, appNames: ["linear"], bundleIds: ["com.linear"] },
  { id: "claude-desktop", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.7, appNames: ["claude"], bundleIds: ["com.anthropic.claudefordesktop"] },
  { id: "codex-desktop", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.8, appNames: ["codex"], bundleIds: ["com.openai.codex"] },
  { id: "apple-developer-app", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.8, appNames: ["developer"], bundleIds: ["developer.apple.wwdc-release"] },
  { id: "slack", mode: "single-purpose", category: "communication", productivity: "focus", confidence: 0.9, appNames: ["slack"], bundleIds: ["com.tinyspeck.slackmacgap"] },
  { id: "zoom", mode: "single-purpose", category: "communication", productivity: "focus", confidence: 0.9, appNames: ["zoom", "zoom.us"], bundleIds: ["us.zoom.xos"] },
  { id: "microsoft-teams", mode: "single-purpose", category: "communication", productivity: "focus", confidence: 0.9, appNames: ["microsoft teams", "teams"], bundleIds: ["com.microsoft.teams", "com.microsoft.teams2"] },
  { id: "mail", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.85, appNames: ["mail", "messages", "telegram", "whatsapp", "kakaotalk"], bundleIds: ["com.apple.mail", "com.apple.messages", "org.telegram.desktop"] },
  { id: "spotify", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.95, appNames: ["spotify"], bundleIds: ["com.spotify.client"] },
  { id: "apple-music", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.95, appNames: ["music", "apple music"], bundleIds: ["com.apple.music"] },
  { id: "league-of-legends", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.95, appNames: ["league of legends", "riot client"], bundleIds: ["com.riotgames.leagueoflegends", "com.riotgames.riotclient"] },
  { id: "steam", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.95, appNames: ["steam"], bundleIds: ["com.valvesoftware.steam"] },
  { id: "minecraft", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.95, appNames: ["minecraft"] },
  { id: "roblox", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.95, appNames: ["roblox"] },
  { id: "battle-net", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.95, appNames: ["battle.net", "battle net"], bundleIds: ["com.blizzard.battle.net"] },
  { id: "epic-games", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.9, appNames: ["epic games launcher", "epic games"] },
  { id: "gog-galaxy", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.9, appNames: ["gog galaxy"] },
  { id: "valorant", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.9, appNames: ["valorant"] },
  { id: "finder", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.9, appNames: ["finder"], bundleIds: ["com.apple.finder"] },
  { id: "system-settings", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.9, appNames: ["settings", "system settings"], bundleIds: ["com.apple.systempreferences", "com.apple.systemsettings"] },
  { id: "one-password", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.9, appNames: ["1password"], bundleIds: ["com.1password.1password"] },
  { id: "preview-calculator", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.85, appNames: ["preview", "calculator"], bundleIds: ["com.apple.preview", "com.apple.calculator"] },
  { id: "apple-system-utilities", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.85, appNames: ["keychain access", "certificate assistant", "activity monitor"], bundleIds: ["com.apple.keychainaccess", "com.apple.certificateassistant", "com.apple.activitymonitor"] },
  { id: "drifty", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.7, appNames: ["drifty", "dtime"], bundleIds: ["so.drifty.mac"] },
  { id: "rize", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.8, appNames: ["rize"], bundleIds: ["io.rize"] },
  { id: "notion", mode: "multipurpose", confidence: 0.55, appNames: ["notion"], bundleIds: ["notion.id"] },
  { id: "discord", mode: "multipurpose", confidence: 0.55, appNames: ["discord"], bundleIds: ["com.hnc.discord"] },
  { id: "obsidian", mode: "multipurpose", confidence: 0.55, appNames: ["obsidian"], bundleIds: ["md.obsidian"] },
];

const DOMAIN_CLASSIFICATIONS: ClassificationRegistryEntry[] = [
  { id: "slack", mode: "single-purpose", category: "communication", productivity: "focus", confidence: 0.9, domains: ["slack.com"] },
  { id: "gmail", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.85, domains: ["mail.google.com", "gmail.com"] },
  { id: "zoom", mode: "single-purpose", category: "communication", productivity: "focus", confidence: 0.9, domains: ["zoom.us"] },
  { id: "microsoft-teams", mode: "single-purpose", category: "communication", productivity: "focus", confidence: 0.85, domains: ["teams.microsoft.com"] },
  { id: "whatsapp", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.85, domains: ["whatsapp.com", "web.whatsapp.com"] },
  { id: "google-meet", mode: "single-purpose", category: "communication", productivity: "focus", confidence: 0.9, domains: ["meet.google.com"] },
  { id: "google-calendar", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.85, domains: ["calendar.google.com"] },
  { id: "spotify", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.95, domains: ["spotify.com", "open.spotify.com"] },
  { id: "soundcloud", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.9, domains: ["soundcloud.com"] },
  { id: "apple-music", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.9, domains: ["music.apple.com"] },
  { id: "netflix", mode: "single-purpose", category: "entertainment", productivity: "drift", confidence: 0.95, domains: ["netflix.com"] },
  { id: "twitch", mode: "single-purpose", category: "entertainment", productivity: "drift", confidence: 0.9, domains: ["twitch.tv"] },
  { id: "disney-hulu", mode: "single-purpose", category: "entertainment", productivity: "drift", confidence: 0.9, domains: ["disneyplus.com", "hulu.com", "primevideo.com"] },
  /* Social hosts are multipurpose: `classifySocialActivity` splits feed from
     DMs and profiles by URL path, so the host alone never decides drift. */
  { id: "instagram", mode: "multipurpose", confidence: 0.55, domains: ["instagram.com"] },
  { id: "facebook", mode: "multipurpose", confidence: 0.55, domains: ["facebook.com"] },
  { id: "tiktok", mode: "multipurpose", confidence: 0.55, domains: ["tiktok.com"] },
  { id: "twitter-x", mode: "multipurpose", confidence: 0.55, domains: ["x.com", "twitter.com"] },
  { id: "amazon", mode: "single-purpose", category: "shopping", productivity: "drift", confidence: 0.9, domains: ["amazon.com", "amazon.co.kr"] },
  { id: "coupang", mode: "single-purpose", category: "shopping", productivity: "drift", confidence: 0.9, domains: ["coupang.com"] },
  { id: "ebay", mode: "single-purpose", category: "shopping", productivity: "drift", confidence: 0.9, domains: ["ebay.com"] },
  { id: "aliexpress", mode: "single-purpose", category: "shopping", productivity: "drift", confidence: 0.9, domains: ["aliexpress.com"] },
  { id: "korean-shopping", mode: "single-purpose", category: "shopping", productivity: "drift", confidence: 0.85, domains: ["gmarket.co.kr", "11st.co.kr", "musinsa.com"] },
  { id: "mdn", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.9, domains: ["developer.mozilla.org"] },
  { id: "coursera-udemy", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.9, domains: ["coursera.org", "udemy.com", "khanacademy.org", "edx.org"] },
  { id: "developer-docs", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.85, domains: ["react.dev", "typescriptlang.org", "docs.python.org", "nodejs.org"] },
  { id: "reference-learning", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.85, domains: ["wikipedia.org", "arxiv.org"] },
  { id: "stack-overflow", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.85, domains: ["stackoverflow.com", "stackexchange.com"] },
  { id: "gitlab-bitbucket", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, domains: ["gitlab.com", "bitbucket.org"] },
  { id: "developer-tools", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, domains: ["code.visualstudio.com", "jetbrains.com", "docker.com", "docs.docker.com", "postman.com"] },
  { id: "ai-dev-tools", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.8, domains: ["copilot.github.com", "platform.kimi.ai", "platform.deepseek.com", "cursor.com"] },
  { id: "local-dev", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.7, domains: ["localhost", "127.0.0.1", "0.0.0.0"] },
  { id: "supabase", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.85, domains: ["supabase.com"] },
  { id: "polar", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.8, domains: ["polar.sh"] },
  { id: "openrouter", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.8, domains: ["openrouter.ai"] },
  { id: "google-search-console", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.8, domains: ["search.google.com"] },
  { id: "apple-developer", mode: "single-purpose", category: "workspace", productivity: "focus", confidence: 0.75, domains: ["developer.apple.com"] },
  { id: "drifty-site", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.7, domains: ["drifty.so"] },
  { id: "google-accounts", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.7, domains: ["accounts.google.com"] },
  { id: "maps", mode: "single-purpose", category: "utility", productivity: "neutral", confidence: 0.85, domains: ["map.naver.com", "maps.google.com"] },
  { id: "chess", mode: "single-purpose", category: "game", productivity: "drift", confidence: 0.9, domains: ["lichess.org", "chess.com"] },
  { id: "linkedin", mode: "single-purpose", category: "social_media", productivity: "neutral", confidence: 0.7, domains: ["linkedin.com"] },
  { id: "ai-learning", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.75, domains: ["phind.com"] },
  { id: "ai-assistants", mode: "multipurpose", confidence: 0.55, domains: ["claude.ai", "claude.com", "chatgpt.com", "gemini.google.com", "perplexity.ai", "poe.com", "kimi.com", "chat.mistral.ai", "chat.deepseek.com", "grok.com", "huggingface.co"] },
  { id: "work-management", mode: "multipurpose", confidence: 0.6, domains: ["linear.app", "atlassian.net", "jira.com", "figma.com"] },
  { id: "github", mode: "multipurpose", confidence: 0.55, domains: ["github.com"] },
  { id: "notion", mode: "multipurpose", confidence: 0.55, domains: ["notion.so", "notion.site"] },
  { id: "google-docs", mode: "multipurpose", confidence: 0.55, domains: ["docs.google.com"] },
  { id: "reddit", mode: "multipurpose", confidence: 0.55, domains: ["reddit.com"] },
  { id: "discord", mode: "multipurpose", confidence: 0.55, domains: ["discord.com"] },
];

function classifyBrowserActivity(segment: ActivitySegment): ActivityClassificationDetail {
  const youtubeClassification = classifyYouTubeActivity(segment);
  if (youtubeClassification) {
    return detail(youtubeClassification, "browser", "youtube", 0.95, "Matched YouTube-specific metadata and URL rules");
  }

  const socialClassification = classifySocialActivity(segment);
  if (socialClassification && socialClassification.category !== "unknown") {
    return detail(socialClassification, "browser", "domain-db", 0.9, "Matched social consumption surface by URL path");
  }
  if (socialClassification) {
    return unknownDetail("browser", "Social surface needs AI classification");
  }

  const domainEntry = findDomainClassification(segment.siteDomain);
  if (isResolvedEntry(domainEntry)) {
    return detail(domainEntry, "browser", "domain-db", domainEntry.confidence, `Matched domain registry entry: ${domainEntry.id}`);
  }

  const windowTitleClassification = classifyYouTubeWindowTitle(segment);
  if (windowTitleClassification) {
    return detail(windowTitleClassification, "browser", "youtube", 0.7, "Matched YouTube window title without tab metadata");
  }

  return unknownDetail("browser", domainEntry ? `Multipurpose domain needs AI classification: ${domainEntry.id}` : "No domain registry match");
}

function classifyAppActivity(segment: ActivitySegment): ActivityClassificationDetail {
  const appEntry = findAppClassification(segment);
  if (isResolvedEntry(appEntry)) {
    return detail(appEntry, "app", "app-db", appEntry.confidence, `Matched app registry entry: ${appEntry.id}`);
  }

  return unknownDetail("app", appEntry ? `Multipurpose app needs AI classification: ${appEntry.id}` : "No app registry match");
}

export function isBrowserActivity(
  segment: Pick<ActivitySegment, "appName" | "bundleId" | "siteDomain" | "browserName">,
): boolean {
  const app = normalizeText(segment.appName);
  const bundle = normalizeText(segment.bundleId);
  return Boolean(segment.siteDomain || segment.browserName || KNOWN_BROWSER_APP_NAMES.includes(app) || KNOWN_BROWSER_BUNDLE_IDS.includes(bundle));
}

function findDomainClassification(siteDomain?: string | null): ClassificationRegistryEntry | null {
  const domain = normalizeDomain(siteDomain);
  if (!domain) return null;
  return DOMAIN_CLASSIFICATIONS.find((entry) => (entry.domains ?? []).some((candidate) => domainMatches(domain, candidate))) ?? null;
}

function findAppClassification(segment: ActivitySegment): ClassificationRegistryEntry | null {
  const app = normalizeText(segment.appName);
  const bundle = normalizeText(segment.bundleId);
  return APP_CLASSIFICATIONS.find((entry) => {
    const bundleMatch = bundle && (entry.bundleIds ?? []).some((candidate) => normalizeText(candidate) === bundle);
    const appMatch = app && (entry.appNames ?? []).some((candidate) => normalizeText(candidate) === app);
    return Boolean(bundleMatch || appMatch);
  }) ?? null;
}

function isResolvedEntry(entry: ClassificationRegistryEntry | null): entry is ClassificationRegistryEntry & Required<Pick<ClassificationRegistryEntry, "category" | "productivity">> {
  return Boolean(entry && entry.mode === "single-purpose" && entry.category && entry.productivity);
}

function normalizeText(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeDomain(value?: string | null): string {
  return normalizeText(value).replace(/^www\./, "");
}

function domainMatches(domain: string, candidate: string): boolean {
  const normalizedCandidate = normalizeDomain(candidate);
  return domain === normalizedCandidate || domain.endsWith(`.${normalizedCandidate}`);
}

function detail(
  classification: ActivityClassification,
  surface: ClassificationSurface,
  source: ClassificationSource,
  confidence: number,
  reason: string,
  extras?: Pick<ActivityClassificationDetail, "aiCached">,
): ActivityClassificationDetail {
  return { category: classification.category, productivity: classification.productivity, surface, source, confidence, reason, ...extras };
}

function unknownDetail(surface: ClassificationSurface, reason: string): ActivityClassificationDetail {
  return detail({ category: "unknown", productivity: "neutral" }, surface, "unknown", 0, reason);
}

export function normalizeStartOfDayMinutes(minutes = 0): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minutes)));
}

export function logicalDayStartMs(day: string, startOfDayMinutes = 0): number {
  const [year, month, date] = day.split("-").map(Number);
  const start = new Date(year, month - 1, date, 0, normalizeStartOfDayMinutes(startOfDayMinutes), 0, 0);
  return start.getTime();
}

export function logicalDayEndExclusiveMs(day: string, startOfDayMinutes = 0): number {
  const [year, month, date] = day.split("-").map(Number);
  // Rebuild the configured local clock boundary. A skipped hour can normalize
  // today's start forward; carrying that normalized hour would extend tomorrow.
  return new Date(year, month - 1, date + 1, 0, normalizeStartOfDayMinutes(startOfDayMinutes), 0, 0).getTime();
}

export function logicalDayIsoDateForDate(date: Date, startOfDayMinutes = 0): string {
  const day = isoDateForLocalDate(date);
  // A logical day starts at a local clock time, not an elapsed-hour offset.
  // Subtracting hours assigns the wrong date around timezone offset changes.
  if (date.getTime() >= logicalDayStartMs(day, startOfDayMinutes)) return day;
  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);
  return isoDateForLocalDate(previousDate);
}

export function logicalMinuteOfDay(minuteOfDay: number, startOfDayMinutes = 0): number {
  return ((minuteOfDay - normalizeStartOfDayMinutes(startOfDayMinutes)) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function isoDateForLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
