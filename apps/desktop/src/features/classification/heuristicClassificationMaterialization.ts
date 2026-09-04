import {
  classifyActivityDetailed,
  isSustainedYouTubeFeedPage,
  type ActivityClassificationRecord,
  type ActivitySegment,
  type ClassificationOptions,
  type StoredActivityClassification,
  type StoredClassificationSource,
} from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";

// v3: work communication registry entries (Slack, Zoom, Teams, Meet) flipped
// neutral→focus; bump forces re-materialization of already-stored heuristic segments.
export const BUILT_IN_HEURISTIC_TAXONOMY_VERSION = "builtin-heuristics-v3";

const BUILT_IN_HEURISTIC_SAVE_BATCH_SIZE = 500;

type BuiltInHeuristicSource = Extract<StoredClassificationSource, "app-db" | "domain-db" | "youtube">;

export interface BuiltInHeuristicClassificationMaterializationInput {
  readonly segments: ActivitySegment[];
  readonly classificationOptions?: ClassificationOptions;
  readonly classifiedAt?: string;
}

export interface BuiltInHeuristicClassificationMaterialization {
  readonly segments: ActivitySegment[];
  readonly classifications: ActivityClassificationRecord[];
}

type SaveClassifications = (classifications: ActivityClassificationRecord[]) => Promise<{ saved: number }>;
type PersistenceAllowed = () => boolean;

const persistenceAlwaysAllowed: PersistenceAllowed = () => true;

export function materializeBuiltInHeuristicClassifications(
  input: BuiltInHeuristicClassificationMaterializationInput,
): BuiltInHeuristicClassificationMaterialization {
  const classifiedAt = input.classifiedAt ?? new Date().toISOString();
  const classifications: ActivityClassificationRecord[] = [];

  const segments = input.segments.map((segment) => {
    const classification = buildBuiltInHeuristicClassificationRecord(segment, input.classificationOptions, classifiedAt);
    if (!classification) return segment;

    classifications.push(classification);
    return {
      ...segment,
      classification: toStoredActivityClassification(classification),
    };
  });

  return {
    segments: classifications.length > 0 ? segments : input.segments,
    classifications,
  };
}

export function scheduleBuiltInHeuristicClassificationPersistence(
  classifications: readonly ActivityClassificationRecord[],
  persistenceAllowed: PersistenceAllowed = persistenceAlwaysAllowed,
): void {
  if (classifications.length === 0) return;

  setTimeout(() => {
    if (!persistenceAllowed()) return;
    void persistBuiltInHeuristicClassifications(
      classifications,
      defaultSaveClassifications,
      persistenceAllowed,
    ).catch(reportBuiltInHeuristicPersistenceError);
  }, 0);
}

export async function persistBuiltInHeuristicClassifications(
  classifications: readonly ActivityClassificationRecord[],
  saveClassifications: SaveClassifications = defaultSaveClassifications,
  persistenceAllowed: PersistenceAllowed = persistenceAlwaysAllowed,
): Promise<number> {
  if (!persistenceAllowed()) return 0;
  const uniqueClassifications = dedupeClassificationsBySegmentId(classifications);
  let saved = 0;

  for (let index = 0; index < uniqueClassifications.length; index += BUILT_IN_HEURISTIC_SAVE_BATCH_SIZE) {
    const batch = uniqueClassifications.slice(index, index + BUILT_IN_HEURISTIC_SAVE_BATCH_SIZE);
    if (batch.length === 0) continue;

    await yieldToRenderer();
    if (!persistenceAllowed()) return saved;
    const result = await saveClassifications(batch);
    saved += result.saved;
  }

  return saved;
}

function defaultSaveClassifications(records: ActivityClassificationRecord[]): Promise<{ saved: number }> {
  const saveClassifications = trackerClient.saveClassifications;
  if (typeof saveClassifications !== "function") return Promise.resolve({ saved: 0 });
  return saveClassifications(records);
}

