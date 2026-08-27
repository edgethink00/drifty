import type {
  ActivityCategory,
  ActivitySegment,
  CurrentActivitySnapshot,
  ProductivityLabel,
  SystemTransientActivity,
} from "@drifty/domain";
import type { LiveAiClassificationResult } from "../classification/aiClassificationService";
import type { DriftAlarmEvent } from "./driftAlarmEvent";
import { DRIFT_ALARM_CANDIDATE_PROBE_REASONS, type DriftAlarmCandidateProbeReason, type DriftAlarmCandidateProbeSummary } from "./driftAlarmCandidateProbeTypes";
import type { DriftAlarmCandidate } from "./driftAlarmData";
import type { DriftAlarmTrayResult } from "./driftAlarmTrayStatus";
import type { YouTubeDriftAlarmGateResult } from "./youtubeDriftAlarmGate";

export const DRIFT_ALARM_DEBUG_LOG_STORAGE_KEY = "drifty.notifications.driftAlarmDebugEvents.v1";
export const DRIFT_ALARM_DEBUG_LOG_RETENTION_MS = 5 * 60 * 1000;

const DRIFT_ALARM_DEBUG_LOG_LIMIT = 200;
const DIAGNOSTIC_TEXT_LIMIT = 240;
const DIAGNOSTIC_URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s<>"']+/gi;
const DIAGNOSTIC_ENCODED_URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,31}(?:%(?:25)?3a|:)(?:%(?:25)?2f|\/){2}[^\s<>"']+/gi;
const REDACTED_DIAGNOSTIC_URL = "[redacted-url]";

const DRIFT_ALARM_DEBUG_EVENT_KINDS = [
  "evaluation_skipped",
  "candidate_detected",
  "candidate_missing",
  "tray_status_published",
  "live_ai_candidate_detected",
  "live_ai_request_started",
  "live_ai_result",
  "live_ai_error",
  "youtube_gate_started",
  "youtube_gate_result",
  "youtube_gate_error",
  "fresh_candidate_result",
  "delivery_started",
  "delivery_suppressed",
  "delivery_delivered",
  "renderer_show_non_tauri",
  "native_show_requested",
  "native_show_succeeded",
  "native_show_failed",
  "native_show_queued",
  "native_show_duplicate",
  "native_notification_requested",
  "native_notification_failed",
  "extreme_nudge_started",
  "extreme_nudge_result",
  "extreme_nudge_error",
  "manual_correction_failed",
] as const;

const DRIFT_ALARM_DEBUG_AI_RESULT_KINDS = [
  "classified",
  "unavailable",
  "error",
  "allow_drift",
  "suppress",
  "skipped",
] as const;

export type DriftAlarmDebugEventKind = typeof DRIFT_ALARM_DEBUG_EVENT_KINDS[number];
export type DriftAlarmDebugAiResultKind = typeof DRIFT_ALARM_DEBUG_AI_RESULT_KINDS[number];

export type DriftAlarmDebugClassificationSummary = {
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
  readonly confidence: number | null;
  readonly source: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly classifiedAt: string | null;
};

export type DriftAlarmDebugSegmentSummary = {
  readonly id: string;
  readonly sourceSegmentId: string | null;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly browserName: string | null;
  readonly siteDomain: string | null;
  readonly youtubeVideoId: string | null;
  readonly youtubeIsShorts: boolean | null;
  readonly youtubeUrlPathKind: YouTubeUrlPathKind;
  readonly hasSiteContext: boolean;
  readonly siteSource: string | null;
  readonly browserAutomationStatus: string | null;
  readonly hasBrowserAutomationError: boolean;
  readonly frontmostCaptureSource?: string | null;
  readonly frontmostCaptureError?: string | null;
  readonly frontmostFallbackError?: string | null;
  readonly classification: DriftAlarmDebugClassificationSummary | null;
};

export type DriftAlarmDebugSnapshotSummary = {
  readonly observedAt: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly browserName: string | null;
  readonly siteDomain: string | null;
  readonly youtubeVideoId: string | null;
  readonly youtubeIsShorts: boolean | null;
  readonly youtubeUrlPathKind: YouTubeUrlPathKind;
  readonly hasSiteContext: boolean;
  readonly siteSource: string | null;
  readonly captureConfidence: number | null;
  readonly browserAutomationStatus: string | null;
  readonly hasBrowserAutomationError: boolean;
  readonly systemTransientActivity: SystemTransientActivity;
  readonly frontmostCaptureSource?: string | null;
  readonly frontmostCaptureError?: string | null;
  readonly frontmostFallbackError?: string | null;
  readonly source: string;
};

export type DriftAlarmDebugCandidateSummary = {
  readonly alertKey: string;
  readonly category: ActivityCategory;
  readonly sourceSegmentId: string | null;
  readonly segment: DriftAlarmDebugSegmentSummary;
};

export type DriftAlarmDebugAiSummary = {
  readonly resultKind: DriftAlarmDebugAiResultKind;
  readonly category: ActivityCategory | null;
  readonly productivity: ProductivityLabel | null;
  readonly confidence: number | null;
  readonly source: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly reason: string | null;
};

export type DriftAlarmDebugDeliverySummary = {
  readonly eventId: string;
  readonly mode: DriftAlarmEvent["mode"];
  readonly sourceSegmentId: string | null;
  readonly sourceSiteDomain: string | null;
  readonly sourceAppName: string;
};

export type DriftAlarmDebugTrayResultSummary = {
  readonly kind: DriftAlarmTrayResult["kind"];
  readonly reason: string | null;
  readonly hasCandidateDetail: boolean;
};

export type DriftAlarmDebugEvaluationSummary = {
  readonly selectedDay: string;
  readonly today: string;
  readonly hasCurrentSnapshot: boolean;
  readonly liveSegmentCount: number;
  readonly storedSegmentCount: number;
  readonly minimumDurationSeconds: number;
  readonly systemTransientActivity: SystemTransientActivity;
};

export type DriftAlarmDebugEvent = {
  readonly id: string;
  readonly recordedAt: string;
  readonly kind: DriftAlarmDebugEventKind;
  readonly alertKey: string | null;
  readonly result: string | null;
  readonly reason: string | null;
  readonly message: string | null;
  readonly segment: DriftAlarmDebugSegmentSummary | null;
  readonly currentSnapshot: DriftAlarmDebugSnapshotSummary | null;
  readonly candidate: DriftAlarmDebugCandidateSummary | null;
  readonly ai: DriftAlarmDebugAiSummary | null;
  readonly delivery: DriftAlarmDebugDeliverySummary | null;
  readonly trayResult: DriftAlarmDebugTrayResultSummary | null;
  readonly evaluation: DriftAlarmDebugEvaluationSummary | null;
  readonly candidateProbe: DriftAlarmCandidateProbeSummary | null;
};

export type DriftAlarmDebugEventInput = {
  readonly kind: DriftAlarmDebugEventKind;
  readonly recordedAt?: string;
  readonly alertKey?: string | null;
  readonly result?: string | null;
  readonly reason?: string | null;
  readonly message?: string | null;
  readonly segment?: DriftAlarmDebugSegmentSummary | null;
  readonly currentSnapshot?: DriftAlarmDebugSnapshotSummary | null;
  readonly candidate?: DriftAlarmDebugCandidateSummary | null;
  readonly ai?: DriftAlarmDebugAiSummary | null;
  readonly delivery?: DriftAlarmDebugDeliverySummary | null;
  readonly trayResult?: DriftAlarmDebugTrayResultSummary | null;
  readonly evaluation?: DriftAlarmDebugEvaluationSummary | null;
  readonly candidateProbe?: DriftAlarmCandidateProbeSummary | null;
};

export function recordDriftAlarmDebugEvent(
  input: DriftAlarmDebugEventInput,
  storage = browserStorage(),
  now = new Date(),
): DriftAlarmDebugEvent[] {
  if (!storage) return [];

  const event = normalizeDriftAlarmDebugEvent(input, now);
  const nextEvents = pruneRecentEvents([...readStoredDriftAlarmDebugEvents(storage), event], now.getTime()).slice(-DRIFT_ALARM_DEBUG_LOG_LIMIT);

  try {
    storage.setItem(DRIFT_ALARM_DEBUG_LOG_STORAGE_KEY, JSON.stringify(nextEvents));
  } catch (error) {
    reportDriftAlarmDebugStorageFailure("write", error);
  }

  return nextEvents;
}

export function readRecentDriftAlarmDebugEvents(
  storage = browserStorage(),
  nowMs = Date.now(),
): DriftAlarmDebugEvent[] {
  if (!storage) return [];
  return pruneRecentEvents(readStoredDriftAlarmDebugEvents(storage), nowMs).slice(-DRIFT_ALARM_DEBUG_LOG_LIMIT);
}

export function summarizeDriftAlarmCandidate(candidate: DriftAlarmCandidate): DriftAlarmDebugCandidateSummary {
  return {
    alertKey: candidate.alertKey,
    category: candidate.category,
    sourceSegmentId: normalizeText(candidate.sourceSegmentId),
    segment: summarizeDriftAlarmSegment(candidate.segment, candidate.sourceSegmentId),
  };
}

export function summarizeDriftAlarmSegment(segment: ActivitySegment, sourceSegmentId: string | null = null): DriftAlarmDebugSegmentSummary {
  return {
    id: segment.id,
    sourceSegmentId: normalizeText(sourceSegmentId),
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    durationSeconds: segment.durationSeconds,
    appName: segment.appName,
    bundleId: normalizeText(segment.bundleId),
    browserName: normalizeText(segment.browserName),
    siteDomain: normalizeText(segment.siteDomain),
    youtubeVideoId: normalizeText(segment.youtubeVideoId),
    youtubeIsShorts: segment.youtubeIsShorts ?? null,
    youtubeUrlPathKind: youtubeUrlPathKind(segment),
    hasSiteContext: hasSiteContext(segment),
    siteSource: normalizeText(segment.siteSource),
    browserAutomationStatus: normalizeText(segment.browserAutomationStatus),
    hasBrowserAutomationError: Boolean(segment.browserAutomationError?.trim()),
    frontmostCaptureSource: normalizeText(segment.frontmostCaptureSource),
    frontmostCaptureError: normalizeDiagnosticText(segment.frontmostCaptureError),
    frontmostFallbackError: normalizeDiagnosticText(segment.frontmostFallbackError),
    classification: segment.classification
      ? {
          category: segment.classification.category,
          productivity: segment.classification.productivity,
          confidence: finiteNumberOrNull(segment.classification.confidence),
          source: normalizeText(segment.classification.source),
          model: normalizeText(segment.classification.model),
          promptVersion: normalizeText(segment.classification.promptVersion),
          classifiedAt: normalizeText(segment.classification.classifiedAt),
        }
      : null,
  };
}

export function summarizeDriftAlarmSnapshot(snapshot: CurrentActivitySnapshot | null): DriftAlarmDebugSnapshotSummary | null {
  if (!snapshot) return null;

  return {
    observedAt: snapshot.observedAt,
    appName: snapshot.appName,
    bundleId: normalizeText(snapshot.bundleId),
    browserName: normalizeText(snapshot.browserName),
    siteDomain: normalizeText(snapshot.siteDomain),
    youtubeVideoId: normalizeText(snapshot.youtubeVideoId),
    youtubeIsShorts: snapshot.youtubeIsShorts ?? null,
    youtubeUrlPathKind: youtubeUrlPathKind(snapshot),
    hasSiteContext: hasSiteContext(snapshot),
    siteSource: normalizeText(snapshot.siteSource),
    captureConfidence: finiteNumberOrNull(snapshot.captureConfidence),
    browserAutomationStatus: normalizeText(snapshot.browserAutomationStatus),
    hasBrowserAutomationError: Boolean(snapshot.browserAutomationError?.trim()),
    systemTransientActivity: snapshot.systemTransientActivity ?? null,
    frontmostCaptureSource: normalizeText(snapshot.frontmostCaptureSource),
    frontmostCaptureError: normalizeDiagnosticText(snapshot.frontmostCaptureError),
    frontmostFallbackError: normalizeDiagnosticText(snapshot.frontmostFallbackError),
    source: snapshot.source,
  };
}

export function summarizeLiveAiClassificationResult(result: LiveAiClassificationResult): DriftAlarmDebugAiSummary {
  switch (result.kind) {
    case "classified":
      return {
        resultKind: "classified",
        category: result.classification.category,
        productivity: result.classification.productivity,
        confidence: finiteNumberOrNull(result.classification.confidence),
        source: normalizeText(result.classification.source),
        model: normalizeText(result.classification.model),
        promptVersion: normalizeText(result.classification.promptVersion),
        reason: null,
      };
    case "unavailable":
      return {
        resultKind: "unavailable",
        category: null,
        productivity: null,
        confidence: null,
        source: null,
        model: null,
        promptVersion: null,
        reason: normalizeDiagnosticText(result.reason),
      };
    default:
      return assertNever(result);
  }
}

export function summarizeYouTubeDriftAlarmGateResult(result: YouTubeDriftAlarmGateResult): DriftAlarmDebugAiSummary {
  return {
    resultKind: result.kind,
    category: null,
    productivity: null,
    confidence: null,
    source: null,
    model: null,
    promptVersion: null,
    reason: normalizeDiagnosticText(result.reason),
  };
}

export function summarizeDriftAlarmEvent(event: DriftAlarmEvent): DriftAlarmDebugDeliverySummary {
  return {
    eventId: event.id,
    mode: event.mode,
    sourceSegmentId: normalizeText(event.sourceSegmentId),
    sourceSiteDomain: normalizeText(event.sourceSiteDomain),
    sourceAppName: event.sourceAppName,
  };
}

export function summarizeDriftAlarmTrayResult(result: DriftAlarmTrayResult): DriftAlarmDebugTrayResultSummary {
  return {
    kind: result.kind,
    reason: result.kind === "suppressed" || result.kind === "deferred" || result.kind === "error"
      ? normalizeDiagnosticText(result.reason)
      : null,
    hasCandidateDetail: "candidateDetail" in result && Boolean(result.candidateDetail?.trim()),
  };
}

export function buildDriftAlarmDebugEvaluationSummary(input: {
  readonly selectedDay: string;
  readonly today: string;
  readonly currentSnapshot: CurrentActivitySnapshot | null;
  readonly liveSegmentCount: number;
  readonly storedSegmentCount: number;
  readonly minimumDurationSeconds: number;
}): DriftAlarmDebugEvaluationSummary {
  return {
    selectedDay: input.selectedDay,
    today: input.today,
    hasCurrentSnapshot: input.currentSnapshot !== null,
    liveSegmentCount: input.liveSegmentCount,
    storedSegmentCount: input.storedSegmentCount,
    minimumDurationSeconds: input.minimumDurationSeconds,
    systemTransientActivity: input.currentSnapshot?.systemTransientActivity ?? null,
  };
}

function readStoredDriftAlarmDebugEvents(storage: Storage): DriftAlarmDebugEvent[] {
  try {
    const rawValue = storage.getItem(DRIFT_ALARM_DEBUG_LOG_STORAGE_KEY);
    if (!rawValue) return [];
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDriftAlarmDebugEvent);
  } catch (error) {
    reportDriftAlarmDebugStorageFailure("read", error);
    return [];
  }
}

