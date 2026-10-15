import { browserContentCluesForSegment, normalizeBrowserContentClues } from "@drifty/domain";
import { ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD, enhancedRetryImproves, retryEvidenceForRecord } from "./enhancedContextRetryPolicy";
import { applyLiveShoppingEvidenceGuard, applyMatchedContextualDriftSafetyGuard, classifyActivityDetailed, confidenceForResolvedLiveActivityProductivity, isYouTubeBrowsePage, isYouTubeVideoSegment, LIVE_ACTIVITY_INTENTS, MATCHED_CONTEXTUAL_DRIFT_SAFETY_REASON, productivityForLiveActivityIntent, resolveLiveActivityClassificationProductivity, YOUTUBE_FEED_DRIFT_MINIMUM_SECONDS } from "@drifty/domain";
import { isExcludedSegment } from "@drifty/domain";
import type {
  AdaptiveContentContext,
  ActivityCategory,
  ActivityClassificationRecord,
  ActivitySegment,
  ClassificationMetrics,
  LiveActivityIntent,
  LiveClassificationMemoryContext,
  LiveClassificationPromptItem,
  UnclassifiedSegmentsQuery,
  ProductivityLabel,
} from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { readUserOnboardingState } from "../onboarding/onboardingState";
import { cloudApiClientMetadata } from "../../lib/cloudContract";
import { supabase } from "../../lib/supabase/client";
import { withCloudDevicePayload } from "../cloud-devices/cloudDeviceIdentity";
import { saveLiveClassificationIfRequested } from "./liveAiClassificationPersistence";
import {
  invokeOpenAiChatWithManagedLocalRetry,
  type NativeOpenAiChatResponse,
} from "./managedLocalAiChat";
import {
  buildProviderSafeEnhancedContext,
  enhancedContextRetryEligibility,
  type ContentContextEgressSummary,
} from "./contentContextEgressPolicy";
import { MANAGED_LOCAL_AI_CLASSIFICATION_MAX_BATCH_SIZE, MANAGED_LOCAL_AI_CLASSIFICATION_MAX_MEMORY_BYTES, MANAGED_LOCAL_AI_CLASSIFICATION_MAX_PROMPT_BYTES, toLocalProviderEnhancedRetryRequest, toLocalProviderRequest, type LocalAiProviderConfig, type LocalAiProviderEnhancedRetryRequestInput, type LocalAiProviderRequest, type MinimizedActivityPayload } from "./localAiProviderRequest";
import { normalizeOnboardingWorkProfile } from "./classificationWorkProfile";
import { readAiPrivacyRequestSettings, type AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { resolveInitialDevModeEnabled, resolveInitialEnhancedContextSettings } from "../settings/settingsStorage";
import { recordEnhancedContextDebugEvent, type EnhancedContextDebugReason, type EnhancedContextDebugStatus } from "../settings/debugLog";
import { withClassificationActivity } from "./classificationActivity";
import {
  buildClassificationMemoryContext,
  classificationMemoryFingerprintMaterial,
  memoryContextForItems,
} from "./classificationMemoryContext";
import { recordContextualGuardAuditEvent } from "./contextualGuardAuditLog";
import {
  openRouterConnectionFailureMessage,
  openRouterEmbeddedIssueKind,
  openRouterIssueKindFromResponse,
} from "../ai-connection/openRouterError";
import type { AiConnectionIssueKind } from "../ai-connection/aiConnectionHealth";
import {
  cloudAiBackoffMessage,
  cloudAiRequestBackoffs,
  type CloudAiBackoffStatus,
} from "./cloudAiRequestBackoff";
import {
  describeLocalAiClassificationFailure,
  localAiInvalidResponseError,
  localAiProviderResponseError,
  localAiTransportError,
  shouldRetryLocalAiWithSmallerBatch,
} from "./localAiClassificationFailure";

export { describeLocalAiClassificationFailure } from "./localAiClassificationFailure";

const EDGE_MAX_BATCH_SIZE = 20;
const DEFAULT_BATCH_SIZE = EDGE_MAX_BATCH_SIZE;
const CLOUD_CLASSIFICATION_BODY_TARGET_BYTES = 28_000;
// A stalled Edge request must release the first-day single-flight slot so its
// background pass can retry without requiring an app restart.
const CLOUD_CLASSIFICATION_REQUEST_TIMEOUT_MS = 60_000;
const CLOUD_ERROR_BODY_MAX_BYTES = 64 * 1024;
export const AI_CLASSIFICATION_BACKGROUND_THRESHOLD = 20;
export const AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD = 5;
export const AI_CLASSIFICATION_FOCUSED_IDLE_MS = 20 * 60 * 1000;
const MAX_CLASSIFY_ALL_BATCHES = 100;
const MAX_TEXT_LENGTH = 160;
const MAX_YOUTUBE_CHANNEL_NAME_LENGTH = 120;
const MAX_YOUTUBE_CATEGORY_LENGTH = 80;
export const AI_CLASSIFICATION_PROMPT_VERSION = "v8.3-browser-clues";
const MAX_ENHANCED_CONTEXT_RETRY_FINGERPRINTS = 512;
const YOUTUBE_BROWSE_INHERITANCE_WINDOW_MS = 3 * 60 * 1000;
const YOUTUBE_BROWSE_INHERITANCE_MAX_CONFIDENCE = 0.85;
const REDDIT_COMMUNITY_PATTERN = /\br\/([A-Za-z0-9_]{2,32})\b/i;
const REDDIT_DOMAIN_PATTERN = /(^|\.)reddit\.com$/i;
const VALID_REDDIT_COMMUNITY_PATTERN = /^[a-z0-9_]{2,32}$/;
const KNOWN_BROWSER_APP_NAMES = new Set(["arc", "brave browser", "chromium", "firefox", "google chrome", "google chrome canary", "microsoft edge", "safari"]);
const KNOWN_BROWSER_BUNDLE_IDS = new Set(["com.apple.safari", "com.brave.browser", "com.google.chrome", "com.google.chrome.canary", "com.microsoft.edgemac", "company.thebrowser.browser", "org.chromium.chromium", "org.mozilla.firefox"]);
const SYSTEM_SURFACE_APP_NAMES = new Set(["loginwindow", "screensaverengine", "lockscreen", "windowserver"]);
const BLANK_BROWSER_DOMAINS = new Set(["newtab", "about:blank"]);
const BLANK_BROWSER_TITLE_PATTERN = /^(?:new tab|새 탭|about:blank|untitled|제목 없음|무제)(?:\s+[-—–]|$)|(?:^|[-—–]\s+)(?:시작 페이지|start page)$/;

const AI_MODEL_TOKEN_PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gemini-3.1-flash-lite": { input: 0, output: 0 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "deepseek/deepseek-v4-flash:free": { input: 0, output: 0 },
  "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28 },
};

const ACTIVITY_CATEGORIES = new Set<ActivityCategory>([
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
]);

const PRODUCTIVITY_LABELS = new Set<ProductivityLabel>(["focus", "neutral", "drift"]);
const LIVE_INTENTS = new Set<LiveActivityIntent>(LIVE_ACTIVITY_INTENTS);
const enhancedContextRetriedFingerprints = new Set<string>();
const enhancedContextRetriedFingerprintOrder: string[] = [];

type EdgeClassification = {
  id?: unknown;
  segmentId?: unknown;
  inputFingerprint?: unknown;
  category?: unknown;
  intent?: unknown;
  productivity?: unknown;
  confidence?: unknown;
  reason?: unknown;
  model?: unknown;
  contextualGuardAudit?: unknown;
};

type EdgeClassificationResponse = {
  results?: unknown;
  classifications?: unknown;
  model?: unknown;
  latencyMs?: unknown;
  resultLatencyMsById?: unknown;
};

// Granularity of AI classification:
// - "fine"  : classify every unknown segment individually (most accurate).
// - "normal": classify one representative per (app + domain + title) signature, then apply
//             it to all segments sharing that signature. ~fine accuracy, fewer calls.
// - "coarse": one representative per app + domain (fastest, loses per-page nuance).
export type ClassificationLevel = "fine" | "normal" | "coarse";

export type AiClassificationRunOptions = {
  localProvider?: LocalAiProviderConfig | null;
  persistLiveResult?: boolean;
  level?: ClassificationLevel;
  contextSegments?: readonly ActivitySegment[];
  /** Only persist deterministic/cache-only batches while the selected provider is known ready. */
  allowProviderlessPersistence?: boolean;
  /** Revalidate the selected provider immediately before committing a completed batch. */
  persistenceAllowed?: () => boolean;
  /** User-initiated retries may probe immediately after account/device recovery. */
  bypassCloudRequestBackoff?: boolean;
  /** Bounded first-day diagnostics; never receives activity, request bodies, or provider text. */
  onCloudRequestTiming?: (phase: "started" | "settled", elapsedMs: number) => void;
  /**
   * Local UI signal: the ids of the segments this batch is about to send to the AI provider, so the
   * first-day screen can name what is being read. It runs on this device only and is never forwarded
   * to analytics or the provider.
   */
  onProviderBatchStart?: (segmentIds: readonly string[]) => void;
};

type CloudAiClassificationAccess =
  | { readonly kind: "allowed"; readonly requestKey: string }
  | { readonly kind: "blocked"; readonly summary: AiClassificationSummary };

type CloudAiRequestContext = {
  readonly requestKey: string;
  readonly bypassBackoff: boolean;
  readonly onRequestTiming?: AiClassificationRunOptions["onCloudRequestTiming"];
};

type ClassificationCluster = {
  readonly representatives: MinimizedActivityPayload[];
  /** Group members keyed by their representative's segmentId; null for "fine" (no clustering). */
  readonly membersByRepSegmentId: Map<string, MinimizedActivityPayload[]> | null;
};

