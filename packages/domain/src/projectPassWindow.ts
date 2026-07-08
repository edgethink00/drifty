import type {
  ActivityCategory,
  ActivitySegment,
  FlowIntervalMinutes,
  ProductivityLabel,
  StoredClassificationSource,
} from "./activity";
import { logicalDayIsoDateForDate, normalizeStartOfDayMinutes } from "./aggregation";
import { formatRunDuration } from "./projectRun";

export const PROJECT_PASS_ANALYSIS_INTERVAL_MINUTES: FlowIntervalMinutes = 3;

export type ProjectPassWindowRange = {
  readonly start: string;
  readonly end: string;
};

export type ProjectPassAnalysisWindowOptions = {
  readonly intervalMinutes?: FlowIntervalMinutes;
  readonly startOfDayMinutes?: number;
  readonly range?: ProjectPassWindowRange;
  readonly includeTitleContext?: boolean;
};

export type ProjectPassWindowSegmentOverlap = {
  readonly segmentId: string;
  readonly durationSeconds: number;
};

export type ProjectPassWindowContributor = {
  readonly appName: string;
  readonly domain: string | null;
  readonly durationSeconds: number;
  readonly segmentIds: readonly string[];
  readonly context: string | null;
  readonly isShorts: boolean;
  readonly category: ActivityCategory | null;
  readonly productivity: ProductivityLabel | null;
  readonly source: StoredClassificationSource | null;
};