function normalizeDriftAlarmDebugEvent(input: DriftAlarmDebugEventInput, now: Date): DriftAlarmDebugEvent {
  const recordedAt = normalizeRecordedAt(input.recordedAt, now);
  return {
    id: `${recordedAt}:${input.kind}:${Math.random().toString(36).slice(2, 10)}`,
    recordedAt,
    kind: input.kind,
    alertKey: normalizeText(input.alertKey),
    result: normalizeDiagnosticText(input.result),
    reason: normalizeDiagnosticText(input.reason),
    message: normalizeDiagnosticText(input.message),
    segment: input.segment ?? null,
    currentSnapshot: input.currentSnapshot ?? null,
    candidate: input.candidate ?? null,
    ai: input.ai ?? null,
    delivery: input.delivery ?? null,
    trayResult: input.trayResult ?? null,
    evaluation: input.evaluation ?? null,
    candidateProbe: input.candidateProbe ?? null,
  };
}

function pruneRecentEvents(events: readonly DriftAlarmDebugEvent[], nowMs: number): DriftAlarmDebugEvent[] {
  const cutoffMs = nowMs - DRIFT_ALARM_DEBUG_LOG_RETENTION_MS;
  return events.filter((event) => {
    const recordedAtMs = new Date(event.recordedAt).getTime();
    return Number.isFinite(recordedAtMs) && recordedAtMs >= cutoffMs && recordedAtMs <= nowMs + 1_000;
  });
}