function classificationSignatureKey(payload: MinimizedActivityPayload, level: ClassificationLevel): string {
  const app = (payload.bundleId ?? payload.appName).toLowerCase().trim();
  const domain = (payload.siteDomain ?? hostnameFromUrl(payload.siteUrl) ?? "").toLowerCase().trim();
  const context = JSON.stringify([payload.contextFingerprint ?? "", payload.browserContext ?? null]);
  if (level === "coarse") return `${app}|${domain}|${context}`;
  const rawTitle = (payload.siteTitle ?? payload.youtubeTitle ?? payload.windowTitle ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const titleStem = rawTitle.split(" ").slice(0, 3).join(" ");
  return `${app}|${domain}|${titleStem}|${context}`;
}

export function clusterPayloadsByLevel(misses: MinimizedActivityPayload[], level: ClassificationLevel): ClassificationCluster {
  if (level === "fine" || misses.length === 0) {
    return { representatives: misses, membersByRepSegmentId: null };
  }
  const groups = new Map<string, MinimizedActivityPayload[]>();
  for (const item of misses) {
    const key = classificationSignatureKey(item, level);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  const representatives: MinimizedActivityPayload[] = [];
  const membersByRepSegmentId = new Map<string, MinimizedActivityPayload[]>();
  for (const members of groups.values()) {
    const representative = members[0];
    representatives.push(representative);
    membersByRepSegmentId.set(representative.segmentId, members);
  }
  return { representatives, membersByRepSegmentId };
}

// Fan a representative's classification out to every segment that shares its signature.
export function expandClusterRecords(
  representativeRecords: ActivityClassificationRecord[],
  membersByRepSegmentId: Map<string, MinimizedActivityPayload[]> | null,
): ActivityClassificationRecord[] {
  if (!membersByRepSegmentId) return representativeRecords;
  const expanded: ActivityClassificationRecord[] = [];
  for (const record of representativeRecords) {
    const members = membersByRepSegmentId.get(record.segmentId);
    if (!members) {
      expanded.push(record);
      continue;
    }
    for (const member of members) {
      expanded.push({ ...record, segmentId: member.segmentId, inputFingerprint: member.inputFingerprint });
    }
  }
  return expanded;
}

export type LiveAiClassificationResult =
  | { kind: "classified"; classification: ActivityClassificationRecord }
  | { kind: "unavailable"; reason: string };

type OpenAiChatResponse = {
  choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
};

type AiClassificationUsageRow = {
  usage_date?: string | null;
  model?: string | null;
  requests_count?: number | null;
  llm_requests_count?: number | null;
  items_requested?: number | null;
  cache_hits?: number | null;
  cache_misses?: number | null;
  errors_count?: number | null;
  quota_errors_count?: number | null;
  config_errors_count?: number | null;
  request_errors_count?: number | null;
  parse_errors_count?: number | null;
  schema_errors_count?: number | null;
  last_error_type?: string | null;
  last_error_message?: string | null;
  last_error_status?: number | null;
  last_error_at?: string | null;
  latency_ms_total?: number | null;
  prompt_tokens?: number | null;
  response_tokens?: number | null;
};

export type AiClassificationStatus = "disabled" | "idle" | "running" | "saved" | "empty" | "error";

// "transport" — no provider response completed (fetch/timeout and Cloud
// invocation failures).
// "quota" — Cloud answered with an account/provider quota response.
// "content" — the provider responded but the result was unusable. Local
// connection health uses separate evidence because malformed 2xx content is
// reachable while authentication/model/provider HTTP errors are not usable.
export type AiClassificationFailureKind = "transport" | "quota" | "content";
export type AiClassificationQuotaWindow = "minute" | "hour" | "day" | "unknown";
export type AiClassificationCloudErrorType = "quota" | "config" | "request" | "parse" | "schema";

export interface AiClassificationSummary {
  status: AiClassificationStatus;
  selectedSegments: number;
  savedRecords: number;
  message: string;
  metrics?: ClassificationMetrics;
  failureKind?: AiClassificationFailureKind;
  quotaWindow?: AiClassificationQuotaWindow;
  serverErrorType?: AiClassificationCloudErrorType;
  // Structured cause when the provider rejected the request. Carried here so
  // telemetry reads the value the transport already computed instead of
  // re-deriving a coarser one by matching the message text.
  issueKind?: AiConnectionIssueKind;
  // True only when this run completed a real provider round-trip; summaries
  // satisfied purely by deterministic rules or reused classifications carry no
  // evidence about provider connectivity.
  usedAiProvider?: boolean;
}

export interface AiClassificationUsageSummary {
  requests: number;
  llmRequests: number;
  itemsRequested: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  quotaErrors: number;
  configErrors: number;
  requestErrors: number;
  parseErrors: number;
  schemaErrors: number;
  lastErrorType: string | null;
  lastErrorMessage: string | null;
  lastErrorStatus: number | null;
  lastErrorAt: string | null;
  latencyMsTotal: number;
  averageLatencyMs: number;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface AiClassificationCostProjection {
  processedItems: number;
  candidateItems: number;
  multiplier: number;
  measuredCostUsd: number;
  dailyProjectedCostUsd: number;
  monthlyProjectedCostUsd: number;
}

export function projectAiClassificationCost(
  usage: AiClassificationUsageSummary | null | undefined,
  metrics: ClassificationMetrics | null | undefined,
): AiClassificationCostProjection {
  const processedItems = usage?.itemsRequested ?? 0;
  const candidateItems = metrics?.totalSegments ?? 0;
  const measuredCostUsd = usage?.estimatedCostUsd ?? 0;
  const multiplier = processedItems > 0 && candidateItems > 0 ? candidateItems / processedItems : 0;
  const dailyProjectedCostUsd = processedItems > 0 && candidateItems > 0 ? measuredCostUsd * multiplier : 0;

  return {
    processedItems,
    candidateItems,
    multiplier,
    measuredCostUsd,
    dailyProjectedCostUsd,
    monthlyProjectedCostUsd: dailyProjectedCostUsd * 30,
  };
}

export function diffAiClassificationUsageSummary(
  before: AiClassificationUsageSummary | null | undefined,
  after: AiClassificationUsageSummary | null | undefined,
): AiClassificationUsageSummary {
  const requests = positiveDelta(after?.requests, before?.requests);
  const errors = positiveDelta(after?.errors, before?.errors);
  const latencyMsTotal = positiveDelta(after?.latencyMsTotal, before?.latencyMsTotal);

  return {
    requests,
    llmRequests: positiveDelta(after?.llmRequests, before?.llmRequests),
    itemsRequested: positiveDelta(after?.itemsRequested, before?.itemsRequested),
    cacheHits: positiveDelta(after?.cacheHits, before?.cacheHits),
    cacheMisses: positiveDelta(after?.cacheMisses, before?.cacheMisses),
    errors,
    quotaErrors: positiveDelta(after?.quotaErrors, before?.quotaErrors),
    configErrors: positiveDelta(after?.configErrors, before?.configErrors),
    requestErrors: positiveDelta(after?.requestErrors, before?.requestErrors),
    parseErrors: positiveDelta(after?.parseErrors, before?.parseErrors),
    schemaErrors: positiveDelta(after?.schemaErrors, before?.schemaErrors),
    lastErrorType: errors > 0 ? after?.lastErrorType ?? null : null,
    lastErrorMessage: errors > 0 ? after?.lastErrorMessage ?? null : null,
    lastErrorStatus: errors > 0 ? after?.lastErrorStatus ?? null : null,
    lastErrorAt: errors > 0 ? after?.lastErrorAt ?? null : null,
    latencyMsTotal,
    averageLatencyMs: requests > 0 ? Math.round(latencyMsTotal / requests) : 0,
    promptTokens: positiveDelta(after?.promptTokens, before?.promptTokens),
    responseTokens: positiveDelta(after?.responseTokens, before?.responseTokens),
    totalTokens: positiveDelta(after?.totalTokens, before?.totalTokens),
    estimatedCostUsd: positiveDelta(after?.estimatedCostUsd, before?.estimatedCostUsd),
  };
}

// A display hint must never be able to fail the batch it describes.
function notifyProviderBatchStart(options: AiClassificationRunOptions, representatives: readonly MinimizedActivityPayload[]): void {
  if (!options.onProviderBatchStart || representatives.length === 0) return;
  try {
    options.onProviderBatchStart(representatives.map((item) => item.segmentId));
  } catch {
    // ignored: the batch continues regardless of the screen
  }
}

export async function runAiClassification(query: UnclassifiedSegmentsQuery, batchSize = DEFAULT_BATCH_SIZE, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  return withClassificationActivity(
    () => runAiClassificationImpl(query, batchSize, options),
    (summary) => summary.metrics?.unclassifiedSegments ?? null,
  );
}

async function runAiClassificationImpl(query: UnclassifiedSegmentsQuery, batchSize = DEFAULT_BATCH_SIZE, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  const selectedBatchSize = Math.min(query.limit ?? batchSize, EDGE_MAX_BATCH_SIZE);
  const segments = (await trackerClient.getUnclassifiedSegments({
    ...query,
    limit: selectedBatchSize,
  })).slice(0, selectedBatchSize);
  const privacySettings = readAiPrivacyRequestSettings();
  const promptIdentity = privacySettings.optional.workProfile
    ? await readClassificationPromptIdentity(Boolean(options.localProvider))
    : { ownerId: null, workProfile: null };
  const workProfile = promptIdentity.workProfile;
  const memoryContext = await buildClassificationMemoryContext({
    items: segments,
    privacySettings,
    useLocalFallback: Boolean(options.localProvider),
    soulOwnerId: promptIdentity.ownerId,
    contextSegments: options.contextSegments,
    observePassiveLearning: options.allowProviderlessPersistence !== false,
  });
  const promptWorkProfile = memoryContext.soul ? null : workProfile;
  const payload = await Promise.all(segments.map((segment) => toMinimizedPayload(segment, promptWorkProfile, privacySettings, memoryContext)));

  if (payload.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "empty",
      selectedSegments: 0,
      savedRecords: 0,
      message: "No unclassified activity segments found.",
      metrics,
    };
  }

  const deterministicRecords = toDeterministicClassificationRecords(segments, payload);
  const deterministicSegmentIds = new Set(deterministicRecords.map((record) => record.segmentId));
  const inheritedResult = await collectInheritedYouTubeBrowseClassifications(segments, payload, deterministicSegmentIds);
  const browseFallbackResult = collectFallbackYouTubeBrowseClassifications(segments, payload, new Set<string>([...deterministicSegmentIds, ...inheritedResult.segmentIds]));
  const unknownPayload = payload.filter((item) => !deterministicSegmentIds.has(item.segmentId) && !inheritedResult.segmentIds.has(item.segmentId) && !browseFallbackResult.segmentIds.has(item.segmentId));
  const localRecords = [...deterministicRecords, ...inheritedResult.records, ...browseFallbackResult.records];

  if (unknownPayload.length === 0) {
    if (options.allowProviderlessPersistence === false) return await providerlessPersistenceDeferred(query);
    const saveResult = await saveClassificationBatch(localRecords, options.persistenceAllowed);
    if (!saveResult) return await providerlessPersistenceDeferred(query);
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "saved",
      selectedSegments: payload.length,
      savedRecords: saveResult.saved,
      message: `Saved ${saveResult.saved} local ${saveResult.saved === 1 ? "classification" : "classifications"}. No unknown segments needed AI.`,
      metrics,
    };
  }

  const reusableResult = await collectReusableAiClassifications(unknownPayload);
  if (reusableResult.misses.length === 0) {
    if (options.allowProviderlessPersistence === false) return await providerlessPersistenceDeferred(query);
    const saveResult = await saveClassificationBatch([...localRecords, ...reusableResult.records], options.persistenceAllowed);
    if (!saveResult) return await providerlessPersistenceDeferred(query);
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "saved",
      selectedSegments: payload.length,
      savedRecords: saveResult.saved,
      message: `Saved ${reusableResult.records.length} reused AI and ${localRecords.length} local ${saveResult.saved === 1 ? "classification" : "classifications"}.`,
      metrics,
    };
  }

  // Classify one representative per cluster (fine = per-segment), then fan the result
  // out to every segment sharing the representative's signature.
  const { representatives, membersByRepSegmentId } = clusterPayloadsByLevel(reusableResult.misses, options.level ?? "fine");

  if (options.localProvider) {
    notifyProviderBatchStart(options, representatives);
    return await runLocalAiClassification(query, payload.length, [...localRecords, ...reusableResult.records], representatives, membersByRepSegmentId, options.localProvider, promptWorkProfile, memoryContextForItems(memoryContext, representatives.map((item) => item.segmentId)), adaptiveContextBySegmentId(segments), options.persistenceAllowed);
  }

  const cloudAccess = await requireCloudAiClassification();
  if (cloudAccess.kind === "blocked") {
    return cloudAccess.summary;
  }
  const cloudClient = supabase;
  if (!cloudClient) {
    return { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Supabase is not configured." };
  }

  notifyProviderBatchStart(options, representatives);
  const aiRecords = expandClusterRecords(
    await classifyCloudPayloadBatches(cloudClient, representatives, workProfile, memoryContext, {
      requestKey: cloudAccess.requestKey,
      bypassBackoff: options.bypassCloudRequestBackoff === true,
      onRequestTiming: options.onCloudRequestTiming,
    }),
    membersByRepSegmentId,
  );
  if (aiRecords.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "error",
      selectedSegments: payload.length,
      savedRecords: 0,
      message: `AI classification returned no usable classifications for ${representatives.length} unknown ${representatives.length === 1 ? "segment" : "segments"}.`,
      metrics,
      failureKind: "content",
      usedAiProvider: true,
    };
  }

  const saveResult = await saveClassificationBatch([...localRecords, ...reusableResult.records, ...aiRecords], options.persistenceAllowed);
  if (!saveResult) return await providerlessPersistenceDeferred(query, true);
  const metrics = await trackerClient.getClassificationMetrics(query);
  return {
    status: "saved",
    selectedSegments: payload.length,
    savedRecords: saveResult.saved,
    message: `Saved ${aiRecords.length} AI, ${reusableResult.records.length} reused AI, and ${localRecords.length} local ${saveResult.saved === 1 ? "classification" : "classifications"}.`,
    metrics,
    usedAiProvider: true,
  };
}

export async function runAiClassificationForUnknownThreshold(query: UnclassifiedSegmentsQuery, threshold: number, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  return withClassificationActivity(
    () => runAiClassificationForUnknownThresholdImpl(query, threshold, options),
    (summary) => summary.metrics?.unclassifiedSegments ?? null,
  );
}

