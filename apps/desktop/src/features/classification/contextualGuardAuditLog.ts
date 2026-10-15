import { builtInCategoryOrUnknown } from "@drifty/domain";
import {
  MATCHED_CONTEXTUAL_DRIFT_GUARD_MAX_SECONDS,
  MATCHED_CONTEXTUAL_DRIFT_GUARD_MIN_EVIDENCE,
  applyMatchedContextualDriftSafetyGuard,
  type ActivityCategory,
  type LiveClassificationMemoryContext,
  type LiveClassificationPromptItem,
  type ProductivityLabel,
} from "@drifty/domain";

export const CONTEXTUAL_GUARD_AUDIT_STORAGE_KEY = "drifty.classification.contextualGuardAudit.v1";
export const CONTEXTUAL_GUARD_AUDIT_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;

const CONTEXTUAL_GUARD_AUDIT_LIMIT = 2_000;
const AUDIT_REASONS = new Set<ContextualGuardAuditReason>([
  "applied", "raw_not_drift", "protected_category", "immature_match",
  "missing_episode", "invalid_duration", "sustained_use", "decision_mismatch",
]);
const AUDIT_CATEGORIES = new Set<ActivityCategory>([
  "workspace", "learning", "communication", "music", "game", "social_media",
  "entertainment", "shopping", "utility", "unknown",
]);
const AUDIT_PRODUCTIVITY = new Set<ProductivityLabel>(["focus", "neutral", "drift"]);
const AUDIT_DURATION_BUCKETS = new Set<ContextualGuardAuditEvent["currentDurationBucket"]>([
  "invalid", "under_1m", "1_to_3m", "over_3m",
]);

export type ContextualGuardAuditReason =
  | "applied"
  | "raw_not_drift"
  | "protected_category"
  | "immature_match"
  | "missing_episode"
  | "invalid_duration"
  | "sustained_use"
  | "decision_mismatch";

export type ContextualGuardAuditEvent = {
  readonly schemaVersion: 1;
  readonly recordedAt: string;
  readonly route: "cloud" | "local";
  readonly outcome: "applied" | "retained";
  readonly reason: ContextualGuardAuditReason;
  readonly category: ActivityCategory;
  readonly rawProductivity: ProductivityLabel;
  readonly finalProductivity: ProductivityLabel;
  readonly rawConfidence: number | null;
  readonly finalConfidence: number;
  readonly evidenceCount: number;
  readonly matchConfidence: "low" | "medium" | "high";
  readonly soulRevision: number;
  readonly currentDurationBucket: "invalid" | "under_1m" | "1_to_3m" | "over_3m";
  readonly promptVersion: string;
};

export type ContextualGuardAuditInput = {
  readonly route: "cloud" | "local";
  readonly category: ActivityCategory;
  readonly rawProductivity: ProductivityLabel;
  readonly finalProductivity: ProductivityLabel;
  readonly rawConfidence: number | null;
  readonly finalConfidence: number;
  readonly promptVersion: string;
  readonly item: LiveClassificationPromptItem;
  readonly memoryContext: LiveClassificationMemoryContext | null;
};

