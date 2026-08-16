import {
  LIVE_ACTIVITY_CATEGORIES,
  LIVE_PRODUCTIVITY_LABELS,
  type LiveActivityCategory,
  type LiveClassificationMemoryContext,
  type LiveClassificationPromptItem,
  type LiveProductivityLabel,
} from "@drifty/domain";

export const CORRECTION_EVIDENCE_SCHEMA = "drifty.correction-evidence/v1" as const;
export const CORRECTION_EVIDENCE_MAX_RECORDS = 512;

export type CorrectionEvidenceScope = "alarm" | "detail" | "surface";

export type CorrectionEvidenceFeedback =
  | {
      readonly kind: "not_drift";
      readonly scope: "alarm";
      readonly productivityConstraint: "not_drift";
    }
  | {
      readonly kind: "manual_correction";
      readonly scope: "detail" | "surface";
      readonly category: LiveActivityCategory;
      readonly productivity: LiveProductivityLabel;
    };

export interface CorrectionEvidenceRecord {
  readonly schema: typeof CORRECTION_EVIDENCE_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly activityKeys: {
    readonly surface: string;
    readonly detail: string;
  };
  readonly privacy: {
    readonly siteUrl: boolean;
    readonly windowTitle: boolean;
    readonly contentContext: boolean;
    readonly workProfile: boolean;
  };
  readonly promptInput: {
    readonly promptVersion: string;
    readonly item: LiveClassificationPromptItem;
    readonly workProfile: string | null;
    readonly memoryContext: LiveClassificationMemoryContext;
  };
  readonly predictionBeforeFeedback: {
    readonly category: LiveActivityCategory;
    readonly productivity: LiveProductivityLabel;
    readonly confidence: number;
    readonly source: string;
    readonly model: string | null;
    readonly promptVersion: string | null;
    readonly inputFingerprint: string;
  };
  readonly feedback: CorrectionEvidenceFeedback;
}

const HASH = /^[a-f0-9]{64}$/;
const FORBIDDEN_FIELD_NAMES = new Set([
  "contextSegments",
  "endedAt",
  "rawHistory",
  "segmentId",
  "sourceSegmentId",
  "startedAt",
]);

