import { browserContentCluesForSegment, normalizeBrowserContentClues, type BrowserContentClues } from "./browserContentContext";
import { aggregateDeviceElapsedTime, sampledActivityTimeBounds, sampledActivitySecondsWithinInterval, sampledActivityEvidenceSecondsWithinInterval } from "./deviceElapsedTime";
import type {
  ActivityCategory,
  ActivitySegment,
  FlowIntervalMinutes,
  ProductivityLabel,
  StoredClassificationSource,
} from "./activity";
import { formatRunDuration } from "./projectRun";
import { normalizeClassificationTitles } from "./classificationTitles";

export const PROJECT_PASS_ANALYSIS_INTERVAL_MINUTES: FlowIntervalMinutes = 3;

export type ProjectPassWindowRange = {
  readonly start: string;
  readonly end: string;
};

export type ProjectPassAnalysisWindowOptions = {
  readonly intervalMinutes?: FlowIntervalMinutes;
  readonly startOfDayMinutes?: number;
  readonly range?: ProjectPassWindowRange;
  /**
   * When provided, omit fixed windows whose end is still in the future at this
   * instant. This keeps an in-progress cell out of persisted project decisions
   * until a later pass can observe the completed interval.
   */
  readonly completedThrough?: string;
  /** Provider-visible fields, mirroring the live-classification privacy controls. */
  readonly contextPolicy?: ProjectPassContextPolicy;
  /** @deprecated Compatibility for eval callers; prefer contextPolicy. */
  readonly includeTitleContext?: boolean;
};

export type ProjectPassContextPolicy = {
  readonly siteUrl: boolean;
  readonly windowTitle: boolean;
  readonly contentContext: boolean;
};

export type ProjectPassWindowSegmentOverlap = {
  readonly segmentId: string;
  readonly durationSeconds: number;
};

export type ProjectPassWindowContributorContext = {
  readonly siteUrl: string | null;
  readonly windowTitle: string | null;
  readonly title: string | null;
  readonly redditCommunity: string | null;
  readonly youtubeChannelName: string | null;
  readonly youtubeCategory: string | null;
  readonly browserContext?: BrowserContentClues;
  readonly durationSeconds: number;
};

export type ProjectPassWindowContributor = {
  readonly appName: string;
  readonly domain: string | null;
  readonly durationSeconds: number;
  readonly segmentIds: readonly string[];
  readonly contexts: readonly ProjectPassWindowContributorContext[];
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
  capturedSeconds: number;
  readonly segmentIds: Set<string>;
  readonly contexts: Map<string, ProjectPassWindowContributorContext>;
  isShorts: boolean;
  readonly classifications: Map<string, MutableClassificationSummary>;
};

type MutableBucket = {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  durationSeconds: number;
  readonly contributors: Map<string, MutableContributor>;
  readonly segmentOverlaps: Map<string, number>;
};

const MAX_CONTEXTS_PER_CONTRIBUTOR = 6;
const MAX_TEXT_LENGTH = 160;
const MAX_YOUTUBE_CHANNEL_NAME_LENGTH = 120;
const MAX_YOUTUBE_CATEGORY_LENGTH = 80;
const REDDIT_DOMAIN_PATTERN = /(^|\.)reddit\.com$/i;
const REDDIT_COMMUNITY_PATTERN = /\br\/([A-Za-z0-9_]{2,32})\b/i;
const VALID_REDDIT_COMMUNITY_PATTERN = /^[a-z0-9_]{2,32}$/;

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

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed;
}

function providerSafeSiteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function contributorContext(
  segment: ActivitySegment,
  durationSeconds: number,
  policy: ProjectPassContextPolicy,
): ProjectPassWindowContributorContext | null {
  const siteUrl = policy.siteUrl ? providerSafeSiteUrl(segment.siteUrl) : null;
  const titles = normalizeClassificationTitles({
    appName: segment.appName, bundleId: segment.bundleId, browserName: segment.browserName, siteDomain: segment.siteDomain,
    windowTitle: policy.windowTitle ? segment.windowTitle : null,
    title: policy.contentContext ? segment.siteTitle?.trim() || segment.youtubeTitle : null,
  });
  const context = {
    siteUrl,
    windowTitle: cleanText(titles.windowTitle),
    title: cleanText(titles.title),
    redditCommunity: policy.contentContext ? redditCommunityForSegment(segment, siteUrl) : null,
    youtubeChannelName: policy.contentContext
      ? cleanText(segment.youtubeChannelName)?.slice(0, MAX_YOUTUBE_CHANNEL_NAME_LENGTH) ?? null
      : null,
    youtubeCategory: policy.contentContext
      ? cleanText(segment.youtubeCategory)?.slice(0, MAX_YOUTUBE_CATEGORY_LENGTH) ?? null
      : null,
    ...(policy.contentContext && browserContentCluesForSegment(segment) ? { browserContext: browserContentCluesForSegment(segment) } : {}),
    durationSeconds,
  };
  return context.siteUrl || context.windowTitle || context.title || context.redditCommunity || context.youtubeChannelName || context.youtubeCategory || context.browserContext
    ? context
    : null;
}