export function buildContextualGuardAuditEvent(
  input: ContextualGuardAuditInput,
  now = new Date(),
): ContextualGuardAuditEvent | null {
  const patterns = input.memoryContext?.soul?.matchedContextualWorkSupport ?? [];
  if (patterns.length === 0) return null;

  const strongest = [...patterns].sort((left, right) =>
    right.evidenceCount - left.evidenceCount || confidenceRank(right.confidence) - confidenceRank(left.confidence)
  )[0];
  if (!strongest || !input.memoryContext?.soul) return null;

  const episode = input.memoryContext.episodeByItemId[input.item.id];
  const currentSeconds = episode
    ? Math.max(episode.currentSurfaceSeconds, input.item.durationSeconds ?? 0)
    : 0;
  const guarded = applyMatchedContextualDriftSafetyGuard(
    input.rawProductivity,
    builtInCategoryOrUnknown(input.category),
    input.item,
    input.memoryContext,
  );
  const expectedApplied = input.rawProductivity === "drift" && guarded === "neutral";
  const actuallyApplied = expectedApplied && input.finalProductivity === "neutral";

  return {
    schemaVersion: 1,
    recordedAt: validIso(now),
    route: input.route,
    outcome: actuallyApplied ? "applied" : "retained",
    reason: contextualGuardAuditReason({
      input,
      evidenceCount: strongest.evidenceCount,
      matchConfidence: strongest.confidence,
      hasEpisode: Boolean(episode),
      currentSeconds,
      expectedApplied,
      actuallyApplied,
    }),
    category: input.category,
    rawProductivity: input.rawProductivity,
    finalProductivity: input.finalProductivity,
    rawConfidence: finiteConfidenceOrNull(input.rawConfidence),
    finalConfidence: finiteConfidence(input.finalConfidence),
    evidenceCount: Math.max(0, Math.floor(strongest.evidenceCount)),
    matchConfidence: strongest.confidence,
    soulRevision: Math.max(1, Math.floor(input.memoryContext.soul.revision)),
    currentDurationBucket: durationBucket(currentSeconds),
    promptVersion: boundedPromptVersion(input.promptVersion),
  };
}

export function recordContextualGuardAuditEvent(
  input: ContextualGuardAuditInput,
  storage = browserStorage(),
  now = new Date(),
): ContextualGuardAuditEvent[] {
  if (!storage) return [];
  const event = buildContextualGuardAuditEvent(input, now);
  if (!event) return [];

  const recent = readStoredEvents(storage)
    .filter((candidate) => withinRetention(candidate.recordedAt, now.getTime()));
  const latest = recent[recent.length - 1];
  const next = latest && sameDecision(latest, event) && Date.parse(event.recordedAt) - Date.parse(latest.recordedAt) < 60_000
    ? [...recent.slice(0, -1), event]
    : [...recent, event];
  const bounded = next.slice(-CONTEXTUAL_GUARD_AUDIT_LIMIT);
  try {
    storage.setItem(CONTEXTUAL_GUARD_AUDIT_STORAGE_KEY, JSON.stringify(bounded));
  } catch (error) {
    reportStorageFailure("write", error);
  }
  return bounded;
}

export function readContextualGuardAuditEvents(
  storage = browserStorage(),
  nowMs = Date.now(),
): ContextualGuardAuditEvent[] {
  if (!storage) return [];
  const stored = readStoredEvents(storage);
  const recent = stored
    .filter((event) => withinRetention(event.recordedAt, nowMs))
    .slice(-CONTEXTUAL_GUARD_AUDIT_LIMIT);
  if (recent.length !== stored.length) {
    try {
      storage.setItem(CONTEXTUAL_GUARD_AUDIT_STORAGE_KEY, JSON.stringify(recent));
    } catch (error) {
      reportStorageFailure("write", error);
    }
  }
  return recent;
}

function contextualGuardAuditReason(input: {
  readonly input: ContextualGuardAuditInput;
  readonly evidenceCount: number;
  readonly matchConfidence: "low" | "medium" | "high";
  readonly hasEpisode: boolean;
  readonly currentSeconds: number;
  readonly expectedApplied: boolean;
  readonly actuallyApplied: boolean;
}): ContextualGuardAuditReason {
  if (input.input.rawProductivity !== "drift") return "raw_not_drift";
  if (input.input.category === "game" || input.input.category === "shopping") return "protected_category";
  if (input.evidenceCount < MATCHED_CONTEXTUAL_DRIFT_GUARD_MIN_EVIDENCE || input.matchConfidence === "low") return "immature_match";
  if (!input.hasEpisode) return "missing_episode";
  if (input.currentSeconds <= 0) return "invalid_duration";
  if (input.currentSeconds > MATCHED_CONTEXTUAL_DRIFT_GUARD_MAX_SECONDS) return "sustained_use";
  if (input.expectedApplied && input.actuallyApplied) return "applied";
  return "decision_mismatch";
}