function hasSiteContext(surface: ActivitySegment | CurrentActivitySnapshot): boolean {
  return Boolean(surface.siteDomain?.trim() || surface.siteUrl?.trim() || surface.youtubeVideoId?.trim());
}

/**
 * Shape of a YouTube URL path, without the URL itself.
 *
 * Shorts classification keys off the first path segment, so a diagnosis needs
 * to know which shape was captured. Logging the raw `siteUrl` would put full
 * browsing URLs into an exportable file, so record only the discriminator the
 * classifier actually reads.
 */
export type YouTubeUrlPathKind =
  | "shorts"
  | "watch"
  | "embed"
  | "live"
  | "root"
  | "other"
  | "missing_url"
  | "unparsable"
  | "not_youtube";

export function youtubeUrlPathKind(surface: Pick<ActivitySegment, "siteDomain" | "siteUrl">): YouTubeUrlPathKind {
  const rawUrl = surface.siteUrl?.trim();
  const domain = surface.siteDomain?.trim()?.toLowerCase().replace(/^www\./, "");
  const youtubeDomains = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
  if (!rawUrl) return domain && youtubeDomains.has(domain) ? "missing_url" : "not_youtube";

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "unparsable";
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!youtubeDomains.has(host)) return "not_youtube";

  const [firstPart] = parsed.pathname.split("/").filter(Boolean);
  if (!firstPart) return "root";
  if (firstPart === "shorts") return "shorts";
  if (firstPart === "embed") return "embed";
  if (firstPart === "live") return "live";
  if (firstPart === "watch") return "watch";
  return "other";
}