function buildBuiltInHeuristicClassificationRecord(
  segment: ActivitySegment,
  classificationOptions: ClassificationOptions | undefined,
  classifiedAt: string,
): ActivityClassificationRecord | null {
  if (!shouldMaterializeSegment(segment)) return null;

  const classificationSegment: ActivitySegment = { ...segment, classification: null };
  const classification = classifyActivityDetailed(classificationSegment, {
    ...classificationOptions,
    includeAiClassifications: false,
  });
  if (!isBuiltInHeuristicSource(classification.source)) return null;
  // Leave YouTube browse/home/feed pages that resolve to "unknown" unclassified, so
  // runAiClassification can inherit their category from nearby video activity (and only
  // fall back to a sustained=drift / brief=unknown rule when there is no neighbor).
  // Materializing them as "unknown" here would lock them out of that inheritance.
  if (classification.source === "youtube" && classification.category === "unknown") return null;

  return {
    segmentId: segment.id,
    category: classification.category,
    productivity: classification.productivity,
    source: classification.source,
    confidence: classification.confidence,
    reason: classification.reason,
    model: null,
    promptVersion: null,
    taxonomyVersion: BUILT_IN_HEURISTIC_TAXONOMY_VERSION,
    inputFingerprint: `builtin:${BUILT_IN_HEURISTIC_TAXONOMY_VERSION}:${segment.id}:${segment.startedAt}:${segment.endedAt}`,
    requestId: null,
    latencyMs: null,
    aiResult: false,
    stale: false,
    classifiedAt,
  };
}

function shouldMaterializeSegment(segment: ActivitySegment): boolean {
  const stored = segment.classification;
  if (!stored) return true;
  if (isAuthoritativeStoredClassification(stored)) return false;
  if (shouldRefreshStoredYouTubeFeedClassification(segment, stored)) return true;
  if (isFreshBuiltInHeuristicClassification(stored)) return false;
  return true;
}

function isAuthoritativeStoredClassification(classification: StoredActivityClassification): boolean {
  if (classification.source === "manual" || classification.source === "llm") return true;
  return classification.source === "rule" && Boolean(classification.classificationRuleId);
}

function isFreshBuiltInHeuristicClassification(classification: StoredActivityClassification): boolean {
  return (
    isBuiltInHeuristicSource(classification.source)
    && classification.taxonomyVersion === BUILT_IN_HEURISTIC_TAXONOMY_VERSION
    && classification.stale !== true
  );
}

function shouldRefreshStoredYouTubeFeedClassification(
  segment: ActivitySegment,
  classification: StoredActivityClassification,
): boolean {
  return (
    classification.source === "youtube"
    && isSustainedYouTubeFeedPage(segment)
    && (classification.category !== "entertainment" || classification.productivity !== "drift")
  );
}

function isBuiltInHeuristicSource(source: StoredClassificationSource | string): source is BuiltInHeuristicSource {
  return source === "app-db" || source === "domain-db" || source === "youtube";
}

function toStoredActivityClassification(record: ActivityClassificationRecord): StoredActivityClassification {
  return {
    category: record.category,
    productivity: record.productivity,
    source: record.source,
    confidence: record.confidence,
    reason: record.reason ?? null,
    model: record.model ?? null,
    promptVersion: record.promptVersion ?? null,
    taxonomyVersion: record.taxonomyVersion ?? null,
    inputFingerprint: record.inputFingerprint,
    classifiedAt: record.classifiedAt ?? null,
    aiResult: record.aiResult ?? false,
    stale: record.stale ?? false,
  };
}

function dedupeClassificationsBySegmentId(
  classifications: readonly ActivityClassificationRecord[],
): ActivityClassificationRecord[] {
  const bySegmentId = new Map<string, ActivityClassificationRecord>();
  for (const classification of classifications) {
    bySegmentId.set(classification.segmentId, classification);
  }
  return Array.from(bySegmentId.values());
}

async function yieldToRenderer(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function reportBuiltInHeuristicPersistenceError(error: unknown): void {
  if (error instanceof Error) {
    console.warn("Failed to persist built-in heuristic classifications", error.message);
    return;
  }

  console.warn("Failed to persist built-in heuristic classifications", String(error));
}