async function runAiClassificationForUnknownThresholdImpl(query: UnclassifiedSegmentsQuery, threshold: number, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  const selectedBatchSize = EDGE_MAX_BATCH_SIZE;
  const segments = (await trackerClient.getUnclassifiedSegments({ ...query, limit: selectedBatchSize })).slice(0, selectedBatchSize);
  const privacySettings = readAiPrivacyRequestSettings();
  const promptIdentity = privacySettings.optional.workProfile
    ? await readClassificationPromptIdentity(Boolean(options.localProvider))
    : { ownerId: null, workProfile: null };
  const workProfile = promptIdentity.workProfile;
  const memoryContext = await buildClassificationMemoryContext({
    items: segments,
    privacySettings,
    useLocalFallback: Boolean(options.localProvider),
    soulOwnerId: promptIdentity.ownerId,
    contextSegments: options.contextSegments,
    observePassiveLearning: options.allowProviderlessPersistence !== false,
  });
  const promptWorkProfile = memoryContext.soul ? null : workProfile;
  const payload = await Promise.all(segments.map((segment) => toMinimizedPayload(segment, promptWorkProfile, privacySettings, memoryContext)));
  const deterministicRecords = toDeterministicClassificationRecords(segments, payload);
  const deterministicSegmentIds = new Set(deterministicRecords.map((record) => record.segmentId));
  const inheritedResult = await collectInheritedYouTubeBrowseClassifications(segments, payload, deterministicSegmentIds);
  const browseFallbackResult = collectFallbackYouTubeBrowseClassifications(segments, payload, new Set<string>([...deterministicSegmentIds, ...inheritedResult.segmentIds]));
  const unknownPayload = payload
    .filter((item) => !deterministicSegmentIds.has(item.segmentId) && !inheritedResult.segmentIds.has(item.segmentId) && !browseFallbackResult.segmentIds.has(item.segmentId))
    .slice(0, threshold);
  const localRecords = [...deterministicRecords, ...inheritedResult.records, ...browseFallbackResult.records];

  const reusableResult = await collectReusableAiClassifications(unknownPayload);

  if (reusableResult.misses.length < threshold) {
    if (options.allowProviderlessPersistence === false) return await providerlessPersistenceDeferred(query);
    const saveResult = await saveClassificationBatch([...localRecords, ...reusableResult.records], options.persistenceAllowed);
    if (!saveResult) return await providerlessPersistenceDeferred(query);
    const metrics = await trackerClient.getClassificationMetrics(query);
    if (reusableResult.records.length > 0) {
      const remainingCandidates = reusableResult.misses.length;
      return {
        status: "saved",
        selectedSegments: localRecords.length + reusableResult.records.length,
        savedRecords: saveResult.saved,
        message: remainingCandidates > 0
          ? `Saved ${reusableResult.records.length} reused AI and ${localRecords.length} local ${saveResult.saved === 1 ? "classification" : "classifications"}. Only ${remainingCandidates} unknown AI classification ${remainingCandidates === 1 ? "candidate" : "candidates"} found; waiting for ${threshold}.`
          : `Saved ${reusableResult.records.length} reused AI and ${localRecords.length} local ${saveResult.saved === 1 ? "classification" : "classifications"}.`,
        metrics,
      };
    }

    return {
      status: localRecords.length > 0 ? "saved" : "empty",
      selectedSegments: deterministicRecords.length + inheritedResult.segmentIds.size,
      savedRecords: saveResult.saved,
      message: localRecords.length > 0
        ? `Saved ${localRecords.length} local ${localRecords.length === 1 ? "classification" : "classifications"}. Only ${reusableResult.misses.length} unknown AI classification ${reusableResult.misses.length === 1 ? "candidate" : "candidates"} found; waiting for ${threshold}.`
        : `Only ${reusableResult.misses.length} unknown AI classification ${reusableResult.misses.length === 1 ? "candidate" : "candidates"} found; waiting for ${threshold}.`,
      metrics,
    };
  }

  if (reusableResult.misses.length === 0) {
    const saveResult = await saveClassificationBatch([...localRecords, ...reusableResult.records], options.persistenceAllowed);
    if (!saveResult) return await providerlessPersistenceDeferred(query);
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "saved",
      selectedSegments: unknownPayload.length,
      savedRecords: saveResult.saved,
      message: `Saved ${reusableResult.records.length} reused AI and ${localRecords.length} local ${saveResult.saved === 1 ? "classification" : "classifications"}.`,
      metrics,
    };
  }

  if (options.localProvider) {
    return await runLocalAiClassification(query, unknownPayload.length, [...localRecords, ...reusableResult.records], reusableResult.misses, null, options.localProvider, promptWorkProfile, memoryContextForItems(memoryContext, reusableResult.misses.map((item) => item.segmentId)), adaptiveContextBySegmentId(segments), options.persistenceAllowed);
  }

  const cloudAccess = await requireCloudAiClassification();
  if (cloudAccess.kind === "blocked") {
    return cloudAccess.summary;
  }
  const cloudClient = supabase;
  if (!cloudClient) {
    return { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Supabase is not configured." };
  }

  const aiRecords = await classifyCloudPayloadBatches(
    cloudClient,
    reusableResult.misses,
    workProfile,
    memoryContext,
    {
      requestKey: cloudAccess.requestKey,
      bypassBackoff: options.bypassCloudRequestBackoff === true,
      onRequestTiming: options.onCloudRequestTiming,
    },
  );
  if (aiRecords.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "error",
      selectedSegments: unknownPayload.length,
      savedRecords: 0,
      message: `AI classification returned no usable classifications for ${reusableResult.misses.length} unknown ${reusableResult.misses.length === 1 ? "segment" : "segments"}.`,
      metrics,
      failureKind: "content",
      usedAiProvider: true,
    };
  }

  const saveResult = await saveClassificationBatch([...localRecords, ...reusableResult.records, ...aiRecords], options.persistenceAllowed);
  if (!saveResult) return await providerlessPersistenceDeferred(query, true);
  const metrics = await trackerClient.getClassificationMetrics(query);
  return {
    status: "saved",
    selectedSegments: unknownPayload.length,
    savedRecords: saveResult.saved,
    message: `Saved ${aiRecords.length} AI, ${reusableResult.records.length} reused AI, and ${localRecords.length} local ${saveResult.saved === 1 ? "classification" : "classifications"}.`,
    metrics,
    usedAiProvider: true,
  };
}

export async function classifyLiveActivityWithAi(segment: ActivitySegment, options: AiClassificationRunOptions = {}): Promise<LiveAiClassificationResult> {
  if (isExcludedSegment(segment)) {
    return unavailableLiveClassification("Skipped AI classification because the activity was excluded by privacy settings.");
  }
  try {
    const privacySettings = readAiPrivacyRequestSettings();
    const promptIdentity = privacySettings.optional.workProfile
      ? await readClassificationPromptIdentity(Boolean(options.localProvider))
      : { ownerId: null, workProfile: null };
    const workProfile = promptIdentity.workProfile;
    const memoryContext = await buildClassificationMemoryContext({
      items: [segment],
      privacySettings,
      useLocalFallback: Boolean(options.localProvider),
      soulOwnerId: promptIdentity.ownerId,
      contextSegments: options.contextSegments,
    });
    const promptWorkProfile = memoryContext.soul ? null : workProfile;
    const payload = await toMinimizedPayload(segment, promptWorkProfile, privacySettings, memoryContext);
    const systemRecord = toSystemSkippedClassificationRecord(segment, payload, new Date().toISOString());
    if (systemRecord) {
      await saveLiveClassificationIfRequested(
        systemRecord,
        options.persistLiveResult === true && classificationPersistenceAllowed(options.persistenceAllowed),
      );
      return unavailableLiveClassification(systemRecord.reason ?? "Skipped AI classification because activity context is unavailable.");
    }

    const reusableRecord = await readReusableAiClassification(payload);
    if (reusableRecord) {
      await saveLiveClassificationIfRequested(
        reusableRecord,
        options.persistLiveResult === true && classificationPersistenceAllowed(options.persistenceAllowed),
      );
      return { kind: "classified", classification: reusableRecord };
    }

    if (options.localProvider) {
      return await saveLiveResultIfRequested(
        await classifyLivePayloadWithLocalAi(payload, options.localProvider, promptWorkProfile, memoryContext),
        options,
      );
    }

    return await saveLiveResultIfRequested(
      await classifyLivePayloadWithCloudAi(payload, workProfile, memoryContext, options.bypassCloudRequestBackoff === true),
      options,
    );
  } catch (error) {
    return unavailableLiveClassification(messageFromUnknownError(error, "AI classification unavailable."));
  }
}

async function saveLiveResultIfRequested(result: LiveAiClassificationResult, options: AiClassificationRunOptions): Promise<LiveAiClassificationResult> {
  if (result.kind === "classified") {
    await saveLiveClassificationIfRequested(
      result.classification,
      options.persistLiveResult === true && classificationPersistenceAllowed(options.persistenceAllowed),
    );
  }
  return result;
}

export async function runAiClassificationUntilEmpty(query: UnclassifiedSegmentsQuery, batchSize = DEFAULT_BATCH_SIZE, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  return withClassificationActivity(
    () => runAiClassificationUntilEmptyImpl(query, batchSize, options),
    (summary) => summary.metrics?.unclassifiedSegments ?? null,
  );
}

async function runAiClassificationUntilEmptyImpl(query: UnclassifiedSegmentsQuery, batchSize = DEFAULT_BATCH_SIZE, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  let selectedSegments = 0;
  let savedRecords = 0;
  let processedBatches = 0;
  let usedAiProvider = false;
  let latestMetrics: ClassificationMetrics | undefined;

  for (let batchIndex = 0; batchIndex < MAX_CLASSIFY_ALL_BATCHES; batchIndex += 1) {
    const summary = await runAiClassification(query, batchSize, options);
    latestMetrics = summary.metrics ?? latestMetrics;
    selectedSegments += summary.selectedSegments;
    savedRecords += summary.savedRecords;
    usedAiProvider ||= summary.usedAiProvider === true;

    if (summary.selectedSegments === 0 || summary.status === "empty") break;
    if (summary.status === "disabled" || summary.status === "error") {
      return { ...summary, selectedSegments, savedRecords, usedAiProvider, metrics: latestMetrics ?? summary.metrics };
    }

    processedBatches += 1;
    if (summary.savedRecords === 0) {
      return {
        status: savedRecords > 0 ? "saved" : "error",
        selectedSegments,
        savedRecords,
        message: savedRecords > 0
          ? `Saved ${savedRecords} AI ${savedRecords === 1 ? "classification" : "classifications"}. Stopped because the next batch returned no saved records.`
          : summary.message,
        metrics: latestMetrics,
        ...(savedRecords > 0 ? {} : { failureKind: "content" as const }),
        usedAiProvider,
      };
    }
  }

  const metrics = latestMetrics ?? await trackerClient.getClassificationMetrics(query);
  if (savedRecords === 0) {
    return {
      status: "empty",
      selectedSegments,
      savedRecords,
      message: "No unclassified activity segments found.",
      metrics,
      usedAiProvider,
    };
  }

  const hitSafetyCap = processedBatches >= MAX_CLASSIFY_ALL_BATCHES;
  return {
    status: "saved",
    selectedSegments,
    savedRecords,
    message: hitSafetyCap
      ? `Saved ${savedRecords} AI ${savedRecords === 1 ? "classification" : "classifications"} across ${processedBatches} batches. Run again to continue.`
      : `Classified all available activity: saved ${savedRecords} AI ${savedRecords === 1 ? "classification" : "classifications"} across ${processedBatches} ${processedBatches === 1 ? "batch" : "batches"}.`,
    metrics,
    usedAiProvider,
  };
}

export function toClassificationQueryForDay(day: string, limit?: number): UnclassifiedSegmentsQuery {
  return limit ? { day, limit } : { day };
}

export async function getAiClassificationUsageSummary(day: string): Promise<AiClassificationUsageSummary | null> {
  if (!supabase) return null;

  const { data: authData } = await supabase.auth.getSession();
  if (!authData.session) return null;

  const { data, error } = await supabase
    .from("ai_classification_usage_daily")
    .select("usage_date,model,requests_count,llm_requests_count,items_requested,cache_hits,cache_misses,errors_count,quota_errors_count,config_errors_count,request_errors_count,parse_errors_count,schema_errors_count,last_error_type,last_error_message,last_error_status,last_error_at,latency_ms_total,prompt_tokens,response_tokens")
    .eq("usage_date", day);

  if (error) throw new Error(error.message || "AI classification usage metrics unavailable.");

  const rows = Array.isArray(data) ? (data as AiClassificationUsageRow[]) : [];
  const summary = rows.reduce<AiClassificationUsageSummary>((accumulator, row) => {
    const promptTokens = numberValue(row.prompt_tokens);
    const responseTokens = numberValue(row.response_tokens);
    return {
      requests: accumulator.requests + numberValue(row.requests_count),
      llmRequests: accumulator.llmRequests + numberValue(row.llm_requests_count),
      itemsRequested: accumulator.itemsRequested + numberValue(row.items_requested),
      cacheHits: accumulator.cacheHits + numberValue(row.cache_hits),
      cacheMisses: accumulator.cacheMisses + numberValue(row.cache_misses),
      errors: accumulator.errors + numberValue(row.errors_count),
      quotaErrors: accumulator.quotaErrors + numberValue(row.quota_errors_count),
      configErrors: accumulator.configErrors + numberValue(row.config_errors_count),
      requestErrors: accumulator.requestErrors + numberValue(row.request_errors_count),
      parseErrors: accumulator.parseErrors + numberValue(row.parse_errors_count),
      schemaErrors: accumulator.schemaErrors + numberValue(row.schema_errors_count),
      lastErrorType: latestErrorValue(accumulator.lastErrorAt, row.last_error_at, accumulator.lastErrorType, row.last_error_type),
      lastErrorMessage: latestErrorValue(accumulator.lastErrorAt, row.last_error_at, accumulator.lastErrorMessage, row.last_error_message),
      lastErrorStatus: latestErrorValue(accumulator.lastErrorAt, row.last_error_at, accumulator.lastErrorStatus, row.last_error_status),
      lastErrorAt: latestErrorValue(accumulator.lastErrorAt, row.last_error_at, accumulator.lastErrorAt, row.last_error_at),
      latencyMsTotal: accumulator.latencyMsTotal + numberValue(row.latency_ms_total),
      averageLatencyMs: 0,
      promptTokens: accumulator.promptTokens + promptTokens,
      responseTokens: accumulator.responseTokens + responseTokens,
      totalTokens: 0,
      estimatedCostUsd: accumulator.estimatedCostUsd + estimateAiClassificationCostUsd(row.model, promptTokens, responseTokens),
    };
  }, emptyUsageSummary());

  const totalTokens = summary.promptTokens + summary.responseTokens;
  return {
    ...summary,
    averageLatencyMs: summary.requests > 0 ? Math.round(summary.latencyMsTotal / summary.requests) : 0,
    totalTokens,
    estimatedCostUsd: summary.estimatedCostUsd,
  };
}

