import type {
  ActivityCategory,
  ActivityClassification,
  ActivitySegment,
  ClassificationOptions,
  FlowIntervalMinutes,
  FlowBlock,
  HourBucket,
  HourlyBucket,
  ProductivityLabel,
  SiteDuration,
} from "./activity";

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
    classificationReason?: string | null;
  }>;
}

export interface CategoryHourCell {
  hour: number;
  totalSeconds: number;
  ratio: number;
}

export interface CategoryHourRow {
  category: ActivityCategory;
  totalSeconds: number;
  cells: CategoryHourCell[];
}

export interface CategoryHourMatrix {
  rows: CategoryHourRow[];
  peakSeconds: number;
}

export type ClassificationSurface = "browser" | "app";
export type ClassificationSource = "youtube" | "domain-db" | "app-db" | "context" | "fallback" | "llm" | "manual" | "rule" | "stored" | "unknown";

export interface ActivityClassificationDetail extends ActivityClassification {
  surface: ClassificationSurface;
  source: ClassificationSource;
  confidence: number;
  reason: string;
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
  axes: ProductivityPersonaAxis[];
  metrics: ProductivityPersonaMetrics;
}

export function totalDurationSeconds(segments: ActivitySegment[]): number {
  return segments.reduce((total, segment) => total + segment.durationSeconds, 0);
}