function contextKey(context: ProjectPassWindowContributorContext): string {
  return JSON.stringify([
    context.siteUrl,
    context.windowTitle,
    context.title,
    context.redditCommunity,
    context.youtubeChannelName,
    context.youtubeCategory,
    context.browserContext ?? null,
  ]);
}

function redditCommunityForSegment(
  segment: ActivitySegment,
  siteUrl: string | null,
): string | null {
  const domain = normalizedDomain(segment);
  if (!domain || !REDDIT_DOMAIN_PATTERN.test(domain)) return null;
  const fromUrl = siteUrl ? extractRedditCommunityFromText(new URL(siteUrl).pathname) : null;
  return fromUrl
    ?? extractRedditCommunityFromText(segment.siteTitle)
    ?? extractRedditCommunityFromText(segment.windowTitle);
}

function extractRedditCommunityFromText(value: string | null | undefined): string | null {
  const normalized = cleanText(value)?.match(REDDIT_COMMUNITY_PATTERN)?.[1]?.trim().toLowerCase();
  return normalized && VALID_REDDIT_COMMUNITY_PATTERN.test(normalized) ? normalized : null;
}

function addContext(
  contributor: MutableContributor,
  segment: ActivitySegment,
  durationSeconds: number,
  policy: ProjectPassContextPolicy,
): void {
  const context = contributorContext(segment, durationSeconds, policy);
  if (!context) return;
  const key = contextKey(context);
  const existing = contributor.contexts.get(key);
  contributor.contexts.set(key, existing
    ? { ...existing, durationSeconds: existing.durationSeconds + durationSeconds }
    : context);
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

function mutableContributorFrom(segment: ActivitySegment, durationSeconds: number, capturedSeconds: number, policy: ProjectPassContextPolicy): MutableContributor {
  const contributor: MutableContributor = {
    key: surfaceKey(segment),
    appName: segment.appName,
    domain: normalizedDomain(segment),
    durationSeconds: 0,
    capturedSeconds: 0,
    segmentIds: new Set<string>(),
    contexts: new Map<string, ProjectPassWindowContributorContext>(),
    isShorts: false,
    classifications: new Map<string, MutableClassificationSummary>(),
  };
  mergeContributor(contributor, segment, durationSeconds, capturedSeconds, policy);
  return contributor;
}

function mergeContributor(contributor: MutableContributor, segment: ActivitySegment, durationSeconds: number, capturedSeconds: number, policy: ProjectPassContextPolicy): void {
  contributor.durationSeconds += durationSeconds;
  contributor.capturedSeconds += capturedSeconds;
  contributor.segmentIds.add(segment.id);
  contributor.isShorts = contributor.isShorts || segment.youtubeIsShorts === true;
  addContext(contributor, segment, durationSeconds, policy);
  addClassification(contributor, classificationSummary(segment), capturedSeconds);
}

function addContribution(bucket: MutableBucket, segment: ActivitySegment, durationSeconds: number, capturedSeconds: number, policy: ProjectPassContextPolicy): void {
  const key = surfaceKey(segment);
  const contributor = bucket.contributors.get(key);
  if (contributor) {
    mergeContributor(contributor, segment, durationSeconds, capturedSeconds, policy);
  } else {
    bucket.contributors.set(key, mutableContributorFrom(segment, durationSeconds, capturedSeconds, policy));
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
  // Elapsed shares are summary counts, not attention evidence. Preserve the
  // captured-evidence surface/classification when choosing correction targets.
  return Array.from(contributors.values())
    .sort((left, right) => right.capturedSeconds - left.capturedSeconds || surfaceLabel(left).localeCompare(surfaceLabel(right)))
    .map((contributor) => {
      const summary = dominantClassification(contributor);
      return {
        appName: contributor.appName,
        domain: contributor.domain,
        durationSeconds: contributor.durationSeconds,
        segmentIds: Array.from(contributor.segmentIds),
        contexts: Array.from(contributor.contexts.values())
          .sort((left, right) => right.durationSeconds - left.durationSeconds || contextKey(left).localeCompare(contextKey(right)))
          .slice(0, MAX_CONTEXTS_PER_CONTRIBUTOR),
        isShorts: contributor.isShorts,
        category: summary.category,
        productivity: summary.productivity,
        source: summary.source,
      };
    });
}

function surfaceLabel(contributor: Pick<ProjectPassWindowContributor, "appName" | "domain">): string {
  return contributor.domain ? `${contributor.appName} · ${contributor.domain}` : contributor.appName;
}

function finalizeBucket(bucket: MutableBucket, index: number, intervalMinutes: FlowIntervalMinutes): ProjectPassAnalysisWindow | null {
  const contributors = sortedContributors(bucket.contributors);
  const dominant = contributors[0];
  if (!dominant) return null;
  const segmentIds = Array.from(bucket.segmentOverlaps.keys());
  const dominantSegmentIds = new Set(dominant.segmentIds);
  return {
    id: `w${index}`,
    segmentIds,
    correctionSegmentIds: segmentIds.filter((segmentId) => dominantSegmentIds.has(segmentId)),
    segmentOverlaps: Array.from(bucket.segmentOverlaps.entries()).map(([segmentId, durationSeconds]) => ({ segmentId, durationSeconds })),
    startedAt: new Date(bucket.startedAtMs).toISOString(),
    endedAt: new Date(bucket.endedAtMs).toISOString(),
    durationSeconds: bucket.durationSeconds,
    intervalMinutes,
    bucketCount: 1,
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
  const rangeStartMs = parsedMs(options.range?.start);
  const rangeEndMs = parsedMs(options.range?.end);
  const completedThroughMs = parsedMs(options.completedThrough);
  if (options.completedThrough !== undefined && completedThroughMs === null) return [];
  const legacyTitlePolicy = options.includeTitleContext;
  const contextPolicy = options.contextPolicy ?? {
    siteUrl: legacyTitlePolicy === true,
    windowTitle: legacyTitlePolicy === true,
    contentContext: legacyTitlePolicy === true,
  };
  const buckets = new Map<number, MutableBucket>();

  // Raw tracker timelines include synced devices. Count elapsed time once;
  // already-derived inputs retain their exact allocation.
  for (const segment of aggregateDeviceElapsedTime(segments)) {
    const { start: segmentStartMs, end: segmentEndMs } = sampledActivityTimeBounds(segment);
    if (!Number.isFinite(segmentStartMs) || !Number.isFinite(segmentEndMs)) continue;
    const clippedStartMs = Math.max(segmentStartMs, rangeStartMs ?? segmentStartMs);
    const clippedEndMs = Math.min(segmentEndMs, rangeEndMs ?? segmentEndMs);
    if (clippedEndMs <= clippedStartMs) continue;

    let cursorMs = clippedStartMs;
    while (cursorMs < clippedEndMs) {
      const startedAtMs = intervalStartMs(cursorMs, intervalMinutes);
      const endedAtMs = startedAtMs + intervalMs;
      const overlapSeconds = sampledActivitySecondsWithinInterval(segment, Math.max(clippedStartMs, startedAtMs), Math.min(clippedEndMs, endedAtMs));
      if (overlapSeconds > 0) {
        const bucket = buckets.get(startedAtMs) ?? {
          startedAtMs,
          endedAtMs,
          durationSeconds: 0,
          contributors: new Map<string, MutableContributor>(),
          segmentOverlaps: new Map<string, number>(),
        };
        const capturedSeconds = sampledActivityEvidenceSecondsWithinInterval(segment,
          Math.max(clippedStartMs, startedAtMs), Math.min(clippedEndMs, endedAtMs));
        addContribution(bucket, segment, overlapSeconds, capturedSeconds, contextPolicy);
        buckets.set(startedAtMs, bucket);
      }
      cursorMs = endedAtMs;
    }
  }

  return Array.from(buckets.values())
    .sort((left, right) => left.startedAtMs - right.startedAtMs)
    .filter((bucket) => completedThroughMs === null || bucket.endedAtMs <= completedThroughMs)
    .map((bucket, index) => finalizeBucket(bucket, index, intervalMinutes))
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
    `dominant: ${formatContributor(dominant)}`,
  ];
  const secondary = window.contributors.slice(1, 3).map(formatContributor);
  if (secondary.length > 0) parts.push(`also: ${secondary.join(", ")}`);
  if (window.isShorts) parts.push("shorts");
  parts.push(`current: ${currentLabel(window)}`);
  return parts.join(" | ");
}

function formatContributorContext(context: ProjectPassWindowContributorContext): string {
  const fields: string[] = [];
  if (context.siteUrl) fields.push(`url=${JSON.stringify(context.siteUrl)}`);
  if (context.windowTitle) fields.push(`window=${JSON.stringify(context.windowTitle)}`);
  if (context.title) fields.push(`title=${JSON.stringify(context.title)}`);
  if (context.redditCommunity) fields.push(`reddit=${JSON.stringify(context.redditCommunity)}`);
  if (context.youtubeChannelName) fields.push(`channel=${JSON.stringify(context.youtubeChannelName)}`);
  if (context.youtubeCategory) fields.push(`videoCategory=${JSON.stringify(context.youtubeCategory)}`);
  const browserContext = normalizeBrowserContentClues(context.browserContext);
  if(browserContext)fields.push(`browserContext=${JSON.stringify(browserContext)}`);
  return `${fields.join(" ")} (${formatRunDuration(context.durationSeconds)})`;
}

function formatContributor(contributor: ProjectPassWindowContributor): string {
  const base = `${surfaceLabel(contributor)} (${formatRunDuration(contributor.durationSeconds)})`;
  if (contributor.contexts.length === 0) return base;
  return `${base} [${contributor.contexts.map(formatContributorContext).join("; ")}]`;
}