export async function toMinimizedPayload(
  segment: ActivitySegment,
  workProfile: string | null,
  privacySettings: AiPrivacyRequestSettings,
  memoryContext: LiveClassificationMemoryContext,
): Promise<MinimizedActivityPayload> {
  const siteUrl = privacySettings.optional.siteUrl ? sanitizeProviderSiteUrl(segment.siteUrl) : null;
  const siteDomain = cleanText(segment.siteDomain) ?? hostnameFromUrl(segment.siteUrl);
  const contentContextEnabled = privacySettings.optional.contentContext;
  const windowTitle = privacySettings.optional.windowTitle ? cleanText(segment.windowTitle) : null;
  const title = contentContextEnabled ? cleanText(segment.siteTitle) ?? cleanText(segment.youtubeTitle) : null;
  const youtubeChannelName = contentContextEnabled
    ? cleanText(segment.youtubeChannelName)?.slice(0, MAX_YOUTUBE_CHANNEL_NAME_LENGTH) ?? null
    : null;
  const youtubeCategory = contentContextEnabled
    ? cleanText(segment.youtubeCategory)?.slice(0, MAX_YOUTUBE_CATEGORY_LENGTH) ?? null
    : null;
  const redditCommunity = redditCommunityForSegment(segment, siteUrl, contentContextEnabled);
  const browserContext = contentContextEnabled ? browserContentCluesForSegment(segment) : undefined;
  // durationSeconds is intentionally excluded from the fingerprint so repeated
  // visits to the same activity reuse one cached classification; the exact
  // duration is still sent to the provider as evidence.
  const providerInput = {
    fingerprintVersion: AI_CLASSIFICATION_PROMPT_VERSION,
    appName: cleanText(segment.appName) ?? "Unknown",
    domain: siteDomain,
    urlHost: siteDomain,
    ...(siteUrl ? { siteUrl } : {}),
    ...(windowTitle ? { windowTitle } : {}),
    ...(title ? { title } : {}),
    ...(youtubeChannelName ? { youtubeChannelName } : {}),
    ...(youtubeCategory ? { youtubeCategory } : {}),
    ...(redditCommunity ? { redditCommunity } : {}),
    ...(browserContext ? { browserContext } : {}),
    ...(workProfile ? { workProfile } : {}),
    memoryContext: classificationMemoryFingerprintMaterial(memoryContext, segment.id),
  };
  const contextFingerprint = await fingerprint(JSON.stringify({ memory: providerInput.memoryContext, ...(browserContext ? { browserContext } : {}) }));

  return {
    segmentId: segment.id,
    inputFingerprint: await fingerprint(JSON.stringify(providerInput)),
    contextFingerprint,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    durationSeconds: segment.durationSeconds,
    appName: providerInput.appName,
    bundleId: cleanText(segment.bundleId),
    browserName: cleanText(segment.browserName),
    siteDomain,
    siteUrl,
    siteTitle: contentContextEnabled ? cleanText(segment.siteTitle) : null,
    windowTitle,
    youtubeTitle: contentContextEnabled ? cleanText(segment.youtubeTitle) : null,
    youtubeChannelName,
    youtubeCategory,
    youtubeIsShorts: null,
    ...(redditCommunity ? { redditCommunity } : {}),
    ...(browserContext ? { browserContext } : {}),
  };
}

function adaptiveContextBySegmentId(segments: readonly ActivitySegment[]): ReadonlyMap<string, AdaptiveContentContext> {
  const contexts = new Map<string, AdaptiveContentContext>();
  for (const segment of segments) {
    if (segment.adaptiveContentContext) contexts.set(segment.id, segment.adaptiveContentContext);
  }
  return contexts;
}

export function toLiveClassificationPromptItem(
  item: MinimizedActivityPayload,
  id = item.segmentId,
): LiveClassificationPromptItem {
  const title = item.siteTitle ?? item.youtubeTitle;
  return {
    id,
    appName: item.appName,
    domain: item.siteDomain ?? undefined,
    urlHost: item.siteDomain ?? undefined,
    ...(item.siteUrl ? { siteUrl: item.siteUrl } : {}),
    ...(item.windowTitle ? { windowTitle: item.windowTitle } : {}),
    ...(title ? { title } : {}),
    ...(item.redditCommunity ? { redditCommunity: item.redditCommunity } : {}),
    ...(normalizeBrowserContentClues(item.browserContext) ? { browserContext: normalizeBrowserContentClues(item.browserContext) } : {}),
    ...(item.youtubeChannelName ? { youtubeChannelName: item.youtubeChannelName } : {}),
    ...(item.youtubeCategory ? { youtubeCategory: item.youtubeCategory } : {}),
    durationSeconds: item.durationSeconds,
  };
}

function toEdgeClassificationRequestItems(payload: MinimizedActivityPayload[]): Array<{
  id: string;
  inputFingerprint: string;
  appName: string;
  domain: string | null;
  urlHost: string | null;
  siteUrl?: string;
  windowTitle?: string;
  title?: string;
  redditCommunity?: string;
  youtubeChannelName?: string;
  youtubeCategory?: string;
  durationSeconds: number;
}> {
  return payload.map((item) => ({
    ...toLiveClassificationPromptItem(item),
    inputFingerprint: item.inputFingerprint,
    appName: item.appName,
    domain: item.siteDomain,
    urlHost: item.siteDomain,
    durationSeconds: item.durationSeconds,
  }));
}