function normalizeRecordedAt(value: string | undefined, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return fallback.toISOString();
  return new Date(timestamp).toISOString();
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeDiagnosticText(value: string | null | undefined): string | null {
  const redacted = value
    ?.replace(DIAGNOSTIC_URL_PATTERN, REDACTED_DIAGNOSTIC_URL)
    .replace(DIAGNOSTIC_ENCODED_URL_PATTERN, REDACTED_DIAGNOSTIC_URL);
  const normalized = normalizeText(redacted);
  if (!normalized) return null;
  return normalized.length > DIAGNOSTIC_TEXT_LIMIT
    ? `${normalized.slice(0, DIAGNOSTIC_TEXT_LIMIT - 3)}...`
    : normalized;
}

function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function reportDriftAlarmDebugStorageFailure(operation: "read" | "write", error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Failed to ${operation} drift alarm debug log`, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isDebugEventKind(value: unknown): value is DriftAlarmDebugEventKind {
  return typeof value === "string" && DRIFT_ALARM_DEBUG_EVENT_KINDS.some((kind) => kind === value);
}

function isDebugAiResultKind(value: unknown): value is DriftAlarmDebugAiResultKind {
  return typeof value === "string" && DRIFT_ALARM_DEBUG_AI_RESULT_KINDS.some((kind) => kind === value);
}

function isDriftAlarmDebugEvent(value: unknown): value is DriftAlarmDebugEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.recordedAt === "string"
    && isDebugEventKind(value.kind)
    && isNullableString(value.alertKey)
    && isNullableString(value.result)
    && isNullableString(value.reason)
    && isNullableString(value.message)
    && isNullableSegmentSummary(value.segment)
    && isNullableSnapshotSummary(value.currentSnapshot)
    && isNullableCandidateSummary(value.candidate)
    && isNullableAiSummary(value.ai)
    && isNullableDeliverySummary(value.delivery)
    && isNullableTrayResultSummary(value.trayResult)
    && isNullableEvaluationSummary(value.evaluation)
    && isNullableCandidateProbeSummary(value.candidateProbe ?? null);
}

function isNullableSegmentSummary(value: unknown): value is DriftAlarmDebugSegmentSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && isNullableString(value.sourceSegmentId)
    && typeof value.startedAt === "string"
    && typeof value.endedAt === "string"
    && typeof value.durationSeconds === "number"
    && typeof value.appName === "string"
    && isNullableString(value.bundleId)
    && isNullableString(value.browserName)
    && isNullableString(value.siteDomain)
    && isNullableString(value.youtubeVideoId)
    && typeof value.hasSiteContext === "boolean"
    && isNullableString(value.siteSource)
    && isNullableString(value.browserAutomationStatus)
    && typeof value.hasBrowserAutomationError === "boolean"
    && isOptionalNullableString(value.frontmostCaptureSource)
    && isOptionalNullableString(value.frontmostCaptureError)
    && isOptionalNullableString(value.frontmostFallbackError)
    && isNullableClassificationSummary(value.classification);
}

function isNullableClassificationSummary(value: unknown): value is DriftAlarmDebugClassificationSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.category === "string"
    && typeof value.productivity === "string"
    && isNullableNumber(value.confidence)
    && isNullableString(value.source)
    && isNullableString(value.model)
    && isNullableString(value.promptVersion)
    && isNullableString(value.classifiedAt);
}

function isNullableSnapshotSummary(value: unknown): value is DriftAlarmDebugSnapshotSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.observedAt === "string"
    && typeof value.appName === "string"
    && isNullableString(value.bundleId)
    && isNullableString(value.browserName)
    && isNullableString(value.siteDomain)
    && isNullableString(value.youtubeVideoId)
    && typeof value.hasSiteContext === "boolean"
    && isNullableString(value.siteSource)
    && isNullableNumber(value.captureConfidence)
    && isNullableString(value.browserAutomationStatus)
    && typeof value.hasBrowserAutomationError === "boolean"
    && (typeof value.systemTransientActivity === "string" || value.systemTransientActivity === null)
    && isOptionalNullableString(value.frontmostCaptureSource)
    && isOptionalNullableString(value.frontmostCaptureError)
    && isOptionalNullableString(value.frontmostFallbackError)
    && typeof value.source === "string";
}

function isNullableCandidateSummary(value: unknown): value is DriftAlarmDebugCandidateSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.alertKey === "string"
    && typeof value.category === "string"
    && isNullableString(value.sourceSegmentId)
    && isNullableSegmentSummary(value.segment)
    && value.segment !== null;
}

function isNullableAiSummary(value: unknown): value is DriftAlarmDebugAiSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return isDebugAiResultKind(value.resultKind)
    && (typeof value.category === "string" || value.category === null)
    && (typeof value.productivity === "string" || value.productivity === null)
    && isNullableNumber(value.confidence)
    && isNullableString(value.source)
    && isNullableString(value.model)
    && isNullableString(value.promptVersion)
    && isNullableString(value.reason);
}

function isNullableDeliverySummary(value: unknown): value is DriftAlarmDebugDeliverySummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.eventId === "string"
    && (value.mode === "drift" || value.mode === "break_return")
    && isNullableString(value.sourceSegmentId)
    && isNullableString(value.sourceSiteDomain)
    && typeof value.sourceAppName === "string";
}

function isNullableTrayResultSummary(value: unknown): value is DriftAlarmDebugTrayResultSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.kind === "string"
    && isNullableString(value.reason)
    && typeof value.hasCandidateDetail === "boolean";
}

function isNullableEvaluationSummary(value: unknown): value is DriftAlarmDebugEvaluationSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.selectedDay === "string"
    && typeof value.today === "string"
    && typeof value.hasCurrentSnapshot === "boolean"
    && typeof value.liveSegmentCount === "number"
    && typeof value.storedSegmentCount === "number"
    && typeof value.minimumDurationSeconds === "number"
    && (typeof value.systemTransientActivity === "string" || value.systemTransientActivity === null);
}

function isNullableCandidateProbeSummary(value: unknown): value is DriftAlarmCandidateProbeSummary | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return isCandidateProbeReason(value.reason)
    && isNullableSegmentSummary(value.latestSegment)
    && isNullableSegmentSummary(value.activeSegment)
    && (typeof value.identityMatched === "boolean" || value.identityMatched === null)
    && isNullableNumber(value.candidateDurationSeconds)
    && typeof value.minimumDurationSeconds === "number"
    && isNullableClassificationSummary(value.classification)
    && typeof value.liveAiAvailable === "boolean"
    && (typeof value.systemTransientActivity === "string" || value.systemTransientActivity === null);
}

function isCandidateProbeReason(value: unknown): value is DriftAlarmCandidateProbeReason {
  return typeof value === "string" && DRIFT_ALARM_CANDIDATE_PROBE_REASONS.some((reason) => reason === value);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected drift alarm debug log value: ${JSON.stringify(value)}`);
}
