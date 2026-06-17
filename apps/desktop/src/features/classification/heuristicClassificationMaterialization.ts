import {
  classifyActivityDetailed,
  type ActivityClassificationRecord,
  type ActivitySegment,
  type ClassificationOptions,
  type StoredActivityClassification,
  type StoredClassificationSource,
} from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";

export const BUILT_IN_HEURISTIC_TAXONOMY_VERSION = "builtin-heuristics-v1";

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
): void {
  if (classifications.length === 0) return;

  setTimeout(() => {
    void persistBuiltInHeuristicClassifications(classifications).catch(reportBuiltInHeuristicPersistenceError);
  }, 0);
}

export async function persistBuiltInHeuristicClassifications(
  classifications: readonly ActivityClassificationRecord[],
  saveClassifications: SaveClassifications = defaultSaveClassifications,
): Promise<number> {
  const uniqueClassifications = dedupeClassificationsBySegmentId(classifications);
  let saved = 0;

  for (let index = 0; index < uniqueClassifications.length; index += BUILT_IN_HEURISTIC_SAVE_BATCH_SIZE) {
    const batch = uniqueClassifications.slice(index, index + BUILT_IN_HEURISTIC_SAVE_BATCH_SIZE);
    if (batch.length === 0) continue;

    await yieldToRenderer();
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