function sanitizeProviderSiteUrl(value: string | null | undefined): string | null {
  const parsedUrl = providerUrlFromRaw(value);
  if (!parsedUrl) return null;
  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`.slice(0, 300);
}

function hostnameFromUrl(value: string | null | undefined): string | null {
  const parsedUrl = providerUrlFromRaw(value);
  return parsedUrl ? cleanText(parsedUrl.hostname) : null;
}

function providerUrlFromRaw(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const parsedUrl = new URL(value);
    if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") || !parsedUrl.hostname) return null;
    return parsedUrl;
  } catch (error) {
    if (error instanceof TypeError) return null;
    if (error instanceof Error) return null;
    return null;
  }
}

function redditCommunityForSegment(segment: ActivitySegment, siteUrl: string | null, titleEnabled: boolean): string | null {
  const siteDomain = cleanText(segment.siteDomain) ?? hostnameFromUrl(segment.siteUrl);
  if (!siteDomain || !REDDIT_DOMAIN_PATTERN.test(siteDomain)) return null;

  return extractRedditCommunityFromUrl(siteUrl)
    ?? (titleEnabled ? extractRedditCommunityFromText(segment.siteTitle) ?? extractRedditCommunityFromText(segment.windowTitle) : null);
}

function extractRedditCommunityFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!REDDIT_DOMAIN_PATTERN.test(url.hostname)) return null;
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts[0]?.toLowerCase() !== "r") return null;
    return normalizeRedditCommunity(pathParts[1]);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function extractRedditCommunityFromText(value: string | null | undefined): string | null {
  const match = cleanText(value)?.match(REDDIT_COMMUNITY_PATTERN);
  return normalizeRedditCommunity(match?.[1]);
}

function normalizeRedditCommunity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_REDDIT_COMMUNITY_PATTERN.test(normalized) ? normalized : null;
}

function toDeterministicClassificationRecords(segments: ActivitySegment[], payload: MinimizedActivityPayload[]): ActivityClassificationRecord[] {
  const payloadById = new Map(payload.map((item) => [item.segmentId, item]));
  const classifiedAt = new Date().toISOString();

  return segments.flatMap((segment): ActivityClassificationRecord[] => {
    const sourcePayload = payloadById.get(segment.id);
    if (!sourcePayload) return [];

    const classification = classifyActivityDetailed(segment, { includeAiClassifications: false });
    if (classification.category === "unknown") {
      const systemRecord = toSystemSkippedClassificationRecord(segment, sourcePayload, classifiedAt);
      return systemRecord ? [systemRecord] : [];
    }

    return [{
      segmentId: segment.id,
      inputFingerprint: sourcePayload.inputFingerprint,
      category: classification.category,
      productivity: classification.productivity,
      source: classification.source === "fallback" ? "fallback" : "rule",
      confidence: classification.confidence,
      reason: classification.reason,
      model: null,
      promptVersion: null,
      taxonomyVersion: "v1",
      aiResult: false,
      latencyMs: null,
      classifiedAt,
    }];
  });
}

function toSystemSkippedClassificationRecord(
  segment: ActivitySegment,
  sourcePayload: MinimizedActivityPayload,
  classifiedAt: string,
): ActivityClassificationRecord | null {
  const reason = skippedAiClassificationReason(segment);
  if (!reason) return null;

  return {
    segmentId: segment.id,
    inputFingerprint: sourcePayload.inputFingerprint,
    category: "unknown",
    productivity: "neutral",
    source: "system",
    confidence: 1,
    reason,
    model: null,
    promptVersion: null,
    taxonomyVersion: "v1",
    aiResult: false,
    latencyMs: null,
    classifiedAt,
  };
}

function skippedAiClassificationReason(segment: ActivitySegment): string | null {
  if (isExcludedSegment(segment)) {
    return "Skipped AI classification because the activity was excluded by privacy settings.";
  }
  if (normalizeComparableText(segment.appName) === "unavailable") {
    return "Skipped AI classification because the tracker could not determine the frontmost app.";
  }

  if (SYSTEM_SURFACE_APP_NAMES.has(normalizeComparableText(segment.appName))) {
    return "Skipped AI classification because the frontmost app is a macOS system surface.";
  }

  if (!isBrowserSegment(segment)) return null;

  if (isBlankBrowserContext(segment)) {
    return "Skipped AI classification because the browser showed an empty page such as a new tab.";
  }

  if (hasMeaningfulActivityContext(segment)) return null;

  const status = segment.browserAutomationStatus;
  if (status && status !== "granted" && status !== "not_applicable") {
    return `Skipped AI classification because browser context was unavailable (${status}).`;
  }

  return "Skipped AI classification because the browser activity had no readable site, title, or window context.";
}

function isBrowserSegment(segment: ActivitySegment): boolean {
  return Boolean(
    cleanText(segment.browserName)
      || KNOWN_BROWSER_APP_NAMES.has(normalizeComparableText(segment.appName))
      || KNOWN_BROWSER_BUNDLE_IDS.has(normalizeComparableText(segment.bundleId)),
  );
}

function hasMeaningfulActivityContext(segment: ActivitySegment): boolean {
  return Boolean(
    cleanText(segment.siteDomain)
      || cleanText(segment.siteTitle)
      || cleanText(segment.windowTitle)
      || cleanText(segment.youtubeTitle)
      || cleanText(segment.youtubeChannelName)
      || cleanText(segment.youtubeCategory),
  );
}

// New-tab and blank pages carry no classifiable signal; classifying them
// wastes provider quota and produces invented labels.
function isBlankBrowserContext(segment: ActivitySegment): boolean {
  const domain = normalizeComparableText(segment.siteDomain);
  if (domain && !BLANK_BROWSER_DOMAINS.has(domain)) return false;
  if (!isBlankBrowserText(segment.siteTitle) || !isBlankBrowserText(segment.windowTitle)) return false;
  if (cleanText(segment.youtubeTitle) || cleanText(segment.youtubeChannelName) || cleanText(segment.youtubeCategory)) {
    return false;
  }
  return Boolean(cleanText(segment.siteDomain) || cleanText(segment.siteTitle) || cleanText(segment.windowTitle));
}

function isBlankBrowserText(value: string | null | undefined): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) return true;
  return BLANK_BROWSER_TITLE_PATTERN.test(normalized);
}

async function collectInheritedYouTubeBrowseClassifications(
  segments: ActivitySegment[],
  payload: MinimizedActivityPayload[],
  excludedSegmentIds: ReadonlySet<string>,
): Promise<{ records: ActivityClassificationRecord[]; segmentIds: Set<string> }> {
  const payloadById = new Map(payload.map((item) => [item.segmentId, item]));
  const browseTargets = segments.filter((segment) => isYouTubeBrowsePage(segment) && !excludedSegmentIds.has(segment.id));
  if (browseTargets.length === 0) return { records: [], segmentIds: new Set<string>() };

  const timelineRange = youtubeBrowseInheritanceTimelineRange(browseTargets);
  if (!timelineRange) return { records: [], segmentIds: new Set<string>() };

  const timeline = await trackerClient.getTimeline(timelineRange);
  const inheritedRecords = browseTargets.map((segment) => toInheritedYouTubeBrowseClassificationRecord(segment, payloadById, timeline))
    .filter((record): record is ActivityClassificationRecord => record !== null);
  return {
    records: inheritedRecords,
    segmentIds: new Set(inheritedRecords.map((record) => record.segmentId)),
  };
}

// Deterministic fallback for YouTube browse pages with no nearby video to inherit from:
// a sustained stay on the recommendation feed/home reads as drift, a brief pass-through
// stays neutral. Keeps them out of the AI payload (a bare browse page has no content to
// classify) — inheritance is tried first, this only handles the leftovers.
function collectFallbackYouTubeBrowseClassifications(
  segments: ActivitySegment[],
  payload: MinimizedActivityPayload[],
  excludedSegmentIds: ReadonlySet<string>,
): { records: ActivityClassificationRecord[]; segmentIds: Set<string> } {
  const payloadById = new Map(payload.map((item) => [item.segmentId, item]));
  const targets = segments.filter((segment) => isYouTubeBrowsePage(segment) && !excludedSegmentIds.has(segment.id));
  if (targets.length === 0) return { records: [], segmentIds: new Set<string>() };

  const classifiedAt = new Date().toISOString();
  const records = targets.map((segment): ActivityClassificationRecord | null => {
    const sourcePayload = payloadById.get(segment.id);
    if (!sourcePayload) return null;
    const sustained = segment.durationSeconds >= YOUTUBE_FEED_DRIFT_MINIMUM_SECONDS;
    return {
      segmentId: segment.id,
      inputFingerprint: sourcePayload.inputFingerprint,
      category: sustained ? "entertainment" : "unknown",
      productivity: sustained ? "drift" : "neutral",
      source: "youtube",
      confidence: sustained ? 0.6 : 0.5,
      reason: sustained
        ? "Sustained YouTube recommendation browsing without nearby video context."
        : "Brief YouTube browse without nearby video context.",
      model: null,
      promptVersion: null,
      taxonomyVersion: "v1",
      aiResult: false,
      latencyMs: null,
      classifiedAt,
    };
  }).filter((record): record is ActivityClassificationRecord => record !== null);
  return { records, segmentIds: new Set(records.map((record) => record.segmentId)) };
}

function youtubeBrowseInheritanceTimelineRange(targets: ActivitySegment[]): { start: string; end: string } | null {
  let earliestStart = Number.POSITIVE_INFINITY;
  let latestEnd = Number.NEGATIVE_INFINITY;

  for (const target of targets) {
    const targetStart = new Date(target.startedAt).getTime();
    const targetEnd = new Date(target.endedAt).getTime();
    if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd)) continue;
    earliestStart = Math.min(earliestStart, targetStart);
    latestEnd = Math.max(latestEnd, targetEnd);
  }

  if (!Number.isFinite(earliestStart) || !Number.isFinite(latestEnd)) return null;
  return {
    start: new Date(earliestStart - YOUTUBE_BROWSE_INHERITANCE_WINDOW_MS).toISOString(),
    end: new Date(latestEnd + YOUTUBE_BROWSE_INHERITANCE_WINDOW_MS).toISOString(),
  };
}

function toInheritedYouTubeBrowseClassificationRecord(
  target: ActivitySegment,
  payloadById: Map<string, MinimizedActivityPayload>,
  timeline: ActivitySegment[],
): ActivityClassificationRecord | null {
  const sourcePayload = payloadById.get(target.id);
  if (!sourcePayload) return null;

  const targetStart = new Date(target.startedAt).getTime();
  const targetEnd = new Date(target.endedAt).getTime();
  if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd)) return null;

  const candidate = selectNearestClassifiedYouTubeVideo(target, timeline);
  if (!candidate) return null;

  return {
    segmentId: target.id,
    inputFingerprint: sourcePayload.inputFingerprint,
    category: candidate.classification.category,
    productivity: candidate.classification.productivity,
    source: "system",
    confidence: Math.min(YOUTUBE_BROWSE_INHERITANCE_MAX_CONFIDENCE, finiteConfidence(candidate.classification.confidence)),
    reason: "Inherited classification from nearby YouTube video activity.",
    model: null,
    promptVersion: null,
    taxonomyVersion: "v1",
    aiResult: false,
    latencyMs: null,
    classifiedAt: new Date().toISOString(),
  };
}

type YouTubeInheritanceCandidate = {
  segment: ActivitySegment;
  classification: ReturnType<typeof classifyActivityDetailed>;
  gapMs: number;
};

function selectNearestClassifiedYouTubeVideo(target: ActivitySegment, timeline: ActivitySegment[]): YouTubeInheritanceCandidate | null {
  const candidates = timeline.flatMap((segment): YouTubeInheritanceCandidate[] => {
    if (segment.id === target.id || !isYouTubeVideoSegment(segment)) return [];
    const classification = classifyActivityDetailed(segment);
    if (classification.category === "unknown") return [];

    const gapMs = segmentTimeGapMs(target, segment);
    if (gapMs === null || gapMs > YOUTUBE_BROWSE_INHERITANCE_WINDOW_MS) return [];
    return [{ segment, classification, gapMs }];
  });

  return candidates.sort(compareYouTubeInheritanceCandidates)[0] ?? null;
}

function compareYouTubeInheritanceCandidates(left: YouTubeInheritanceCandidate, right: YouTubeInheritanceCandidate): number {
  if (left.gapMs !== right.gapMs) return left.gapMs - right.gapMs;
  const confidenceDelta = finiteConfidence(right.classification.confidence) - finiteConfidence(left.classification.confidence);
  if (confidenceDelta !== 0) return confidenceDelta;
  if (left.segment.durationSeconds !== right.segment.durationSeconds) return right.segment.durationSeconds - left.segment.durationSeconds;
  return new Date(left.segment.startedAt).getTime() - new Date(right.segment.startedAt).getTime();
}

function segmentTimeGapMs(target: ActivitySegment, candidate: ActivitySegment): number | null {
  const targetStart = new Date(target.startedAt).getTime();
  const targetEnd = new Date(target.endedAt).getTime();
  const candidateStart = new Date(candidate.startedAt).getTime();
  const candidateEnd = new Date(candidate.endedAt).getTime();
  if (![targetStart, targetEnd, candidateStart, candidateEnd].every(Number.isFinite)) return null;
  if (candidateEnd < targetStart) return targetStart - candidateEnd;
  if (candidateStart > targetEnd) return candidateStart - targetEnd;
  return 0;
}

function finiteConfidence(confidence: number): number {
  return Number.isFinite(confidence) ? confidence : 0.5;
}

function toClassificationRecords(
  data: unknown,
  payload: MinimizedActivityPayload[],
  memoryContext: LiveClassificationMemoryContext | null = null,
  route: "cloud" | "local" = "cloud",
): ActivityClassificationRecord[] {
  const response = data as EdgeClassificationResponse | EdgeClassification[] | null;
  const classifications = Array.isArray(response)
    ? response
    : Array.isArray(response?.results)
      ? response.results
      : Array.isArray(response?.classifications)
        ? response.classifications
        : [];
  const model = !Array.isArray(response) && typeof response?.model === "string" ? response.model : null;
  const resultLatencyMsById = !Array.isArray(response) && isRecord(response?.resultLatencyMsById)
    ? response.resultLatencyMsById
    : null;
  const payloadById = new Map(payload.map((item) => [item.segmentId, item]));
  const classifiedAt = new Date().toISOString();

  return classifications.flatMap((entry): ActivityClassificationRecord[] => {
    if (!entry || typeof entry !== "object") return [];
    const classification = entry as EdgeClassification;
    const segmentId = typeof classification.segmentId === "string"
      ? classification.segmentId
      : typeof classification.id === "string"
        ? classification.id
        : "";
    const sourcePayload = payloadById.get(segmentId);
    if (!sourcePayload || !isActivityCategory(classification.category)) return [];
    const providerProductivity = resolveRawProviderProductivity(classification);
    if (!providerProductivity) return [];
    const withoutContext = resolveProviderProductivity(classification, classification.category, sourcePayload, null);
    const productivity = resolveProviderProductivity(classification, classification.category, sourcePayload, memoryContext);
    if (!productivity) return [];
    const providerConfidence = typeof classification.confidence === "number" ? classification.confidence : 0.5;
    const contextDowngraded = withoutContext === "drift" && productivity === "neutral";
    const serverAudit = normalizeContextualGuardServerAudit(classification.contextualGuardAudit);
    const safetyReasonReturned = classification.reason === MATCHED_CONTEXTUAL_DRIFT_SAFETY_REASON;
    const rawProductivity = serverAudit?.rawProductivity
      ?? (safetyReasonReturned ? "drift" : withoutContext);
    const finalConfidence = confidenceForResolvedLiveActivityProductivity(
      providerConfidence,
      providerProductivity,
      productivity,
    );
    const record: ActivityClassificationRecord = {
      segmentId,
      inputFingerprint: typeof classification.inputFingerprint === "string" ? classification.inputFingerprint : sourcePayload.inputFingerprint,
      category: classification.category,
      productivity,
      source: "llm",
      confidence: finalConfidence,
      reason: contextDowngraded
        ? MATCHED_CONTEXTUAL_DRIFT_SAFETY_REASON
        : typeof classification.reason === "string" ? classification.reason : null,
      model: typeof classification.model === "string" ? classification.model : model,
      promptVersion: AI_CLASSIFICATION_PROMPT_VERSION,
      taxonomyVersion: "v1",
      aiResult: true,
      // Fresh responses must always carry a latency so fingerprint-cache reuse
      // (which stores none) stays distinguishable as "AI cache" downstream.
      latencyMs: typeof resultLatencyMsById?.[segmentId] === "number" && Number.isFinite(resultLatencyMsById[segmentId])
        ? resultLatencyMsById[segmentId]
        : responseLatencyMs(data) ?? 0,
      classifiedAt,
    };
    if (rawProductivity) {
      recordContextualGuardAuditEvent({
        route,
        category: classification.category,
        rawProductivity,
        finalProductivity: productivity,
        rawConfidence: serverAudit?.rawConfidence ?? (safetyReasonReturned ? null : providerConfidence),
        finalConfidence,
        promptVersion: AI_CLASSIFICATION_PROMPT_VERSION,
        item: toLiveClassificationPromptItem(sourcePayload),
        memoryContext,
      });
    }
    return [record];
  });
}

async function collectReusableAiClassifications(unknownPayload: MinimizedActivityPayload[]): Promise<{ records: ActivityClassificationRecord[]; misses: MinimizedActivityPayload[] }> {
  if (unknownPayload.length === 0) return { records: [], misses: [] };

  const uniqueFingerprints = Array.from(new Set(unknownPayload.map((item) => item.inputFingerprint)));
  const reusableByFingerprint = await trackerClient.getReusableAiClassifications(uniqueFingerprints);
  const reusableRecords = toReusableClassificationRecords(unknownPayload, reusableByFingerprint);
  const reusableFingerprintSet = new Set(reusableRecords.map((record) => record.inputFingerprint));
  const misses = unknownPayload.filter((item) => !reusableFingerprintSet.has(item.inputFingerprint));
  return { records: reusableRecords, misses };
}

async function saveClassificationBatch(
  records: ActivityClassificationRecord[],
  persistenceAllowed?: () => boolean,
): Promise<{ saved: number } | null> {
  if (records.length === 0) return { saved: 0 };
  if (!classificationPersistenceAllowed(persistenceAllowed)) return null;
  return trackerClient.saveClassifications(records);
}

function classificationPersistenceAllowed(persistenceAllowed?: () => boolean): boolean {
  return persistenceAllowed?.() !== false;
}

async function providerlessPersistenceDeferred(
  query: UnclassifiedSegmentsQuery,
  usedAiProvider = false,
): Promise<AiClassificationSummary> {
  const metrics = await trackerClient.getClassificationMetrics(query);
  return {
    status: "empty",
    selectedSegments: 0,
    savedRecords: 0,
    message: "Automatic classification is waiting for the selected AI provider to become available.",
    metrics,
    usedAiProvider,
  };
}

async function readReusableAiClassification(payload: MinimizedActivityPayload): Promise<ActivityClassificationRecord | null> {
  const reusableByFingerprint = await trackerClient.getReusableAiClassifications([payload.inputFingerprint]);
  const reusableRecords = toReusableClassificationRecords([payload], reusableByFingerprint);
  return reusableRecords[0] ?? null;
}

function toReusableClassificationRecords(
  unknownPayload: MinimizedActivityPayload[],
  reusableByFingerprint: Record<string, ActivityClassificationRecord>,
): ActivityClassificationRecord[] {
  const classifiedAt = new Date().toISOString();
  return unknownPayload.flatMap((item): ActivityClassificationRecord[] => {
    const reusable = reusableByFingerprint[item.inputFingerprint];
    if (!reusable || !isActivityCategory(reusable.category) || !isProductivityLabel(reusable.productivity)) return [];

    return [{
      segmentId: item.segmentId,
      inputFingerprint: item.inputFingerprint,
      category: reusable.category,
      productivity: reusable.productivity,
      source: "llm",
      confidence: numberValue(reusable.confidence),
      reason: reusable.reason ?? null,
      model: reusable.model ?? null,
      promptVersion: reusable.promptVersion ?? null,
      taxonomyVersion: reusable.taxonomyVersion ?? "v1",
      requestId: null,
      latencyMs: null,
      aiResult: true,
      stale: false,
      classifiedAt,
    }];
  });
}

async function classifyLivePayloadWithLocalAi(
  payload: MinimizedActivityPayload,
  provider: LocalAiProviderConfig,
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
): Promise<LiveAiClassificationResult> {
  const providerRequest = localProviderRequestForClassification(provider, [payload], workProfile, memoryContext);
  if (!providerRequest) return unavailableLiveClassification("Local AI provider is not fully configured.");

  try {
    const response = await invokeOpenAiChatWithManagedLocalRetry(
      providerRequest.request,
      provider.provider === "managed_local" ? provider : null,
    );
    const responseFailure = localProviderResponseFailure(response, provider);
    if (responseFailure) return unavailableLiveClassification(responseFailure.message);

    const data = toLocalClassificationResponse(response, providerRequest.model);
    return firstLiveClassification(data, payload, "Local AI classification returned no usable classification.", memoryContext, "local");
  } catch (error) {
    return unavailableLiveClassification(messageFromUnknownError(error, "Local AI classification failed."));
  }
}

async function classifyLivePayloadWithCloudAi(
  payload: MinimizedActivityPayload,
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
  bypassBackoff = false,
): Promise<LiveAiClassificationResult> {
  const cloudAccess = await requireCloudAiClassification();
  if (cloudAccess.kind === "blocked") return unavailableLiveClassification(cloudAccess.summary.message);

  const cloudClient = supabase;
  if (!cloudClient) return unavailableLiveClassification("Supabase is not configured.");

  try {
    assertCloudAiRequestAllowed({ requestKey: cloudAccess.requestKey, bypassBackoff });
    const requestRevision = cloudAiRequestBackoffs.revision(cloudAccess.requestKey);
    const { data, error, retryAfter } = await invokeCloudClassification(
      cloudClient, cloudClassificationRequestBody([payload], workProfile, memoryContext),
    );

    if (error) {
      const failure = await describeAiClassificationFailure(error);
      recordCloudClassificationBackoff(cloudAccess.requestKey, error, retryAfter);
      return unavailableLiveClassification(failure.message);
    }
    cloudAiRequestBackoffs.clear(cloudAccess.requestKey, requestRevision);
    return firstLiveClassification(data, payload, "AI classification returned no usable classification.", memoryContext, "cloud");
  } catch (error) {
    return unavailableLiveClassification(messageFromUnknownError(error, "AI classification failed."));
  }
}

async function classifyCloudPayloadBatches(
  cloudClient: NonNullable<typeof supabase>,
  payloads: readonly MinimizedActivityPayload[],
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
  requestContext: CloudAiRequestContext,
): Promise<ActivityClassificationRecord[]> {
  const records: ActivityClassificationRecord[] = [];
  for (const batch of partitionCloudPayloads(payloads, workProfile, memoryContext)) {
    assertCloudAiRequestAllowed(requestContext);
    const requestRevision = cloudAiRequestBackoffs.revision(requestContext.requestKey);
    const body = cloudClassificationRequestBody(batch, workProfile, memoryContext);
    const requestStartedAt = Date.now();
    try { requestContext.onRequestTiming?.("started", 0); } catch { /* Diagnostics cannot block classification. */ }
    let invocation: Awaited<ReturnType<typeof invokeCloudClassification>>;
    try {
      invocation = await invokeCloudClassification(cloudClient, body);
    } finally {
      try { requestContext.onRequestTiming?.("settled", Date.now() - requestStartedAt); } catch { /* Best effort. */ }
    }
    const { data, error, retryAfter } = invocation;
    if (error) {
      recordCloudClassificationBackoff(requestContext.requestKey, error, retryAfter);
      throw error;
    }
    cloudAiRequestBackoffs.clear(requestContext.requestKey, requestRevision);
   records.push(...toClassificationRecords(data, [...batch], memoryContext, "cloud"));
  }
  return records;
}

// The SDK clears its timer as soon as an HTTP error's headers arrive. Own
// the deadline through device preparation, invocation and error-body reading,
// so both live and batch callers settle even when a transport ignores abort.
async function invokeCloudClassification(
  cloudClient: NonNullable<typeof supabase>,
  body: ReturnType<typeof cloudClassificationRequestBody>,
): Promise<{ data: unknown; error: AiClassificationEdgeError | null; retryAfter: string | null }> {
  const controller = new AbortController();
  let response: Response | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Cloud AI classification timed out. Try again."));
      controller.abort();
    }, CLOUD_CLASSIFICATION_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const preparedBody = await withCloudDevicePayload(body);
        // A late device lookup must not start a request after its caller left.
        if (controller.signal.aborted) throw new Error("Cloud AI classification timed out. Try again.");
        const { data, error } = await cloudClient.functions.invoke("classify-activity", {
          body: preparedBody,
          signal: controller.signal,
          timeout: CLOUD_CLASSIFICATION_REQUEST_TIMEOUT_MS,
        });
        const context = isRecord(error) ? error.context : null;
        response = context instanceof Response ? context : null;
        return {
          data,
          error: error ? new AiClassificationEdgeError(await edgeFunctionFailureDetail(error, controller.signal)) : null,
          retryAfter: response?.headers.get("Retry-After") ?? null,
        };
      })(),
      timeout,
    ]);
  } catch (error) {
    // Keep received status/Retry-After even if the error body never completes:
    // an unreadable quota response must not trigger another paid request.
    const receivedResponse = response as Response | null;
    return {
      data: null,
      error: new AiClassificationEdgeError({
        message: messageFromUnknownError(error, "AI classification failed."),
        status: receivedResponse?.status ?? null,
        errorType: null,
        quotaWindow: null,
      }),
      retryAfter: receivedResponse?.headers.get("Retry-After") ?? null,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function recordCloudClassificationBackoff(requestKey: string, error: AiClassificationEdgeError, retryAfter: string | null) {
  if (error.status !== 402 && error.status !== 429) return;
  cloudAiRequestBackoffs.record({
    key: requestKey,
    status: error.status as CloudAiBackoffStatus,
    message: error.message,
    quotaWindow: error.quotaWindow,
    retryAfter,
  });
}

function partitionCloudPayloads(
  payloads: readonly MinimizedActivityPayload[],
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
): MinimizedActivityPayload[][] {
  const batches: MinimizedActivityPayload[][] = [];
  let current: MinimizedActivityPayload[] = [];
  for (const payload of payloads) {
    const candidate = [...current, payload];
    const candidateBytes = cloudClassificationRequestBytes(candidate, workProfile, memoryContext);
    if (current.length > 0 && candidateBytes > CLOUD_CLASSIFICATION_BODY_TARGET_BYTES) {
      batches.push(current);
      current = [payload];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function cloudClassificationRequestBytes(
  payloads: readonly MinimizedActivityPayload[],
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
): number {
  return new TextEncoder().encode(JSON.stringify(
    cloudClassificationRequestBody(payloads, workProfile, memoryContext),
  )).byteLength;
}

function cloudClassificationRequestBody(
  payloads: readonly MinimizedActivityPayload[],
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
) {
  const items = toEdgeClassificationRequestItems([...payloads]);
  const segmentIds = payloads.map((payload) => payload.segmentId);
  return {
    ...cloudApiClientMetadata,
    // Keep the legacy profile during a staggered app/Edge rollout. The v8.2
    // Edge function suppresses it when Soul is present, while an older Edge
    // can still classify with the profile instead of silently losing context.
    ...(workProfile ? { workProfile } : {}),
    memoryContext: memoryContextForCloudRequest(memoryContext, segmentIds, items, workProfile),
    items,
  };
}

function memoryContextForCloudRequest(
  memoryContext: LiveClassificationMemoryContext,
  segmentIds: readonly string[],
  items: readonly Record<string, unknown>[],
  workProfile: string | null,
): LiveClassificationMemoryContext {
  const baseBytes = new TextEncoder().encode(JSON.stringify({
    ...cloudApiClientMetadata,
    ...(workProfile ? { workProfile } : {}),
    memoryContext: null,
    items,
  })).byteLength;
  const memoryBudget = Math.max(0, CLOUD_CLASSIFICATION_BODY_TARGET_BYTES - baseBytes);
  return memoryContextForItems(memoryContext, segmentIds, memoryBudget);
}

function firstLiveClassification(
  data: unknown,
  payload: MinimizedActivityPayload,
  unavailableReason: string,
  memoryContext: LiveClassificationMemoryContext,
  route: "cloud" | "local",
): LiveAiClassificationResult {
  const records = toClassificationRecords(data, [payload], memoryContext, route);
  const classification = records[0];
  if (!classification) return unavailableLiveClassification(unavailableReason);
  return { kind: "classified", classification };
}

function unavailableLiveClassification(reason: string): LiveAiClassificationResult {
  return { kind: "unavailable", reason };
}

function messageFromUnknownError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function runLocalAiClassification(
  query: UnclassifiedSegmentsQuery,
  selectedSegments: number,
  preAiRecords: ActivityClassificationRecord[],
  representatives: MinimizedActivityPayload[],
  membersByRepSegmentId: Map<string, MinimizedActivityPayload[]> | null,
  provider: LocalAiProviderConfig,
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
  adaptiveContextBySegmentId: ReadonlyMap<string, AdaptiveContentContext>,
  persistenceAllowed?: () => boolean,
): Promise<AiClassificationSummary> {
  const providerRequest = toLocalProviderRequest(provider, representatives, workProfile, memoryContext);
  if (!providerRequest) {
    return {
      status: "disabled",
      selectedSegments: 0,
      savedRecords: 0,
      message: "Local AI provider is not fully configured.",
    };
  }

  const data = await requestLocalClassificationBatches(
    representatives,
    provider,
    workProfile,
    memoryContext,
  );
  const representativeRecords = await selectLocalAiClassificationRecords({
    firstPassRecords: toClassificationRecords(data, representatives, memoryContext, "local"),
    representatives,
    provider,
    workProfile,
    memoryContext,
    adaptiveContextBySegmentId,
  });
  const aiRecords = expandClusterRecords(representativeRecords, membersByRepSegmentId);
  if (aiRecords.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "error",
      selectedSegments,
      savedRecords: 0,
      message: `AI classification returned no usable classifications for ${representatives.length} unknown ${representatives.length === 1 ? "segment" : "segments"}.`,
      metrics,
      failureKind: "content",
      usedAiProvider: true,
    };
  }

  const saveResult = await saveClassificationBatch([...preAiRecords, ...aiRecords], persistenceAllowed);
  if (!saveResult) return await providerlessPersistenceDeferred(query, true);
  const metrics = await trackerClient.getClassificationMetrics(query);
  return {
    status: "saved",
    selectedSegments,
    savedRecords: saveResult.saved,
    message: `Saved ${aiRecords.length} AI and ${preAiRecords.length} local ${saveResult.saved === 1 ? "classification" : "classifications"}.`,
    metrics,
    usedAiProvider: true,
  };
}

async function requestLocalClassificationBatches(
  payload: readonly MinimizedActivityPayload[],
  provider: LocalAiProviderConfig,
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
): Promise<EdgeClassificationResponse> {
  const batches = provider.provider === "managed_local"
    ? partitionManagedLocalItems(payload, provider, workProfile, memoryContext)
    : [payload];
  const responses: EdgeClassificationResponse[] = [];
  for (const batch of batches) {
    responses.push(await requestLocalClassificationBatchWithFallback(batch, provider, workProfile, memoryContext));
  }
  return mergeLocalClassificationResponses(responses);
}

async function requestLocalClassificationBatchWithFallback(
  payload: readonly MinimizedActivityPayload[],
  provider: LocalAiProviderConfig,
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
  allowSplit = true,
): Promise<EdgeClassificationResponse> {
  const providerRequest = localProviderRequestForClassification(provider, payload, workProfile, memoryContext);
  if (!providerRequest) throw new Error("Local AI provider is not fully configured.");

  try {
    return await requestLocalClassificationResponse(providerRequest, provider);
  } catch (error) {
    // One split means at most three requests for a top-level batch: the
    // original request plus two smaller children. Do not recursively fan out
    // malformed responses into up to nineteen long-running local requests.
    if (!allowSplit || provider.provider !== "managed_local" || payload.length <= 1 || !shouldRetryLocalAiWithSmallerBatch(error)) throw error;
    const midpoint = Math.ceil(payload.length / 2);
    const first = await requestLocalClassificationBatchWithFallback(payload.slice(0, midpoint), provider, workProfile, memoryContext, false);
    const second = await requestLocalClassificationBatchWithFallback(payload.slice(midpoint), provider, workProfile, memoryContext, false);
    return mergeLocalClassificationResponses([first, second]);
  }
}

function partitionManagedLocalItems(
  items: readonly MinimizedActivityPayload[],
  provider: Extract<LocalAiProviderConfig, { readonly provider: "managed_local" }>,
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
): MinimizedActivityPayload[][] {
  const partitions: MinimizedActivityPayload[][] = [];
  let pending: MinimizedActivityPayload[] = [];
  for (const item of items) {
    const candidate = [...pending, item];
    const request = localProviderRequestForClassification(provider, candidate, workProfile, memoryContext, false);
    if (pending.length > 0 && (candidate.length > MANAGED_LOCAL_AI_CLASSIFICATION_MAX_BATCH_SIZE || localProviderPromptBytes(request) > MANAGED_LOCAL_AI_CLASSIFICATION_MAX_PROMPT_BYTES)) {
      partitions.push(pending);
      pending = [item];
      continue;
    }
    pending = candidate;
  }
  if (pending.length > 0) partitions.push(pending);
  return partitions;
}

function localProviderRequestForClassification(
  provider: LocalAiProviderConfig,
  payload: readonly MinimizedActivityPayload[],
  workProfile: string | null,
  memoryContext: LiveClassificationMemoryContext,
  shedOptionalMemory = true,
): LocalAiProviderRequest | null {
  const segmentIds = payload.map((item) => item.segmentId);
  if (provider.provider !== "managed_local") {
    return toLocalProviderRequest(provider, payload, workProfile, memoryContextForItems(memoryContext, segmentIds));
  }

  const boundedMemory = memoryContextForItems(memoryContext, segmentIds, MANAGED_LOCAL_AI_CLASSIFICATION_MAX_MEMORY_BYTES);
  const boundedRequest = toLocalProviderRequest(provider, payload, workProfile, boundedMemory);
  if (!shedOptionalMemory || localProviderPromptBytes(boundedRequest) <= MANAGED_LOCAL_AI_CLASSIFICATION_MAX_PROMPT_BYTES) return boundedRequest;

  // Item evidence is authoritative. If a single title-heavy request is still
  // oversized after the managed-memory cap, shed optional Soul/Episode context
  // before the partitioner decides whether the item batch itself must shrink.
  return toLocalProviderRequest(provider, payload, workProfile, memoryContextForItems(memoryContext, segmentIds, 0));
}

function localProviderPromptBytes(providerRequest: LocalAiProviderRequest | null): number {
  const messages = providerRequest?.request.messages;
  return Array.isArray(messages) ? messages.reduce((bytes, message) => bytes + new TextEncoder().encode(isRecord(message) && typeof message.content === "string" ? message.content : "").byteLength, 0) : 0;
}

function localProviderEnhancedRetryRequestForClassification(
  input: LocalAiProviderEnhancedRetryRequestInput,
): LocalAiProviderRequest | null {
  if (input.provider.provider !== "managed_local") return toLocalProviderEnhancedRetryRequest(input);

  const withBoundedMemory = toLocalProviderEnhancedRetryRequest({
    ...input,
    memoryContext: memoryContextForItems(input.memoryContext ?? { soul: null, episodeByItemId: {} }, input.payload.map((item) => item.segmentId), MANAGED_LOCAL_AI_CLASSIFICATION_MAX_MEMORY_BYTES),
  });
  if (localProviderPromptBytes(withBoundedMemory) <= MANAGED_LOCAL_AI_CLASSIFICATION_MAX_PROMPT_BYTES) return withBoundedMemory;

  const withoutMemory = toLocalProviderEnhancedRetryRequest({
    ...input,
    memoryContext: { soul: null, episodeByItemId: {} },
  });
  return localProviderPromptBytes(withoutMemory) <= MANAGED_LOCAL_AI_CLASSIFICATION_MAX_PROMPT_BYTES ? withoutMemory : null;
}

function mergeLocalClassificationResponses(responses: readonly EdgeClassificationResponse[]): EdgeClassificationResponse {
  const results: unknown[] = [];
  const resultLatencyMsById: Record<string, number> = {};
  let model: unknown;
  let latencyMs = 0;
  for (const response of responses) {
    const entries = Array.isArray(response.results)
      ? response.results
      : Array.isArray(response.classifications) ? response.classifications : [];
    const responseModel = typeof response.model === "string" ? response.model : null;
    const responseLatency = responseLatencyMs(response);
    const responseResultLatencies = isRecord(response.resultLatencyMsById) ? response.resultLatencyMsById : null;
    results.push(...entries.map((entry) => {
      if (!isRecord(entry)) return entry;
      const id = typeof entry.segmentId === "string" ? entry.segmentId : typeof entry.id === "string" ? entry.id : null;
      if (id) {
        const entryLatency = responseResultLatencies?.[id];
        if (typeof entryLatency === "number" && Number.isFinite(entryLatency)) resultLatencyMsById[id] = entryLatency;
        else if (responseLatency !== null) resultLatencyMsById[id] = responseLatency;
      }
      return {
        ...entry,
        ...(responseModel === null ? {} : { model: responseModel }),
      };
    }));
    if (responseModel !== null) model = responseModel;
    if (responseLatency !== null) {
      latencyMs += responseLatency;
    }
  }
  return { results, model, latencyMs, resultLatencyMsById };
}

async function requestLocalClassificationResponse(
  providerRequest: NonNullable<ReturnType<typeof toLocalProviderRequest>>,
  provider: LocalAiProviderConfig,
): Promise<EdgeClassificationResponse> {
  let response: NativeOpenAiChatResponse;
  try {
    response = await invokeOpenAiChatWithManagedLocalRetry(
      providerRequest.request,
      provider.provider === "managed_local" ? provider : null,
    );
  } catch (error) {
    throw localAiTransportError(error);
  }

  const responseFailure = localProviderResponseFailure(response, provider);
  if (responseFailure) throw localAiProviderResponseError(responseFailure.message, responseFailure.issueKind);

  try {
    return toLocalClassificationResponse(response, providerRequest.model);
  } catch (error) {
    throw localAiInvalidResponseError(error);
  }
}

async function selectLocalAiClassificationRecords(input: {
  readonly firstPassRecords: ActivityClassificationRecord[];
  readonly representatives: MinimizedActivityPayload[];
  readonly provider: LocalAiProviderConfig;
  readonly workProfile: string | null;
  readonly memoryContext: LiveClassificationMemoryContext;
  readonly adaptiveContextBySegmentId: ReadonlyMap<string, AdaptiveContentContext>;
}): Promise<ActivityClassificationRecord[]> {
  const firstPassBySegmentId = new Map(input.firstPassRecords.map((record) => [record.segmentId, record]));
  const selectedRecords: ActivityClassificationRecord[] = [];
  for (const payload of input.representatives) {
    const firstPassRecord = firstPassBySegmentId.get(payload.segmentId);
    if (!firstPassRecord) continue;
    const enhancedRetryRecord = await classifyLocalEnhancedRetry({
      payload,
      firstPassRecord,
      provider: input.provider,
      workProfile: input.workProfile,
      memoryContext: input.memoryContext,
      adaptiveContextBySegmentId: input.adaptiveContextBySegmentId,
    });
    selectedRecords.push(selectPreferredAiRecord(firstPassRecord, enhancedRetryRecord));
  }
  return selectedRecords;
}

async function classifyLocalEnhancedRetry(input: {
  readonly payload: MinimizedActivityPayload;
  readonly firstPassRecord: ActivityClassificationRecord;
  readonly provider: LocalAiProviderConfig;
  readonly workProfile: string | null;
  readonly memoryContext: LiveClassificationMemoryContext;
  readonly adaptiveContextBySegmentId: ReadonlyMap<string, AdaptiveContentContext>;
}): Promise<ActivityClassificationRecord | null> {
  const settings = resolveInitialEnhancedContextSettings();
  const devModeEnabled = resolveInitialDevModeEnabled();
  const egress = buildProviderSafeEnhancedContext({
    mode: "enhanced_retry",
    settings,
    context: input.adaptiveContextBySegmentId.get(input.payload.segmentId) ?? null,
    segmentId: input.payload.segmentId,
  });
  const debugLoggingEnabled = devModeEnabled && settings.debugLogging;
  if (debugLoggingEnabled) {
    recordEnhancedContextDebugEvent({
      kind: "egress_decision",
      status: egressDebugStatus(egress.summary),
      reason: egressDebugReason(egress.summary),
      egress: egress.summary,
    });
  }
  const firstPassConfidence = finiteConfidence(input.firstPassRecord.confidence);
  const alreadyRetried = enhancedContextRetriedFingerprints.has(input.payload.inputFingerprint);
  const eligibility = enhancedContextRetryEligibility({
    settings,
    alreadyRetried,
    category: input.firstPassRecord.category,
    confidence: firstPassConfidence,
    evidence: retryEvidenceForRecord(input.firstPassRecord),
    threshold: ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD,
    providerContext: egress.providerContext,
  });
  if (eligibility.kind !== "eligible" || !egress.providerContext) {
    if (debugLoggingEnabled) {
      recordRetryDebugEvent({
        status: "retry_skipped",
        reason: eligibility.reason,
        threshold: ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD,
        firstPassConfidence,
        firstPassCategory: input.firstPassRecord.category,
        providerSafeItemCount: egress.summary.providerSafeItemCount,
      });
    }
    return null;
  }

  const enhancedPayload = await toEnhancedRetryPayload(input.payload, egress.providerContext);
  const providerRequest = localProviderEnhancedRetryRequestForClassification({
    provider: input.provider,
    payload: [enhancedPayload],
    workProfile: input.workProfile,
    memoryContext: memoryContextForItems(input.memoryContext, [input.payload.segmentId]),
    enhancedRetryContext: egress.providerContext,
  });
  if (!providerRequest) {
    if (debugLoggingEnabled) {
      recordRetryDebugEvent({
        status: "retry_skipped",
        reason: "provider_error",
        threshold: ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD,
        firstPassConfidence,
        firstPassCategory: input.firstPassRecord.category,
        providerSafeItemCount: egress.summary.providerSafeItemCount,
      });
    }
    return null;
  }

  markEnhancedContextRetryFingerprint(input.payload.inputFingerprint);
  if (debugLoggingEnabled) {
    recordRetryDebugEvent({
      status: "retry_sent",
      reason: eligibility.reason,
      threshold: ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD,
      firstPassConfidence,
      firstPassCategory: input.firstPassRecord.category,
      providerSafeItemCount: egress.summary.providerSafeItemCount,
    });
  }
  try {
    const response = await invokeOpenAiChatWithManagedLocalRetry(
      providerRequest.request,
      input.provider.provider === "managed_local" ? input.provider : null,
    );
    const responseFailure = localProviderResponseFailure(response, input.provider);
    if (responseFailure) {
      if (debugLoggingEnabled) {
        recordRetryDebugEvent({
          status: "error",
          reason: "provider_error",
          threshold: ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD,
          firstPassConfidence,
          firstPassCategory: input.firstPassRecord.category,
          providerSafeItemCount: egress.summary.providerSafeItemCount,
        });
      }
      return null;
    }

    const data = toLocalClassificationResponse(response, providerRequest.model);
    const enhancedRetryRecord = toClassificationRecords(
      data,
      [enhancedPayload],
      memoryContextForItems(input.memoryContext, [input.payload.segmentId]),
      "local",
    )[0] ?? null;
    if (debugLoggingEnabled && enhancedRetryRecord) {
      recordRetryDebugEvent({
        status: "selected",
        reason: eligibility.reason,
        threshold: ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD,
        firstPassConfidence,
        firstPassCategory: input.firstPassRecord.category,
        providerSafeItemCount: egress.summary.providerSafeItemCount,
        selectedResult: enhancedRetryImproves(input.firstPassRecord, enhancedRetryRecord) ? "enhanced_retry" : "first_pass",
      });
    }
    return enhancedRetryRecord;
  } catch (error) {
    if (debugLoggingEnabled) {
      recordRetryDebugEvent({
        status: "error",
        reason: "provider_error",
        threshold: ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD,
        firstPassConfidence,
        firstPassCategory: input.firstPassRecord.category,
        providerSafeItemCount: egress.summary.providerSafeItemCount,
      });
    }
    if (error instanceof Error) return null;
    return null;
  }
}

function markEnhancedContextRetryFingerprint(fingerprintValue: string): void {
  if (enhancedContextRetriedFingerprints.has(fingerprintValue)) return;
  enhancedContextRetriedFingerprints.add(fingerprintValue);
  enhancedContextRetriedFingerprintOrder.push(fingerprintValue);
  if (enhancedContextRetriedFingerprintOrder.length <= MAX_ENHANCED_CONTEXT_RETRY_FINGERPRINTS) return;
  const expired = enhancedContextRetriedFingerprintOrder.shift();
  if (expired) enhancedContextRetriedFingerprints.delete(expired);
}

function egressDebugStatus(summary: ContentContextEgressSummary): EnhancedContextDebugStatus {
  if (summary.providerSafeItemCount > 0) return "allowed";
  if (summary.decisionCounts.blocked > 0) return "blocked";
  if (summary.decisionCounts.local_only > 0) return "local_only";
  return "dropped";
}

function egressDebugReason(summary: ContentContextEgressSummary): EnhancedContextDebugReason {
  if ((summary.dropReasonCounts.sensitive_surface ?? 0) > 0) return "sensitive_surface";
  if (summary.providerSafeItemCount === 0) return "no_provider_safe_context";
  if (summary.decisionCounts.local_only > 0) return "local_only_policy";
  return "egress_filtered";
}

function recordRetryDebugEvent(input: {
  readonly status: EnhancedContextDebugStatus;
  readonly reason: EnhancedContextDebugReason;
  readonly threshold: number;
  readonly firstPassConfidence: number;
  readonly firstPassCategory: ActivityCategory;
  readonly providerSafeItemCount: number;
  readonly selectedResult?: "first_pass" | "enhanced_retry";
}): void {
  recordEnhancedContextDebugEvent({
    kind: "retry_decision",
    status: input.status,
    reason: input.reason,
    retry: {
      threshold: input.threshold,
      firstPassConfidence: input.firstPassConfidence,
      firstPassCategory: input.firstPassCategory,
      providerSafeItemCount: input.providerSafeItemCount,
      ...(input.selectedResult ? { selectedResult: input.selectedResult } : {}),
    },
  });
}

async function toEnhancedRetryPayload(
  payload: MinimizedActivityPayload,
  enhancedRetryContext: NonNullable<ReturnType<typeof buildProviderSafeEnhancedContext>["providerContext"]>,
): Promise<MinimizedActivityPayload> {
  const fingerprintInput = {
    fingerprintVersion: AI_CLASSIFICATION_PROMPT_VERSION,
    pass: "enhanced_retry",
    firstPassFingerprint: payload.inputFingerprint,
    enhancedRetryContext,
  };
  return {
    ...payload,
    inputFingerprint: await fingerprint(JSON.stringify(fingerprintInput)),
  };
}

function selectPreferredAiRecord(
  firstPassRecord: ActivityClassificationRecord,
  enhancedRetryRecord: ActivityClassificationRecord | null,
): ActivityClassificationRecord {
  if (!enhancedRetryRecord) return firstPassRecord;
  if (enhancedRetryImproves(firstPassRecord, enhancedRetryRecord)) return enhancedRetryRecord;
  return firstPassRecord;
}

function toLocalClassificationResponse(response: NativeOpenAiChatResponse, model: string): EdgeClassificationResponse {
  const bodyText = typeof response.body === "string" ? response.body : "";
  const body = JSON.parse(bodyText) as OpenAiChatResponse;
  const firstChoice = body.choices?.[0];
  if (firstChoice?.finish_reason === "length") {
    throw new SyntaxError("The response reached its output limit before completing JSON.");
  }
  const content = firstChoice?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("\n")
    : "";
  if (!text.trim()) return { model, latencyMs: responseLatencyMs(response), results: [] };
  const parsed = JSON.parse(stripJsonCodeFence(text)) as EdgeClassificationResponse;
  return {
    ...parsed,
    model,
    latencyMs: responseLatencyMs(response),
    resultLatencyMsById: {},
  };
}

type LocalProviderResponseFailure = {
  readonly message: string;
  readonly issueKind?: AiConnectionIssueKind;
};

function localProviderResponseFailure(
  response: NativeOpenAiChatResponse,
  provider: LocalAiProviderConfig,
): LocalProviderResponseFailure | null {
  const status = typeof response.status === "number" ? response.status : 0;
  const httpFailed = status < 200 || status >= 300;
  if (provider.provider === "openrouter_byok") {
    const embeddedIssue = openRouterEmbeddedIssueKind(response.body);
    if (httpFailed || embeddedIssue) {
      const issueKind = embeddedIssue ?? openRouterIssueKindFromResponse(status, response.body);
      // Return the kind alongside the prose. Rendering to a message and parsing
      // it back is how this cause used to be lost on the way to telemetry.
      return { message: openRouterConnectionFailureMessage(issueKind, status), issueKind };
    }
  }
  return httpFailed
    ? { message: `Local AI classification failed with HTTP ${status || "unknown"}.` }
    : null;
}

async function readClassificationWorkProfile(useLocalFallback: boolean): Promise<string | null> {
  return (await readClassificationPromptIdentity(useLocalFallback)).workProfile;
}

async function readClassificationPromptIdentity(useLocalFallback: boolean): Promise<{
  ownerId: string | null;
  workProfile: string | null;
}> {
  const signedInUserId = await readSignedInUserId();
  const onboardingUserId = signedInUserId ?? (useLocalFallback ? "local" : null);
  if (!onboardingUserId) return { ownerId: null, workProfile: null };
  return {
    ownerId: onboardingUserId,
    workProfile: normalizeOnboardingWorkProfile(readUserOnboardingState(onboardingUserId)),
  };
}

/**
 * Work profile string for AI prompts, honoring the privacy toggle. Null when the
 * user opted out of sending it or no profile exists. Shared by the live
 * classification path and the heavy project pass so both ground on the same context.
 */
export async function resolveClassificationWorkProfileForPrompt(useLocalFallback: boolean): Promise<string | null> {
  if (!readAiPrivacyRequestSettings().optional.workProfile) return null;
  return readClassificationWorkProfile(useLocalFallback);
}

async function readSignedInUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const session = isRecord(data) ? data.session : null;
    const user = isRecord(session) ? session.user : null;
    return isRecord(user) && typeof user.id === "string" && user.id ? user.id : null;
  } catch {
    return null;
  }
}


function stripJsonCodeFence(text: string): string {
  const trimmed = stripLeadingReasoningBlock(text.trim());
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function stripLeadingReasoningBlock(text: string): string {
  return text.replace(/^<think>[\s\S]*?<\/think>\s*/i, "").trim();
}

async function requireCloudAiClassification(): Promise<CloudAiClassificationAccess> {
  if (!supabase) {
    return {
      kind: "blocked",
      summary: {
        status: "disabled",
        selectedSegments: 0,
        savedRecords: 0,
        message: "Supabase is not configured.",
      },
    };
  }

  const { data: authData } = await supabase.auth.getSession();
  if (!authData.session) {
    return {
      kind: "blocked",
      summary: {
        status: "disabled",
        selectedSegments: 0,
        savedRecords: 0,
        message: "Sign in to run AI classification.",
      },
    };
  }

  const session = isRecord(authData.session) ? authData.session : null;
  const sessionUser = session && isRecord(session.user) ? session.user : null;
  const userId = sessionUser && typeof sessionUser.id === "string" ? sessionUser.id.trim() : "";
  if (!userId) {
    return {
      kind: "blocked",
      summary: {
        status: "disabled",
        selectedSegments: 0,
        savedRecords: 0,
        message: "Account identity is unavailable. Sign in again to run AI classification.",
      },
    };
  }
  return { kind: "allowed", requestKey: userId };
}

function assertCloudAiRequestAllowed(context: CloudAiRequestContext): void {
  if (context.bypassBackoff) return;
  const backoff = cloudAiRequestBackoffs.current(context.requestKey);
  if (backoff) throw new Error(cloudAiBackoffMessage(backoff));
}

export function clearCloudAiRequestBackoff(): void {
  cloudAiRequestBackoffs.clear();
}

function isActivityCategory(value: unknown): value is ActivityCategory {
  return typeof value === "string" && ACTIVITY_CATEGORIES.has(value as ActivityCategory);
}

function isLiveActivityIntent(value: unknown): value is LiveActivityIntent {
  return typeof value === "string" && LIVE_INTENTS.has(value as LiveActivityIntent);
}

function isProductivityLabel(value: unknown): value is ProductivityLabel {
  return typeof value === "string" && PRODUCTIVITY_LABELS.has(value as ProductivityLabel);
}

function normalizeContextualGuardServerAudit(value: unknown): {
  readonly rawProductivity: ProductivityLabel;
  readonly rawConfidence: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!isProductivityLabel(candidate.rawProductivity)) return null;
  if (typeof candidate.rawConfidence !== "number" || !Number.isFinite(candidate.rawConfidence)) return null;
  return {
    rawProductivity: candidate.rawProductivity,
    rawConfidence: Math.min(1, Math.max(0, candidate.rawConfidence)),
  };
}

function resolveProviderProductivity(
  classification: EdgeClassification,
  category: ActivityCategory,
  payload: MinimizedActivityPayload,
  memoryContext: LiveClassificationMemoryContext | null,
): ProductivityLabel | null {
  const item = toLiveClassificationPromptItem(payload);
  if (isLiveActivityIntent(classification.intent)) {
    return resolveLiveActivityClassificationProductivity(classification.intent, category, item, memoryContext);
  }
  if (!isProductivityLabel(classification.productivity)) return null;
  // Cloud responses and older local providers already contain productivity;
  // applying the narrow shopping gate again is deterministic and idempotent.
  return applyMatchedContextualDriftSafetyGuard(
    applyLiveShoppingEvidenceGuard(classification.productivity, category, item),
    category,
    item,
    memoryContext,
  );
}

function resolveRawProviderProductivity(
  classification: EdgeClassification,
): ProductivityLabel | null {
  if (isLiveActivityIntent(classification.intent)) {
    return productivityForLiveActivityIntent(classification.intent);
  }
  return isProductivityLabel(classification.productivity)
    ? classification.productivity
    : null;
}

type EdgeFunctionFailureDetail = {
  readonly message: string;
  readonly status: number | null;
  readonly errorType: string | null;
  readonly quotaWindow: Exclude<AiClassificationQuotaWindow, "unknown"> | null;
};

class AiClassificationEdgeError extends Error {
  readonly status: number | null;
  readonly errorType: string | null;
  readonly quotaWindow: Exclude<AiClassificationQuotaWindow, "unknown"> | null;

  constructor(detail: EdgeFunctionFailureDetail) {
    super(detail.message);
    this.name = "AiClassificationEdgeError";
    this.status = detail.status;
    this.errorType = detail.errorType;
    this.quotaWindow = detail.quotaWindow;
  }
}

export async function describeAiClassificationFailure(error: unknown): Promise<{
  readonly message: string;
  readonly failureKind: AiClassificationFailureKind;
  readonly quotaWindow?: AiClassificationQuotaWindow;
  readonly serverErrorType?: AiClassificationCloudErrorType;
}> {
  const detail = error instanceof AiClassificationEdgeError
    ? {
        message: error.message,
        status: error.status,
        errorType: error.errorType,
        quotaWindow: error.quotaWindow,
      }
    : await edgeFunctionFailureDetail(error);
  const quotaWindow = detail.quotaWindow ?? legacyQuotaWindowFromMessage(detail.message);
  const serverErrorType = isAiClassificationCloudErrorType(detail.errorType) ? detail.errorType : undefined;
  if (detail.errorType === "quota" || detail.status === 429 || quotaWindow) {
    return {
      message: detail.message,
      failureKind: "quota",
      quotaWindow: quotaWindow ?? "unknown",
    };
  }
  return { message: detail.message, failureKind: "transport", ...(serverErrorType ? { serverErrorType } : {}) };
}

function isAiClassificationCloudErrorType(value: string | null): value is AiClassificationCloudErrorType {
  return value === "quota" || value === "config" || value === "request" || value === "parse" || value === "schema";
}

async function edgeFunctionFailureDetail(error: unknown, signal?: AbortSignal): Promise<EdgeFunctionFailureDetail> {
  const fallback = error instanceof Error && error.message ? error.message : "AI classification failed.";
  const context = isRecord(error) ? error.context : null;
  if (context instanceof Response) {
    const detail = await readEdgeErrorBody(context, signal);
    if (detail) {
      return {
        message: `AI classification failed: ${detail.message}`,
        status: context.status || null,
        errorType: detail.errorType,
        quotaWindow: detail.quotaWindow,
      };
    }
  }
  return { message: fallback, status: null, errorType: null, quotaWindow: null };
}

type EdgeErrorBody = {
  readonly message: string;
  readonly errorType: string | null;
  readonly quotaWindow: Exclude<AiClassificationQuotaWindow, "unknown"> | null;
} | null;

// Error diagnostics can inspect the same response more than once (or at the
// same time). Share the bounded read without cloning an unconsumed stream;
// WeakMap ownership ends when the response/error is no longer reachable.
const edgeErrorBodies = new WeakMap<Response, Promise<EdgeErrorBody>>();

function readEdgeErrorBody(response: Response, signal?: AbortSignal): Promise<EdgeErrorBody> {
  let pending = edgeErrorBodies.get(response);
  if (!pending) {
    pending = consumeEdgeErrorBody(response, signal);
    edgeErrorBodies.set(response, pending);
  }
  return pending;
}

async function consumeEdgeErrorBody(response: Response, signal?: AbortSignal): Promise<EdgeErrorBody> {
  let text = "";
  try {
    text = await readBoundedCloudErrorText(response, signal);
  } catch {
    const message = response.status ? `${response.status} ${response.statusText}`.trim() : null;
    return message ? { message, errorType: null, quotaWindow: null } : null;
  }

  if (!text) {
    const message = response.status ? `${response.status} ${response.statusText}`.trim() : null;
    return message ? { message, errorType: null, quotaWindow: null } : null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      const errorType = typeof parsed.errorType === "string" ? parsed.errorType : null;
      const quotaWindow = isQuotaWindow(parsed.quotaWindow) ? parsed.quotaWindow : null;
      const message = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : null;
      if (message) {
        return {
          message,
          errorType,
          quotaWindow,
        };
      }
      if (errorType || quotaWindow) {
        return {
          message: response.status ? `${response.status} ${response.statusText}`.trim() : "AI classification failed.",
          errorType,
          quotaWindow,
        };
      }
    }
  } catch {
    // fall through to plain text
  }

  return { message: text.slice(0, 240), errorType: null, quotaWindow: null };
}

async function readBoundedCloudErrorText(response: Response, signal?: AbortSignal): Promise<string> {
  // This error response is consumed once and normalized before leaving the
  // service. Avoid clone/tee: cancelling one branch leaves the other buffered.
  const reader = response.body?.getReader();
  if (!reader) return "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Cloud error response did not complete."));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    // describeAiClassificationFailure can also be called outside an invocation.
    if (!signal) timer = setTimeout(abort, CLOUD_CLASSIFICATION_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder();
        let bytes = 0;
        let text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) return text + decoder.decode();
          bytes += value.byteLength;
          if (bytes > CLOUD_ERROR_BODY_MAX_BYTES) throw new Error("Cloud error response is too large.");
          text += decoder.decode(value, { stream: true });
        }
      })(),
      cancelled,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    // Some transports never acknowledge cancellation. It must not extend the
    // deadline; rejecting reads are already observed by Promise.race above.
    void reader.cancel().catch(() => undefined);
  }
}

function isQuotaWindow(value: unknown): value is Exclude<AiClassificationQuotaWindow, "unknown"> {
  return value === "minute" || value === "hour" || value === "day";
}

function legacyQuotaWindowFromMessage(message: string): Exclude<AiClassificationQuotaWindow, "unknown"> | null {
  if (/minute ai classification quota exceeded/i.test(message)) return "minute";
  if (/hourly ai classification quota exceeded/i.test(message)) return "hour";
  if (/daily ai classification quota exceeded/i.test(message)) return "day";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed;
}

function normalizeComparableText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

async function fingerprint(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `drifty-v3-${hex}`;
}

function emptyUsageSummary(): AiClassificationUsageSummary {
  return {
    requests: 0,
    llmRequests: 0,
    itemsRequested: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    quotaErrors: 0,
    configErrors: 0,
    requestErrors: 0,
    parseErrors: 0,
    schemaErrors: 0,
    lastErrorType: null,
    lastErrorMessage: null,
    lastErrorStatus: null,
    lastErrorAt: null,
    latencyMsTotal: 0,
    averageLatencyMs: 0,
    promptTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
}

function latestErrorValue<T>(currentAt: string | null, nextAt: string | null | undefined, currentValue: T, nextValue: T | null | undefined): T {
  if (!nextAt || nextValue === null || nextValue === undefined) return currentValue;
  if (!currentAt || new Date(nextAt).getTime() >= new Date(currentAt).getTime()) return nextValue;
  return currentValue;
}

export function estimateAiClassificationCostUsd(model: string | null | undefined, promptTokens: number, responseTokens: number): number {
  const price = model ? AI_MODEL_TOKEN_PRICES_USD_PER_MILLION[model] : undefined;
  if (!price) return 0;
  return (Math.max(numberValue(promptTokens), 0) / 1_000_000) * price.input
    + (Math.max(numberValue(responseTokens), 0) / 1_000_000) * price.output;
}

function numberValue(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function positiveDelta(after: number | null | undefined, before: number | null | undefined): number {
  return Math.max(numberValue(after) - numberValue(before), 0);
}

function responseLatencyMs(data: unknown): number | null {
  const response = data as EdgeClassificationResponse | null;
  return typeof response?.latencyMs === "number" && Number.isFinite(response.latencyMs) ? response.latencyMs : null;
}