function durationBucket(seconds: number): ContextualGuardAuditEvent["currentDurationBucket"] {
  if (!Number.isFinite(seconds) || seconds <= 0) return "invalid";
  if (seconds < 60) return "under_1m";
  if (seconds <= MATCHED_CONTEXTUAL_DRIFT_GUARD_MAX_SECONDS) return "1_to_3m";
  return "over_3m";
}

function confidenceRank(value: "low" | "medium" | "high"): number {
  if (value === "high") return 2;
  if (value === "medium") return 1;
  return 0;
}

function finiteConfidence(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

function finiteConfidenceOrNull(value: number | null): number | null {
  return value === null ? null : finiteConfidence(value);
}

function boundedPromptVersion(value: string): string {
  return value.trim().slice(0, 80) || "unknown";
}

function validIso(value: Date): string {
  return Number.isFinite(value.getTime()) ? value.toISOString() : new Date(0).toISOString();
}

function withinRetention(recordedAt: string, nowMs: number): boolean {
  const timestamp = Date.parse(recordedAt);
  return Number.isFinite(timestamp)
    && timestamp <= nowMs
    && nowMs - timestamp <= CONTEXTUAL_GUARD_AUDIT_RETENTION_MS;
}

function sameDecision(left: ContextualGuardAuditEvent, right: ContextualGuardAuditEvent): boolean {
  return left.route === right.route
    && left.outcome === right.outcome
    && left.reason === right.reason
    && left.category === right.category
    && left.rawProductivity === right.rawProductivity
    && left.finalProductivity === right.finalProductivity
    && left.evidenceCount === right.evidenceCount
    && left.matchConfidence === right.matchConfidence
    && left.soulRevision === right.soulRevision
    && left.currentDurationBucket === right.currentDurationBucket
    && left.promptVersion === right.promptVersion;
}

function readStoredEvents(storage: Storage): ContextualGuardAuditEvent[] {
  try {
    const raw = storage.getItem(CONTEXTUAL_GUARD_AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isContextualGuardAuditEvent) : [];
  } catch (error) {
    reportStorageFailure("read", error);
    return [];
  }
}

function isContextualGuardAuditEvent(value: unknown): value is ContextualGuardAuditEvent {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && typeof value.recordedAt === "string"
    && (value.route === "cloud" || value.route === "local")
    && (value.outcome === "applied" || value.outcome === "retained")
    && typeof value.reason === "string" && AUDIT_REASONS.has(value.reason as ContextualGuardAuditReason)
    && typeof value.category === "string" && AUDIT_CATEGORIES.has(value.category as ActivityCategory)
    && typeof value.rawProductivity === "string" && AUDIT_PRODUCTIVITY.has(value.rawProductivity as ProductivityLabel)
    && typeof value.finalProductivity === "string" && AUDIT_PRODUCTIVITY.has(value.finalProductivity as ProductivityLabel)
    && (value.rawConfidence === null || finiteStoredConfidence(value.rawConfidence))
    && finiteStoredConfidence(value.finalConfidence)
    && typeof value.evidenceCount === "number" && Number.isInteger(value.evidenceCount) && value.evidenceCount >= 0
    && (value.matchConfidence === "low" || value.matchConfidence === "medium" || value.matchConfidence === "high")
    && typeof value.soulRevision === "number" && Number.isInteger(value.soulRevision) && value.soulRevision >= 1
    && typeof value.currentDurationBucket === "string" && AUDIT_DURATION_BUCKETS.has(value.currentDurationBucket as ContextualGuardAuditEvent["currentDurationBucket"])
    && typeof value.promptVersion === "string" && value.promptVersion.length > 0 && value.promptVersion.length <= 80;
}

function finiteStoredConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportStorageFailure(operation: "read" | "write", error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Failed to ${operation} contextual guard audit log`, message);
}