export function groupSegmentsByApp(segments: ActivitySegment[]): AppDuration[] {
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

export function buildAppUsageSummaries(
  segments: ActivitySegment[],
  options: { limit?: number; groupBy?: "app" | "activity" } = {},
): AppUsageSummary[] {
  const groupBy = options.groupBy ?? "activity";
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
    const siteDomain = groupBy === "activity" ? normalizedSiteDomain(segment) : null;
    const siteTitle = groupBy === "activity" ? normalizedSiteTitle(segment) : null;
    const siteLabel = siteDomain ?? siteTitle;
    const groupKey = siteLabel ? `site:${siteLabel.toLowerCase()}` : `app:${segment.appName}`;
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

    let cursor = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();

    while (cursor < end) {
      const current = new Date(cursor);
      const dayKey = logicalDayIsoDateForDate(current);
      existing.activeDays.add(dayKey);
      cursor = Math.min(end, logicalDayEndExclusiveMs(dayKey));
    }

    totals.set(groupKey, existing);
  }

  const totalSeconds = totalDurationSeconds(segments);
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

export function mergeAdjacentSegments(segments: ActivitySegment[]): ActivitySegment[] {
  if (segments.length === 0) return [];

  const sorted = segments.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const merged: ActivitySegment[] = [{ ...sorted[0] }];

  for (const segment of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    const canMerge =
      last.appName === segment.appName &&
      (last.windowTitle ?? null) === (segment.windowTitle ?? null) &&
      last.endedAt === segment.startedAt;

    if (!canMerge) {
      merged.push({ ...segment });
      continue;
    }

    last.endedAt = segment.endedAt;
    last.durationSeconds += segment.durationSeconds;
  }

  return merged;
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

export function buildFlowBlocks(segments: ActivitySegment[], day: string, intervalMinutes: FlowIntervalMinutes = 5, options?: ClassificationOptions, startOfDayMinutes = 0): FlowBlock[] {
  const candidates = new Map<string, FlowBlockCandidate>();
  const intervalMs = intervalMinutes * 60 * 1000;
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);

  for (const segment of segments) {
    const start = new Date(segment.startedAt);
    const end = new Date(segment.endedAt);
    let cursor = new Date(start);
    const classification = classifyActivityDetailed(segment, options);

    while (cursor < end) {
      const blockStart = new Date(cursor);
      const bucketMinute = Math.floor(cursor.getMinutes() / intervalMinutes) * intervalMinutes;
      blockStart.setMinutes(bucketMinute, 0, 0);
      const blockEnd = new Date(blockStart.getTime() + intervalMs);

      if (logicalDayIsoDateForDate(blockStart, boundaryMinutes) !== day) {
        cursor = blockEnd;
        continue;
      }

      const hour = blockStart.getHours();
      const minuteOfDay = hour * 60 + bucketMinute;
      const quarter = Math.floor(bucketMinute / 15);
      const colorKey = segment.siteDomain || segment.appName;
      const key = `${day}-${minuteOfDay}-${colorKey}`;
      const existing = candidates.get(key);
      const overlapSeconds = Math.max(
        0,
        Math.round((Math.min(end.getTime(), blockEnd.getTime()) - Math.max(start.getTime(), blockStart.getTime())) / 1000),
      );

      if (overlapSeconds <= 0) {
        cursor = blockEnd;
        continue;
      }

      if (!existing) {
        candidates.set(key, {
          block: {
            id: `${day}-${minuteOfDay}`,
            day,
            hour,
            quarter,
            minuteOfDay,
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
            productivity: classification.productivity,
            classificationSource: classification.source,
            aiClassification: classification.source === "llm",
            classificationReason: classification.reason,
            colorKey,
            durationSeconds: overlapSeconds,
          },
          strongestOverlapSeconds: overlapSeconds,
        });
      } else {
        existing.block.durationSeconds += overlapSeconds;
        if (existing.strongestOverlapSeconds < overlapSeconds) {
          existing.block = {
            ...existing.block,
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
            productivity: classification.productivity,
            classificationSource: classification.source,
            aiClassification: classification.source === "llm",
            classificationReason: classification.reason,
            colorKey,
            durationSeconds: existing.block.durationSeconds,
          };
          existing.strongestOverlapSeconds = overlapSeconds;
        }
      }

      cursor = blockEnd;
    }
  }

  const blocks = new Map<string, FlowBlock>();
  for (const candidate of candidates.values()) {
    const key = `${candidate.block.day}-${candidate.block.minuteOfDay}`;
    const existing = blocks.get(key);
    if (!existing || existing.durationSeconds < candidate.block.durationSeconds) {
      blocks.set(key, candidate.block);
    }
  }

  return Array.from(blocks.values()).sort((left, right) => logicalMinuteOfDay(left.minuteOfDay, boundaryMinutes) - logicalMinuteOfDay(right.minuteOfDay, boundaryMinutes));
}

export function buildDailyTotals(segments: ActivitySegment[], startDay: string, endDay: string, startOfDayMinutes = 0): DailyTotal[] {
  const totals = new Map<string, number>();
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);

  for (const segment of segments) {
    let cursor = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();

    while (cursor < end) {
      const current = new Date(cursor);
      const dayKey = logicalDayIsoDateForDate(current, boundaryMinutes);
      const overlapEnd = Math.min(end, logicalDayEndExclusiveMs(dayKey, boundaryMinutes));
      const overlapSeconds = Math.max(0, Math.round((overlapEnd - cursor) / 1000));

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
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const windowStart = logicalDayStartMs(startDay, boundaryMinutes);
  const windowEnd = logicalDayEndExclusiveMs(endDay, boundaryMinutes);

  if (windowEnd <= windowStart) return 0;

  let totalSeconds = 0;

  for (const segment of segments) {
    const { productivity } = classifyActivity(segment, options);
    if (productivity !== "focus") continue;

    const segmentStart = new Date(segment.startedAt).getTime();
    const segmentEnd = new Date(segment.endedAt).getTime();
    const clippedStart = Math.max(segmentStart, windowStart);
    const clippedEnd = Math.min(segmentEnd, windowEnd);

    if (clippedEnd <= clippedStart) continue;

    totalSeconds += Math.round((clippedEnd - clippedStart) / 1000);
  }

  return totalSeconds;
}

export function classifyActivity(segment: ActivitySegment, options?: ClassificationOptions): ActivityClassification {
  const { category, productivity } = classifyActivityDetailed(segment, options);
  return { category, productivity };
}

export function classifyActivityDetailed(segment: ActivitySegment, options?: ClassificationOptions): ActivityClassificationDetail {
  const stored = segment.classification;
  if (stored && (stored.aiResult !== true || options?.includeAiClassifications !== false)) {
    const source: ClassificationSource = stored.source === "llm" || stored.source === "manual" || stored.source === "rule" ? stored.source : "stored";
    return detail(
      { category: stored.category, productivity: stored.productivity },
      isBrowserActivity(segment) ? "browser" : "app",
      source,
      stored.confidence,
      stored.reason ?? "Stored activity classification",
    );
  }

  return isBrowserActivity(segment) ? classifyBrowserActivity(segment) : classifyAppActivity(segment);
}

export function categorizeActivity(segment: ActivitySegment, options?: ClassificationOptions): ProductivityLabel {
  return classifyActivity(segment, options).productivity;
}

export function buildCategoryDurations(segments: ActivitySegment[], options?: ClassificationOptions): CategoryDuration[] {
  const totals = CATEGORY_ORDER.map((category) => ({
    category,
    totalSeconds: 0,
    segments: 0,
    ratio: 0,
  }));
  const totalSeconds = totalDurationSeconds(segments);

  for (const segment of segments) {
    const { category } = classifyActivity(segment, options);
    const target = totals.find((entry) => entry.category === category);
    if (!target) continue;
    target.totalSeconds += segment.durationSeconds;
    target.segments += 1;
  }

  return totals.map((entry) => ({
    ...entry,
    ratio: totalSeconds > 0 ? entry.totalSeconds / totalSeconds : 0,
  }));
}

export function buildProductivityDurations(segments: ActivitySegment[], options?: ClassificationOptions): ProductivityDuration[] {
  const totals = PRODUCTIVITY_ORDER.map((productivity) => ({
    productivity,
    totalSeconds: 0,
    segments: 0,
    ratio: 0,
  }));
  const totalSeconds = totalDurationSeconds(segments);

  for (const segment of segments) {
    const { productivity } = classifyActivity(segment, options);
    const target = totals.find((entry) => entry.productivity === productivity);
    if (!target) continue;
    target.totalSeconds += segment.durationSeconds;
    target.segments += 1;
  }

  return totals.map((entry) => ({
    ...entry,
    ratio: totalSeconds > 0 ? entry.totalSeconds / totalSeconds : 0,
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
      previous.activities.push(segment.activity);
      continue;
    }

    merged.push({
      id: `${segment.category}-${segment.startMinute}-${segment.endMinute}`,
      category: segment.category,
      productivity: segment.productivity,
      classificationSource: segment.classificationSource,
      aiClassification: segment.aiClassification,
      classificationReason: segment.classificationReason,
      startMinute: segment.startMinute,
      endMinute: segment.endMinute,
      totalSeconds: Math.max((segment.endMinute - segment.startMinute) * 60, 60),
      activities: [segment.activity],
    });
  }

  return merged;
}

export function buildCategoryHourMatrix(segments: ActivitySegment[], options?: ClassificationOptions): CategoryHourMatrix {
  const categoryHours = new Map<ActivityCategory, number[]>(
    CATEGORY_ORDER.map((category) => [category, Array.from({ length: 24 }, () => 0)]),
  );

  for (const segment of segments) {
    const { category } = classifyActivity(segment, options);
    let cursor = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();

    while (cursor < end) {
      const current = new Date(cursor);
      const hourStart = new Date(current.getFullYear(), current.getMonth(), current.getDate(), current.getHours(), 0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourEnd.getHours() + 1);
      const overlapEnd = Math.min(end, hourEnd.getTime());
      const overlapSeconds = Math.max(0, Math.round((overlapEnd - cursor) / 1000));

      if (overlapSeconds > 0) {
        const target = categoryHours.get(category);
        if (target) target[current.getHours()] += overlapSeconds;
      }

      cursor = overlapEnd;
    }
  }

  const peakSeconds = Math.max(
    1,
    ...Array.from(categoryHours.values()).flat(),
  );

  return {
    peakSeconds,
    rows: CATEGORY_ORDER.map((category) => {
      const hours = categoryHours.get(category) ?? Array.from({ length: 24 }, () => 0);
      const totalSeconds = hours.reduce((sum, value) => sum + value, 0);

      return {
        category,
        totalSeconds,
        cells: hours.map((total, hour) => ({
          hour,
          totalSeconds: total,
          ratio: total > 0 ? total / peakSeconds : 0,
        })),
      };
    }),
  };
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
  const orderedSegments = segments.slice().sort((left, right) => {
    const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
    if (startedAtOrder !== 0) return startedAtOrder;
    return left.id.localeCompare(right.id);
  });
  const metrics = buildProductivityPersonaMetrics(orderedSegments, options ?? {});
  const persona = resolveProductivityPersona(metrics);

  return {
    personaId: persona.id,
    personaName: persona.name,
    axes: buildProductivityPersonaAxes(metrics),
    metrics,
  };
}

function buildProductivityPersonaMetrics(segments: ActivitySegment[], options: ClassificationOptions): ProductivityPersonaMetrics {
  let focusSeconds = 0;
  let neutralSeconds = 0;
  let driftSeconds = 0;
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

    let cursor = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();
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
        nightSeconds += Math.round((overlapEnd - overlapStart) / 1000);
      }
      cursor = Math.min(end, logicalDayEndExclusiveMs(dayKey));
    }

    if (classification.productivity === "focus") {
      focusSeconds += durationSeconds;
      focusSegments += 1;
    } else if (classification.productivity === "drift") {
      driftSeconds += durationSeconds;
      driftSegments += 1;
    } else {
      neutralSeconds += durationSeconds;
    }

    if (classification.category === "communication") {
      communicationSeconds += durationSeconds;
    }
  }

  const totalSeconds = totalDurationSeconds(segments);
  const topSurfaceSeconds = Math.max(0, ...surfaceTotals.values());
  const totalHours = totalSeconds / 3600;

  return {
    totalSeconds,
    focusSeconds,
    focusShare: totalSeconds > 0 ? focusSeconds / totalSeconds : 0,
    neutralSeconds,
    neutralShare: totalSeconds > 0 ? neutralSeconds / totalSeconds : 0,
    driftSeconds,
    driftShare: totalSeconds > 0 ? driftSeconds / totalSeconds : 0,
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

function resolveProductivityPersona(metrics: ProductivityPersonaMetrics): { id: ProductivityPersonaId; name: ProductivityPersonaName } {
  if (metrics.nightShare >= 0.35) return PRODUCTIVITY_PERSONAS.night_owl;
  if (metrics.focusShare >= 0.35 && metrics.driftShare >= 0.3) return PRODUCTIVITY_PERSONAS.deep_focus_deep_drift;
  if (metrics.focusShare >= 0.65 && metrics.focusAverageSegmentSeconds >= 1500 && metrics.switchRatePerHour <= 6) {
    return PRODUCTIVITY_PERSONAS.deep_diver;
  }
  if (metrics.driftShare >= 0.5 && metrics.driftAverageSegmentSeconds >= 720) return PRODUCTIVITY_PERSONAS.drift_diver;
  if (metrics.focusShare >= 0.5 && metrics.focusAverageSegmentSeconds < 900) return PRODUCTIVITY_PERSONAS.focus_sprinter;
  if (metrics.reactiveShare >= 0.35) return PRODUCTIVITY_PERSONAS.reactive_operator;
  return PRODUCTIVITY_PERSONAS.balanced_builder;
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

const COMMUNICATION_HINTS = [
  "slack",
  "mail",
  "gmail",
  "calendar",
  "meet",
  "zoom",
  "teams",
  "discord",
  "messages",
  "inbox",
  "kakao",
  "telegram",
];

const LEARNING_HINTS = [
  "docs",
  "documentation",
  "developer",
  "mdn",
  "tutorial",
  "guide",
  "course",
  "academy",
  "learn",
  "reference",
  "readme",
  "coursera",
  "udemy",
];

const MUSIC_HINTS = [
  "spotify",
  "music",
  "soundcloud",
  "apple music",
];

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

const KNOWN_BROWSER_APP_NAMES = ["safari", "google chrome", "arc", "brave browser", "chromium", "microsoft edge", "firefox"];
const KNOWN_BROWSER_BUNDLE_IDS = [
  "com.apple.safari",
  "com.google.chrome",
  "company.thebrowser.browser",
  "com.brave.browser",
  "org.chromium.chromium",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
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
  { id: "slack", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.9, appNames: ["slack"], bundleIds: ["com.tinyspeck.slackmacgap"] },
  { id: "zoom", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.9, appNames: ["zoom", "zoom.us"], bundleIds: ["us.zoom.xos"] },
  { id: "microsoft-teams", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.9, appNames: ["microsoft teams", "teams"], bundleIds: ["com.microsoft.teams", "com.microsoft.teams2"] },
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
  { id: "notion", mode: "multipurpose", confidence: 0.55, appNames: ["notion"], bundleIds: ["notion.id"] },
  { id: "discord", mode: "multipurpose", confidence: 0.55, appNames: ["discord"], bundleIds: ["com.hnc.discord"] },
  { id: "obsidian", mode: "multipurpose", confidence: 0.55, appNames: ["obsidian"], bundleIds: ["md.obsidian"] },
];

const DOMAIN_CLASSIFICATIONS: ClassificationRegistryEntry[] = [
  { id: "slack", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.9, domains: ["slack.com"] },
  { id: "gmail", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.85, domains: ["mail.google.com", "gmail.com"] },
  { id: "zoom", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.9, domains: ["zoom.us"] },
  { id: "microsoft-teams", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.85, domains: ["teams.microsoft.com"] },
  { id: "whatsapp", mode: "single-purpose", category: "communication", productivity: "neutral", confidence: 0.85, domains: ["whatsapp.com", "web.whatsapp.com"] },
  { id: "spotify", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.95, domains: ["spotify.com", "open.spotify.com"] },
  { id: "soundcloud", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.9, domains: ["soundcloud.com"] },
  { id: "apple-music", mode: "single-purpose", category: "music", productivity: "neutral", confidence: 0.9, domains: ["music.apple.com"] },
  { id: "netflix", mode: "single-purpose", category: "entertainment", productivity: "drift", confidence: 0.95, domains: ["netflix.com"] },
  { id: "twitch", mode: "single-purpose", category: "entertainment", productivity: "drift", confidence: 0.9, domains: ["twitch.tv"] },
  { id: "disney-hulu", mode: "single-purpose", category: "entertainment", productivity: "drift", confidence: 0.9, domains: ["disneyplus.com", "hulu.com", "primevideo.com"] },
  { id: "instagram", mode: "single-purpose", category: "social_media", productivity: "drift", confidence: 0.9, domains: ["instagram.com"] },
  { id: "facebook", mode: "single-purpose", category: "social_media", productivity: "drift", confidence: 0.9, domains: ["facebook.com"] },
  { id: "tiktok", mode: "single-purpose", category: "social_media", productivity: "drift", confidence: 0.9, domains: ["tiktok.com"] },
  { id: "twitter-x", mode: "single-purpose", category: "social_media", productivity: "drift", confidence: 0.9, domains: ["x.com", "twitter.com"] },
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
  { id: "ai-learning", mode: "single-purpose", category: "learning", productivity: "focus", confidence: 0.75, domains: ["phind.com"] },
  { id: "ai-assistants", mode: "multipurpose", confidence: 0.55, domains: ["claude.ai", "claude.com", "chatgpt.com", "gemini.google.com", "perplexity.ai", "poe.com", "kimi.com", "chat.mistral.ai", "chat.deepseek.com", "grok.com", "huggingface.co"] },
  { id: "work-management", mode: "multipurpose", confidence: 0.6, domains: ["linear.app", "atlassian.net", "jira.com", "figma.com"] },
  { id: "github", mode: "multipurpose", confidence: 0.55, domains: ["github.com"] },
  { id: "notion", mode: "multipurpose", confidence: 0.55, domains: ["notion.so", "notion.site"] },
  { id: "google-docs", mode: "multipurpose", confidence: 0.55, domains: ["docs.google.com"] },
  { id: "reddit", mode: "multipurpose", confidence: 0.55, domains: ["reddit.com"] },
  { id: "discord", mode: "multipurpose", confidence: 0.55, domains: ["discord.com"] },
];

const YOUTUBE_MUSIC_PLAYLIST_PREFIXES = ["RD", "RDMM", "RDAMVM", "RDCLAK", "RDAMPL", "OLAK"];

const YOUTUBE_OFFICIAL_CATEGORY_CLASSIFICATIONS: Record<string, ActivityClassification> = {
  "autos & vehicles": { category: "entertainment", productivity: "drift" },
  comedy: { category: "entertainment", productivity: "drift" },
  education: { category: "learning", productivity: "focus" },
  entertainment: { category: "entertainment", productivity: "drift" },
  "film & animation": { category: "entertainment", productivity: "drift" },
  gaming: { category: "game", productivity: "drift" },
  "howto & style": { category: "learning", productivity: "focus" },
  "how-to & style": { category: "learning", productivity: "focus" },
  music: { category: "music", productivity: "neutral" },
  "news & politics": { category: "entertainment", productivity: "drift" },
  "nonprofits & activism": { category: "entertainment", productivity: "drift" },
  "people & blogs": { category: "entertainment", productivity: "drift" },
  "pets & animals": { category: "entertainment", productivity: "drift" },
  "science & technology": { category: "learning", productivity: "focus" },
  sports: { category: "entertainment", productivity: "drift" },
  "travel & events": { category: "entertainment", productivity: "drift" },
};

const GAME_HINTS = [
  "steam",
  "game",
  "games",
  "minecraft",
  "roblox",
  "riot",
  "battle.net",
];

const SOCIAL_HINTS = [
  "reddit",
  "twitter",
  "x.com",
  "instagram",
  "facebook",
  "tiktok",
  "social",
];

const ENTERTAINMENT_HINTS = [
  "youtube",
  "netflix",
  "twitch",
  "disney",
  "hulu",
  "news",
  "entertainment",
];

const SHOPPING_HINTS = [
  "amazon",
  "shopping",
  "shop",
  "store",
  "cart",
  "checkout",
  "coupang",
];

const UTILITY_HINTS = [
  "finder",
  "settings",
  "system settings",
  "1password",
  "password",
  "calendar",
  "preview",
  "calculator",
];

function classifyBrowserActivity(segment: ActivitySegment): ActivityClassificationDetail {
  const youtubeClassification = classifyYouTubeActivity(segment);
  if (youtubeClassification) {
    return detail(youtubeClassification, "browser", "youtube", 0.95, "Matched YouTube-specific metadata and URL rules");
  }

  const domainEntry = findDomainClassification(segment.siteDomain);
  if (isResolvedEntry(domainEntry)) {
    return detail(domainEntry, "browser", "domain-db", domainEntry.confidence, `Matched domain registry entry: ${domainEntry.id}`);
  }

  const contextClassification = classifyContext(browserContextText(segment));
  if (contextClassification) {
    const reason = domainEntry?.mode === "multipurpose"
      ? `Matched context hints for multipurpose domain: ${domainEntry.id}`
      : "Matched browser domain/title context hints";
    return detail(contextClassification, "browser", "context", 0.65, reason);
  }

  return unknownDetail("browser", domainEntry ? `Multipurpose domain had no context match: ${domainEntry.id}` : "No domain registry or context match");
}

function classifyAppActivity(segment: ActivitySegment): ActivityClassificationDetail {
  const appEntry = findAppClassification(segment);
  if (isResolvedEntry(appEntry)) {
    return detail(appEntry, "app", "app-db", appEntry.confidence, `Matched app registry entry: ${appEntry.id}`);
  }

  const contextClassification = classifyContext(appContextText(segment));
  if (contextClassification) {
    const reason = appEntry?.mode === "multipurpose"
      ? `Matched context hints for multipurpose app: ${appEntry.id}`
      : "Matched app/window context hints";
    return detail(contextClassification, "app", "context", 0.6, reason);
  }

  return unknownDetail("app", appEntry ? `Multipurpose app had no context match: ${appEntry.id}` : "No app registry or context match");
}

function isBrowserActivity(segment: ActivitySegment): boolean {
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

function classifyContext(text: string): ActivityClassification | null {
  if (matchesAny(text, COMMUNICATION_HINTS)) return { category: "communication", productivity: "neutral" };
  if (matchesAny(text, LEARNING_HINTS)) return { category: "learning", productivity: "focus" };
  if (matchesAny(text, MUSIC_HINTS)) return { category: "music", productivity: "neutral" };
  if (matchesAny(text, GAME_HINTS)) return { category: "game", productivity: "drift" };
  if (matchesAny(text, SOCIAL_HINTS)) return { category: "social_media", productivity: "drift" };
  if (matchesAny(text, SHOPPING_HINTS)) return { category: "shopping", productivity: "drift" };
  if (matchesAny(text, ENTERTAINMENT_HINTS)) return { category: "entertainment", productivity: "drift" };
  if (matchesAny(text, UTILITY_HINTS)) return { category: "utility", productivity: "neutral" };
  return null;
}

function browserContextText(segment: ActivitySegment): string {
  return joinContext(segment.siteDomain, segment.siteTitle, segment.siteUrl, segment.windowTitle);
}

function appContextText(segment: ActivitySegment): string {
  return joinContext(segment.appName, segment.bundleId, segment.windowTitle);
}

function joinContext(...values: Array<string | null | undefined>): string {
  return values.map((value) => normalizeText(value)).filter(Boolean).join(" ");
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

function matchesAny(value: string, hints: string[]) {
  return hints.some((hint) => value.includes(hint));
}

function detail(
  classification: ActivityClassification,
  surface: ClassificationSurface,
  source: ClassificationSource,
  confidence: number,
  reason: string,
): ActivityClassificationDetail {
  return { category: classification.category, productivity: classification.productivity, surface, source, confidence, reason };
}

function unknownDetail(surface: ClassificationSurface, reason: string): ActivityClassificationDetail {
  return detail({ category: "unknown", productivity: "neutral" }, surface, "unknown", 0, reason);
}

function classifyYouTubeActivity(segment: ActivitySegment): ActivityClassification | null {
  const site = (segment.siteDomain ?? "").toLowerCase();
  if (!isYouTubeSite(site)) return null;

  const playlistId = segment.youtubePlaylistId ?? playlistIdFromUrl(segment.siteUrl);
  const officialCategory = (segment.youtubeCategory ?? "").toLowerCase();

  if (segment.youtubeIsShorts) {
    return { category: "entertainment", productivity: "drift" };
  }

  if (site === "music.youtube.com") {
    return { category: "music", productivity: "neutral" };
  }

  if (playlistId && isYouTubeMusicPlaylist(playlistId)) {
    return { category: "music", productivity: "neutral" };
  }

  const categoryClassification = classifyYouTubeOfficialCategory(officialCategory);
  if (categoryClassification) return categoryClassification;

  if (isYouTubeNavigationPage(segment)) {
    return { category: "unknown", productivity: "neutral" };
  }

  return { category: "entertainment", productivity: "drift" };
}

function isYouTubeSite(site: string): boolean {
  return site === "youtube.com" || site === "m.youtube.com" || site === "music.youtube.com" || site === "youtu.be";
}

function playlistIdFromUrl(siteUrl?: string | null): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).searchParams.get("list");
  } catch {
    return null;
  }
}

function isYouTubeNavigationPage(segment: ActivitySegment): boolean {
  if (segment.youtubeVideoId) return false;
  const path = youtubePathFromUrl(segment.siteUrl);
  return path !== null && (path === "/" || path === "/results" || path === "/feed" || path.startsWith("/feed/"));
}

function youtubePathFromUrl(siteUrl?: string | null): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).pathname || "/";
  } catch {
    return null;
  }
}

function isYouTubeMusicPlaylist(playlistId: string): boolean {
  const normalized = playlistId.trim().toUpperCase();
  return YOUTUBE_MUSIC_PLAYLIST_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function classifyYouTubeOfficialCategory(category: string): ActivityClassification | null {
  return YOUTUBE_OFFICIAL_CATEGORY_CLASSIFICATIONS[normalizeYouTubeOfficialCategory(category)] ?? null;
}

function normalizeYouTubeOfficialCategory(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, " ");
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
  const end = new Date(logicalDayStartMs(day, startOfDayMinutes));
  end.setDate(end.getDate() + 1);
  return end.getTime();
}

export function logicalDayIsoDateForDate(date: Date, startOfDayMinutes = 0): string {
  const logicalDate = new Date(date.getTime() - normalizeStartOfDayMinutes(startOfDayMinutes) * 60 * 1000);
  return isoDateForLocalDate(logicalDate);
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
