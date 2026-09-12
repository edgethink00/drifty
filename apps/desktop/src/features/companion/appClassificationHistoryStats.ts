import { classifyActivityDetailed } from "@drifty/domain";
import type {
  ActivityCategory,
  ActivityClassificationDetail,
  ActivitySegment,
  ClassificationOptions,
  ClassificationSource,
  ProductivityLabel,
} from "@drifty/domain";

const HISTORY_SOURCE_WEIGHTS = {
  manual: 1,
  rule: 1,
  "app-db": 0.9,
  "domain-db": 0.9,
  youtube: 0.9,
  llm: 0.75,
  stored: 0.5,
  context: 0.5,
  fallback: 0.5,
  unknown: 0,
  "sustained-social-dwell": 0.95,
} satisfies Record<ClassificationSource, number>;

export type AppClassificationHistoryStats = {
  readonly pairBuckets: ReadonlyMap<string, PairBucket>;
  readonly productivityBuckets: ReadonlyMap<ProductivityLabel, ProductivityBucket>;
  readonly dominantPair: PairBucket;
  readonly dominantProductivity: ProductivityBucket;
  readonly totalSeconds: number;
  readonly totalWeightedSeconds: number;
  readonly segmentCount: number;
};

export type AppClassificationHistorySupport = {
  readonly segmentCount: number;
  readonly totalSeconds: number;
};

export type PairBucket = {
  category: ActivityCategory;
  productivity: ProductivityLabel;
  weightedSeconds: number;
  segments: number;
};

export type ProductivityBucket = {
  productivity: ProductivityLabel;
  weightedSeconds: number;
  segments: number;
};

export function buildAppClassificationHistoryStats({
  currentSegment,
  historySegments,
  classificationOptions,
  excludeSegmentIds,
}: {
  readonly currentSegment: ActivitySegment;
  readonly historySegments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly excludeSegmentIds?: ReadonlySet<string>;
}): AppClassificationHistoryStats | null {
  const appIdentity = appHistoryIdentity(currentSegment);
  if (!appIdentity) return null;

  const pairBuckets = new Map<string, PairBucket>();
  const productivityBuckets = new Map<ProductivityLabel, ProductivityBucket>();
  let totalSeconds = 0;
  let totalWeightedSeconds = 0;
  let segmentCount = 0;

  for (const historySegment of historySegments) {
    if (historySegment.id === currentSegment.id) continue;
    if (excludeSegmentIds?.has(historySegment.id) === true) continue;
    if (appHistoryIdentity(historySegment) !== appIdentity) continue;

    const classification = classifyActivityDetailed(historySegment, classificationOptions);
    if (classification.surface !== "app" || classification.source === "unknown") continue;

    const seconds = validDurationSeconds(historySegment);
    const weightedSeconds = seconds * classificationWeight(classification);
    if (seconds <= 0 || weightedSeconds <= 0) continue;

    const pairBucket = getPairBucket(pairBuckets, classification.category, classification.productivity);
    pairBucket.weightedSeconds += weightedSeconds;
    pairBucket.segments += 1;

    const productivityBucket = getProductivityBucket(productivityBuckets, classification.productivity);
    productivityBucket.weightedSeconds += weightedSeconds;
    productivityBucket.segments += 1;

    totalSeconds += seconds;
    totalWeightedSeconds += weightedSeconds;
    segmentCount += 1;
  }

  const dominantPair = maxWeightedBucket(pairBuckets.values());
  const dominantProductivity = maxWeightedBucket(productivityBuckets.values());
  if (!dominantPair || !dominantProductivity || totalWeightedSeconds <= 0) return null;

  return {
    pairBuckets,
    productivityBuckets,
    dominantPair,
    dominantProductivity,
    totalSeconds,
    totalWeightedSeconds,
    segmentCount,
  };
}

export function getAppClassificationHistorySupport({
  currentSegment,
  historySegments,
  excludeSegmentIds,
}: {
  readonly currentSegment: ActivitySegment;
  readonly historySegments: readonly ActivitySegment[];
  readonly excludeSegmentIds?: ReadonlySet<string>;
}): AppClassificationHistorySupport {
  const appIdentity = appHistoryIdentity(currentSegment);
  if (!appIdentity) return { segmentCount: 0, totalSeconds: 0 };

  let segmentCount = 0;
  let totalSeconds = 0;
  for (const historySegment of historySegments) {
    if (historySegment.id === currentSegment.id) continue;
    if (excludeSegmentIds?.has(historySegment.id) === true) continue;
    if (appHistoryIdentity(historySegment) !== appIdentity) continue;

    segmentCount += 1;
    totalSeconds += validDurationSeconds(historySegment);
  }

  return { segmentCount, totalSeconds };
}

export function classificationKey(category: ActivityCategory, productivity: ProductivityLabel): string {
  return `${productivity}:${category}`;
}

export function share(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function getPairBucket(
  buckets: Map<string, PairBucket>,
  category: ActivityCategory,
  productivity: ProductivityLabel,
): PairBucket {
  const key = classificationKey(category, productivity);
  const existing = buckets.get(key);
  if (existing) return existing;

  const bucket = { category, productivity, weightedSeconds: 0, segments: 0 };
  buckets.set(key, bucket);
  return bucket;
}

function getProductivityBucket(
  buckets: Map<ProductivityLabel, ProductivityBucket>,
  productivity: ProductivityLabel,
): ProductivityBucket {
  const existing = buckets.get(productivity);
  if (existing) return existing;

  const bucket = { productivity, weightedSeconds: 0, segments: 0 };
  buckets.set(productivity, bucket);
  return bucket;
}

function maxWeightedBucket<T extends { readonly weightedSeconds: number }>(buckets: Iterable<T>): T | null {
  let best: T | null = null;
  for (const bucket of buckets) {
    if (!best || bucket.weightedSeconds > best.weightedSeconds) best = bucket;
  }
  return best;
}

function classificationWeight(classification: ActivityClassificationDetail): number {
  return HISTORY_SOURCE_WEIGHTS[classification.source] * clamp01(classification.confidence);
}

function validDurationSeconds(segment: ActivitySegment): number {
  if (Number.isFinite(segment.durationSeconds) && segment.durationSeconds > 0) return segment.durationSeconds;

  const startedAtMs = new Date(segment.startedAt).getTime();
  const endedAtMs = new Date(segment.endedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs <= startedAtMs) return 0;
  return Math.round((endedAtMs - startedAtMs) / 1000);
}

function appHistoryIdentity(segment: ActivitySegment): string | null {
  const bundleId = normalizedValue(segment.bundleId);
  if (bundleId) return `bundle:${bundleId}`;

  const appName = normalizedValue(segment.appName);
  return appName ? `app:${appName}` : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizedValue(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized ? normalized : null;
}