export function parseCorrectionEvidenceRecord(value: unknown): CorrectionEvidenceRecord {
  const record = requireRecord(value, "record");
  assertExactKeys(record, [
    "schema",
    "eventId",
    "recordedAt",
    "activityKeys",
    "privacy",
    "promptInput",
    "predictionBeforeFeedback",
    "feedback",
  ], "record");
  if (record.schema !== CORRECTION_EVIDENCE_SCHEMA) throw new Error("record.schema is unsupported.");
  requireHash(record.eventId, "record.eventId");
  requireTimestamp(record.recordedAt, "record.recordedAt");

  const activityKeys = requireRecord(record.activityKeys, "record.activityKeys");
  assertExactKeys(activityKeys, ["surface", "detail"], "record.activityKeys");
  requireHash(activityKeys.surface, "record.activityKeys.surface");
  requireHash(activityKeys.detail, "record.activityKeys.detail");

  const privacy = requireRecord(record.privacy, "record.privacy");
  assertExactKeys(privacy, ["siteUrl", "windowTitle", "contentContext", "workProfile"], "record.privacy");
  for (const key of ["siteUrl", "windowTitle", "contentContext", "workProfile"] as const) {
    if (typeof privacy[key] !== "boolean") throw new Error(`record.privacy.${key} must be boolean.`);
  }

  const promptInput = requireRecord(record.promptInput, "record.promptInput");
  assertExactKeys(promptInput, ["promptVersion", "item", "workProfile", "memoryContext"], "record.promptInput");
  requireBoundedString(promptInput.promptVersion, "record.promptInput.promptVersion", 80);
  const item = requireRecord(promptInput.item, "record.promptInput.item");
  assertExactKeys(item, [
    "id",
    "appName",
    "domain",
    "urlHost",
    "siteUrl",
    "windowTitle",
    "title",
    "youtubeChannelName",
    "youtubeCategory",
    "redditCommunity",
    "durationSeconds",
  ], "record.promptInput.item", true);
  if (item.id !== "current") throw new Error("record.promptInput.item.id must be current.");
  requireBoundedString(item.appName, "record.promptInput.item.appName", 160);
  for (const key of [
    "domain",
    "urlHost",
    "siteUrl",
    "windowTitle",
    "title",
    "youtubeChannelName",
    "youtubeCategory",
    "redditCommunity",
  ] as const) {
    if (item[key] !== undefined) requireBoundedString(item[key], `record.promptInput.item.${key}`, 300);
  }
  if (item.durationSeconds !== undefined
    && (typeof item.durationSeconds !== "number" || !Number.isFinite(item.durationSeconds) || item.durationSeconds < 0)) {
    throw new Error("record.promptInput.item.durationSeconds must be non-negative.");
  }
  if (promptInput.workProfile !== null) {
    requireBoundedString(promptInput.workProfile, "record.promptInput.workProfile", 120);
  }
  const memoryContext = requireRecord(promptInput.memoryContext, "record.promptInput.memoryContext");
  if (!("soul" in memoryContext) || !isRecord(memoryContext.episodeByItemId)) {
    throw new Error("record.promptInput.memoryContext is invalid.");
  }
  const episodeKeys = Object.keys(memoryContext.episodeByItemId);
  if (episodeKeys.some((key) => key !== "current")) {
    throw new Error("record.promptInput.memoryContext may contain only the current Episode.");
  }
  assertNoForbiddenFields(promptInput, "record.promptInput");

  const prediction = requireRecord(record.predictionBeforeFeedback, "record.predictionBeforeFeedback");
  assertExactKeys(prediction, [
    "category",
    "productivity",
    "confidence",
    "source",
    "model",
    "promptVersion",
    "inputFingerprint",
  ], "record.predictionBeforeFeedback");
  requireCategory(prediction.category, "record.predictionBeforeFeedback.category");
  requireProductivity(prediction.productivity, "record.predictionBeforeFeedback.productivity");
  if (typeof prediction.confidence !== "number" || !Number.isFinite(prediction.confidence)
    || prediction.confidence < 0 || prediction.confidence > 1) {
    throw new Error("record.predictionBeforeFeedback.confidence must be 0-1.");
  }
  requireBoundedString(prediction.source, "record.predictionBeforeFeedback.source", 40);
  for (const key of ["model", "promptVersion"] as const) {
    if (prediction[key] !== null) requireBoundedString(prediction[key], `record.predictionBeforeFeedback.${key}`, 160);
  }
  requireBoundedString(
    prediction.inputFingerprint,
    "record.predictionBeforeFeedback.inputFingerprint",
    200,
  );

  parseFeedback(record.feedback);
  return record as unknown as CorrectionEvidenceRecord;
}

function parseFeedback(value: unknown): void {
  const feedback = requireRecord(value, "record.feedback");
  if (feedback.kind === "not_drift") {
    assertExactKeys(feedback, ["kind", "scope", "productivityConstraint"], "record.feedback");
    if (feedback.scope !== "alarm" || feedback.productivityConstraint !== "not_drift") {
      throw new Error("record.feedback not_drift constraint is invalid.");
    }
    return;
  }
  if (feedback.kind === "manual_correction") {
    assertExactKeys(feedback, ["kind", "scope", "category", "productivity"], "record.feedback");
    if (feedback.scope !== "detail" && feedback.scope !== "surface") {
      throw new Error("record.feedback manual scope is invalid.");
    }
    requireCategory(feedback.category, "record.feedback.category");
    requireProductivity(feedback.productivity, "record.feedback.productivity");
    return;
  }
  throw new Error("record.feedback.kind is unsupported.");
}

function assertNoForbiddenFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(key)) throw new Error(`${path}.${key} is forbidden.`);
    assertNoForbiddenFields(nested, `${path}.${key}`);
  }
}

function requireCategory(value: unknown, label: string): asserts value is LiveActivityCategory {
  if (typeof value !== "string" || !(LIVE_ACTIVITY_CATEGORIES as readonly string[]).includes(value)) {
    throw new Error(`${label} is unsupported.`);
  }
}

function requireProductivity(value: unknown, label: string): asserts value is LiveProductivityLabel {
  if (typeof value !== "string" || !(LIVE_PRODUCTIVITY_LABELS as readonly string[]).includes(value)) {
    throw new Error(`${label} is unsupported.`);
  }
}

function requireHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
}

function requireTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be ISO-8601.`);
}

function requireBoundedString(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string up to ${maxLength} characters.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  allowMissing = false,
): void {
  const allowedSet = new Set(allowed);
  const extras = Object.keys(record).filter((key) => !allowedSet.has(key));
  const missing = allowMissing ? [] : allowed.filter((key) => !(key in record));
  if (extras.length > 0 || missing.length > 0) {
    throw new Error(`${label} keys are invalid.`);
  }
}