export type ProjectPassAnalysisWindow = {
  readonly id: string;
  readonly segmentIds: readonly string[];
  readonly correctionSegmentIds: readonly string[];
  readonly segmentOverlaps: readonly ProjectPassWindowSegmentOverlap[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly bucketCount: number;
  readonly appName: string;
  readonly domain: string | null;
  readonly contributors: readonly ProjectPassWindowContributor[];
  readonly isShorts: boolean;
  readonly category: ActivityCategory | null;
  readonly productivity: ProductivityLabel | null;
  readonly source: StoredClassificationSource | null;
};

type ClassificationSummary = {
  readonly category: ActivityCategory | null;
  readonly productivity: ProductivityLabel | null;
  readonly source: StoredClassificationSource | null;
};

type MutableClassificationSummary = ClassificationSummary & {
  durationSeconds: number;
};

type MutableContributor = {
  readonly key: string;
  readonly appName: string;
  readonly domain: string | null;
  durationSeconds: number;
  readonly segmentIds: Set<string>;
  context: string | null;
  isShorts: boolean;
  readonly classifications: Map<string, MutableClassificationSummary>;
};

type MutableBucket = {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly logicalDay: string;
  durationSeconds: number;
  readonly contributors: Map<string, MutableContributor>;
  readonly segmentOverlaps: Map<string, number>;
};

type MutableWindow = {
  startedAtMs: number;
  endedAtMs: number;
  durationSeconds: number;
  bucketCount: number;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly logicalDay: string;
  readonly dominantKey: string;
  readonly dominantClassificationKey: string;
  readonly contributors: Map<string, MutableContributor>;
  readonly segmentOverlaps: Map<string, number>;
};

function parsedMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function intervalStartMs(valueMs: number, intervalMinutes: FlowIntervalMinutes): number {
  const date = new Date(valueMs);
  const minute = Math.floor(date.getMinutes() / intervalMinutes) * intervalMinutes;
  date.setMinutes(minute, 0, 0);
  return date.getTime();
}

function normalizedDomain(segment: ActivitySegment): string | null {
  const domain = segment.siteDomain?.trim().toLowerCase();
  return domain ? domain : null;
}

function surfaceKey(segment: ActivitySegment): string {
  return `${segment.appName.trim().toLowerCase()}|${normalizedDomain(segment) ?? ""}`;
}

function classificationSummary(segment: ActivitySegment): ClassificationSummary {
  const classification = segment.classification ?? null;
  return {
    category: classification?.category ?? null,
    productivity: classification?.productivity ?? null,
    source: classification?.source ?? null,
  };
}

function classificationKey(summary: ClassificationSummary): string {
  return `${summary.category ?? ""}|${summary.productivity ?? ""}|${summary.source ?? ""}`;
}

function contributorContext(segment: ActivitySegment, includeTitleContext: boolean): string | null {
  if (!includeTitleContext) return null;
  const title = segment.siteTitle?.trim() || segment.youtubeTitle?.trim() || segment.windowTitle?.trim() || null;
  const channel = segment.youtubeChannelName?.trim() || null;
  if (title && channel) return `${title} · ${channel}`;
  return title ?? channel;
}

function addClassification(contributor: MutableContributor, summary: ClassificationSummary, durationSeconds: number): void {
  const key = classificationKey(summary);
  const existing = contributor.classifications.get(key);
  if (existing) {
    existing.durationSeconds += durationSeconds;
    return;
  }
  contributor.classifications.set(key, { ...summary, durationSeconds });
}

function mergeSeconds(map: Map<string, number>, key: string, seconds: number): void {
  map.set(key, (map.get(key) ?? 0) + seconds);
}

function mutableContributorFrom(segment: ActivitySegment, durationSeconds: number, includeTitleContext: boolean): MutableContributor {
  const contributor: MutableContributor = {
    key: surfaceKey(segment),
    appName: segment.appName,
    domain: normalizedDomain(segment),
    durationSeconds: 0,
    segmentIds: new Set<string>(),
    context: contributorContext(segment, includeTitleContext),
    isShorts: false,
    classifications: new Map<string, MutableClassificationSummary>(),
  };
  mergeContributor(contributor, segment, durationSeconds, includeTitleContext);
  return contributor;
}

function mergeContributor(contributor: MutableContributor, segment: ActivitySegment, durationSeconds: number, includeTitleContext: boolean): void {
  contributor.durationSeconds += durationSeconds;
  contributor.segmentIds.add(segment.id);
  contributor.isShorts = contributor.isShorts || segment.youtubeIsShorts === true;
  if (!contributor.context) contributor.context = contributorContext(segment, includeTitleContext);
  addClassification(contributor, classificationSummary(segment), durationSeconds);
}

function addContribution(bucket: MutableBucket, segment: ActivitySegment, durationSeconds: number, includeTitleContext: boolean): void {
  const key = surfaceKey(segment);
  const contributor = bucket.contributors.get(key);
  if (contributor) {
    mergeContributor(contributor, segment, durationSeconds, includeTitleContext);
  } else {
    bucket.contributors.set(key, mutableContributorFrom(segment, durationSeconds, includeTitleContext));
  }
  bucket.durationSeconds += durationSeconds;
  mergeSeconds(bucket.segmentOverlaps, segment.id, durationSeconds);
}

function dominantClassification(contributor: MutableContributor): ClassificationSummary {
  let dominant: MutableClassificationSummary | null = null;
  for (const summary of contributor.classifications.values()) {
    if (!dominant || summary.durationSeconds > dominant.durationSeconds) dominant = summary;
  }
  return {
    category: dominant?.category ?? null,
    productivity: dominant?.productivity ?? null,
    source: dominant?.source ?? null,
  };
}

function sortedContributors(contributors: Map<string, MutableContributor>): ProjectPassWindowContributor[] {
  return Array.from(contributors.values())
    .map((contributor) => {
      const summary = dominantClassification(contributor);
      return {
        appName: contributor.appName,
        domain: contributor.domain,
        durationSeconds: contributor.durationSeconds,
        segmentIds: Array.from(contributor.segmentIds),
        context: contributor.context,
        isShorts: contributor.isShorts,
        category: summary.category,
        productivity: summary.productivity,
        source: summary.source,
      };
    })
    .sort((left, right) => right.durationSeconds - left.durationSeconds || surfaceLabel(left).localeCompare(surfaceLabel(right)));
}

function bucketDominant(bucket: MutableBucket): MutableContributor | null {
  let dominant: MutableContributor | null = null;
  for (const contributor of bucket.contributors.values()) {
    if (!dominant || contributor.durationSeconds > dominant.durationSeconds) dominant = contributor;
  }
  return dominant;
}

function mergeMutableContributor(target: MutableContributor, source: MutableContributor): void {
  target.durationSeconds += source.durationSeconds;
  for (const segmentId of source.segmentIds) target.segmentIds.add(segmentId);
  target.isShorts = target.isShorts || source.isShorts;
  if (!target.context) target.context = source.context;
  for (const summary of source.classifications.values()) {
    addClassification(target, summary, summary.durationSeconds);
  }
}

function addBucketToWindow(window: MutableWindow, bucket: MutableBucket): void {
  window.endedAtMs = bucket.endedAtMs;
  window.durationSeconds += bucket.durationSeconds;
  window.bucketCount += 1;
  for (const contributor of bucket.contributors.values()) {
    const existing = window.contributors.get(contributor.key);
    if (existing) {
      mergeMutableContributor(existing, contributor);
    } else {
      window.contributors.set(contributor.key, {
        key: contributor.key,
        appName: contributor.appName,
        domain: contributor.domain,
        durationSeconds: contributor.durationSeconds,
        segmentIds: new Set(contributor.segmentIds),
        context: contributor.context,
        isShorts: contributor.isShorts,
        classifications: new Map(contributor.classifications),
      });
    }
  }
  for (const [segmentId, seconds] of bucket.segmentOverlaps) mergeSeconds(window.segmentOverlaps, segmentId, seconds);
}

function startWindow(bucket: MutableBucket, dominant: MutableContributor, intervalMinutes: FlowIntervalMinutes): MutableWindow {
  const summary = dominantClassification(dominant);
  const window: MutableWindow = {
    startedAtMs: bucket.startedAtMs,
    endedAtMs: bucket.startedAtMs,
    durationSeconds: 0,
    bucketCount: 0,
    intervalMinutes,
    logicalDay: bucket.logicalDay,
    dominantKey: dominant.key,
    dominantClassificationKey: classificationKey(summary),
    contributors: new Map<string, MutableContributor>(),
    segmentOverlaps: new Map<string, number>(),
  };
  addBucketToWindow(window, bucket);
  return window;
}

function canMergeWindow(window: MutableWindow, bucket: MutableBucket, dominant: MutableContributor): boolean {
  return window.endedAtMs === bucket.startedAtMs
    && window.logicalDay === bucket.logicalDay
    && window.dominantKey === dominant.key
    && window.dominantClassificationKey === classificationKey(dominantClassification(dominant));
}

function surfaceLabel(contributor: Pick<ProjectPassWindowContributor, "appName" | "domain">): string {
  return contributor.domain ? `${contributor.appName} · ${contributor.domain}` : contributor.appName;
}

function finalizeWindow(window: MutableWindow, index: number): ProjectPassAnalysisWindow | null {
  const contributors = sortedContributors(window.contributors);
  const dominant = contributors[0];
  if (!dominant) return null;
  const segmentIds = Array.from(window.segmentOverlaps.keys());
  const dominantSegmentIds = new Set(dominant.segmentIds);
  return {
    id: `w${index}`,
    segmentIds,
    correctionSegmentIds: segmentIds.filter((segmentId) => dominantSegmentIds.has(segmentId)),
    segmentOverlaps: Array.from(window.segmentOverlaps.entries()).map(([segmentId, durationSeconds]) => ({ segmentId, durationSeconds })),
    startedAt: new Date(window.startedAtMs).toISOString(),
    endedAt: new Date(window.endedAtMs).toISOString(),
    durationSeconds: window.durationSeconds,
    intervalMinutes: window.intervalMinutes,
    bucketCount: window.bucketCount,
    appName: dominant.appName,
    domain: dominant.domain,
    contributors,
    isShorts: contributors.some((contributor) => contributor.isShorts),
    category: dominant.category,
    productivity: dominant.productivity,
    source: dominant.source,
  };
}

export function buildProjectPassAnalysisWindows(
  segments: readonly ActivitySegment[],
  options: ProjectPassAnalysisWindowOptions = {},
): ProjectPassAnalysisWindow[] {
  const intervalMinutes = options.intervalMinutes ?? PROJECT_PASS_ANALYSIS_INTERVAL_MINUTES;
  const intervalMs = intervalMinutes * 60 * 1000;
  const boundaryMinutes = normalizeStartOfDayMinutes(options.startOfDayMinutes ?? 0);
  const rangeStartMs = parsedMs(options.range?.start);
  const rangeEndMs = parsedMs(options.range?.end);
  const buckets = new Map<number, MutableBucket>();

  for (const segment of segments) {
    const segmentStartMs = parsedMs(segment.startedAt);
    const segmentEndMs = parsedMs(segment.endedAt);
    if (segmentStartMs === null || segmentEndMs === null) continue;
    const clippedStartMs = Math.max(segmentStartMs, rangeStartMs ?? segmentStartMs);
    const clippedEndMs = Math.min(segmentEndMs, rangeEndMs ?? segmentEndMs);
    if (clippedEndMs <= clippedStartMs) continue;

    let cursorMs = clippedStartMs;
    while (cursorMs < clippedEndMs) {
      const startedAtMs = intervalStartMs(cursorMs, intervalMinutes);
      const endedAtMs = startedAtMs + intervalMs;
      const overlapSeconds = Math.max(0, Math.round((Math.min(clippedEndMs, endedAtMs) - Math.max(clippedStartMs, startedAtMs)) / 1000));
      if (overlapSeconds > 0) {
        const bucket = buckets.get(startedAtMs) ?? {
          startedAtMs,
          endedAtMs,
          logicalDay: logicalDayIsoDateForDate(new Date(startedAtMs), boundaryMinutes),
          durationSeconds: 0,
          contributors: new Map<string, MutableContributor>(),
          segmentOverlaps: new Map<string, number>(),
        };
        addContribution(bucket, segment, overlapSeconds, options.includeTitleContext ?? false);
        buckets.set(startedAtMs, bucket);
      }
      cursorMs = endedAtMs;
    }
  }

  const mutableWindows: MutableWindow[] = [];
  let current: MutableWindow | null = null;
  for (const bucket of Array.from(buckets.values()).sort((left, right) => left.startedAtMs - right.startedAtMs)) {
    const dominant = bucketDominant(bucket);
    if (!dominant) continue;
    if (current && canMergeWindow(current, bucket, dominant)) {
      addBucketToWindow(current, bucket);
    } else {
      if (current) mutableWindows.push(current);
      current = startWindow(bucket, dominant, intervalMinutes);
    }
  }
  if (current) mutableWindows.push(current);
  return mutableWindows
    .map((window, index) => finalizeWindow(window, index))
    .filter((window): window is ProjectPassAnalysisWindow => window !== null);
}

function isoClock(iso: string): string {
  const timeIndex = iso.indexOf("T");
  if (timeIndex === -1) return iso;
  return iso.slice(timeIndex + 1, timeIndex + 6);
}

function currentLabel(window: ProjectPassAnalysisWindow): string {
  if (!window.category) return "unclassified";
  const productivity = window.productivity ?? "?";
  return `${window.category}/${productivity}${window.source ? ` (${window.source})` : ""}`;
}

export function formatProjectPassAnalysisWindowLine(window: ProjectPassAnalysisWindow): string {
  const dominant = window.contributors[0];
  const time = `${isoClock(window.startedAt)}-${isoClock(window.endedAt)} (${formatRunDuration(window.durationSeconds)} active, ${window.bucketCount}x${window.intervalMinutes}m)`;
  if (!dominant) return `${window.id} | ${time} | empty`;
  const parts = [
    window.id,
    time,
    `dominant: ${surfaceLabel(dominant)} (${formatRunDuration(dominant.durationSeconds)})`,
  ];
  const secondary = window.contributors.slice(1, 3).map((contributor) => `${surfaceLabel(contributor)} (${formatRunDuration(contributor.durationSeconds)})`);
  if (secondary.length > 0) parts.push(`also: ${secondary.join(", ")}`);
  if (dominant.context) parts.push(dominant.context);
  if (window.isShorts) parts.push("shorts");
  parts.push(`current: ${currentLabel(window)}`);
  return parts.join(" | ");
}
