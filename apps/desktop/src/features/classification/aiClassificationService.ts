import { classifyActivityDetailed, isYouTubeBrowsePage, isYouTubeVideoSegment } from "@drifty/domain";
import type {
  ActivityCategory,
  ActivityClassificationRecord,
  ActivitySegment,
  ClassificationMetrics,
  ClassificationQuery,
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
import { toLocalProviderRequest, type LocalAiProviderConfig, type MinimizedActivityPayload } from "./localAiProviderRequest";
import { normalizeOnboardingWorkProfile } from "./classificationWorkProfile";
import { readAiPrivacyRequestSettings, type AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";

const EDGE_MAX_BATCH_SIZE = 20;
const DEFAULT_BATCH_SIZE = EDGE_MAX_BATCH_SIZE;
export const AI_CLASSIFICATION_BACKGROUND_THRESHOLD = 20;
export const AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD = 5;
export const AI_CLASSIFICATION_FOCUSED_IDLE_MS = 20 * 60 * 1000;
const MAX_CLASSIFY_ALL_BATCHES = 100;
const MAX_TEXT_LENGTH = 160;
const MAX_YOUTUBE_CHANNEL_NAME_LENGTH = 120;
const MAX_YOUTUBE_CATEGORY_LENGTH = 80;
const AI_CLASSIFICATION_PROMPT_VERSION = "v5-privacy-youtube-category";
const YOUTUBE_BROWSE_INHERITANCE_WINDOW_MS = 3 * 60 * 1000;
const YOUTUBE_BROWSE_INHERITANCE_MAX_CONFIDENCE = 0.85;
const REDDIT_COMMUNITY_PATTERN = /\br\/([A-Za-z0-9_]{2,32})\b/i;
const REDDIT_DOMAIN_PATTERN = /(^|\.)reddit\.com$/i;
const VALID_REDDIT_COMMUNITY_PATTERN = /^[a-z0-9_]{2,32}$/;
const KNOWN_BROWSER_APP_NAMES = new Set(["arc", "brave browser", "chromium", "firefox", "google chrome", "google chrome canary", "microsoft edge", "safari"]);
const KNOWN_BROWSER_BUNDLE_IDS = new Set(["com.apple.safari", "com.brave.browser", "com.google.chrome", "com.google.chrome.canary", "com.microsoft.edgemac", "company.thebrowser.browser", "org.chromium.chromium", "org.mozilla.firefox"]);

const AI_MODEL_TOKEN_PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gemini-3.1-flash-lite": { input: 0, output: 0 },
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

type EdgeClassification = {
  id?: unknown;
  segmentId?: unknown;
  inputFingerprint?: unknown;
  category?: unknown;
  productivity?: unknown;
  confidence?: unknown;
  reason?: unknown;
  model?: unknown;
};

type EdgeClassificationResponse = {
  results?: unknown;
  classifications?: unknown;
  model?: unknown;
  latencyMs?: unknown;
};

export type AiClassificationRunOptions = {
  localProvider?: LocalAiProviderConfig | null;
  persistLiveResult?: boolean;
};

export type LiveAiClassificationResult =
  | { kind: "classified"; classification: ActivityClassificationRecord }
  | { kind: "unavailable"; reason: string };

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
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

export interface AiClassificationSummary {
  status: AiClassificationStatus;
  selectedSegments: number;
  savedRecords: number;
  message: string;
  metrics?: ClassificationMetrics;
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

export async function runAiClassification(query: ClassificationQuery, batchSize = DEFAULT_BATCH_SIZE, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  const selectedBatchSize = Math.min(query.limit ?? batchSize, EDGE_MAX_BATCH_SIZE);
  const segments = (await trackerClient.getUnclassifiedSegments({ ...query, limit: selectedBatchSize })).slice(0, selectedBatchSize);
  const privacySettings = readAiPrivacyRequestSettings();
  const workProfile = privacySettings.optional.workProfile ? await readClassificationWorkProfile(Boolean(options.localProvider)) : null;
  const payload = await Promise.all(segments.map((segment) => toMinimizedPayload(segment, workProfile, privacySettings)));

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
  const deterministicSaveResult = deterministicRecords.length > 0
    ? await trackerClient.saveClassifications(deterministicRecords)
    : { saved: 0 };
  const deterministicSegmentIds = new Set(deterministicRecords.map((record) => record.segmentId));
  const inheritedResult = await saveInheritedYouTubeBrowseClassifications(segments, payload, deterministicSegmentIds);
  const unknownPayload = payload.filter((item) => !deterministicSegmentIds.has(item.segmentId) && !inheritedResult.segmentIds.has(item.segmentId));
  const preAiSavedRecords = deterministicSaveResult.saved + inheritedResult.saved;

  if (unknownPayload.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "saved",
      selectedSegments: payload.length,
      savedRecords: preAiSavedRecords,
      message: `Saved ${preAiSavedRecords} local ${preAiSavedRecords === 1 ? "classification" : "classifications"}. No unknown segments needed AI.`,
      metrics,
    };
  }

  const reusableResult = await saveReusableAiClassifications(unknownPayload);
  if (reusableResult.misses.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    const savedRecords = preAiSavedRecords + reusableResult.saved;
    return {
      status: "saved",
      selectedSegments: payload.length,
      savedRecords,
      message: `Saved ${reusableResult.saved} reused AI and ${preAiSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}.`,
      metrics,
    };
  }

  if (options.localProvider) {
    return await runLocalAiClassification(query, payload.length, preAiSavedRecords + reusableResult.saved, reusableResult.misses, options.localProvider, workProfile);
  }

  const cloudAvailability = await requireCloudAiClassification();
  if (cloudAvailability) {
    const partialSummary = await savedPartialAiSummary(query, preAiSavedRecords, reusableResult.saved, reusableResult.misses.length, cloudAvailability.message);
    return partialSummary ?? cloudAvailability;
  }
  const cloudClient = supabase;
  if (!cloudClient) {
    const partialSummary = await savedPartialAiSummary(query, preAiSavedRecords, reusableResult.saved, reusableResult.misses.length, "Supabase is not configured.");
    return partialSummary ?? { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Supabase is not configured." };
  }

  const { data, error } = await cloudClient.functions.invoke("classify-activity", {
    body: await withCloudDevicePayload({
      ...cloudApiClientMetadata,
      ...(workProfile ? { workProfile } : {}),
      items: toEdgeClassificationRequestItems(reusableResult.misses),
    }),
  });

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error));
  }

  const aiRecords = toClassificationRecords(data, reusableResult.misses);
  if (aiRecords.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "error",
      selectedSegments: payload.length,
      savedRecords: preAiSavedRecords + reusableResult.saved,
      message: `AI classification returned no usable classifications for ${reusableResult.misses.length} unknown ${reusableResult.misses.length === 1 ? "segment" : "segments"}.`,
      metrics,
    };
  }

  const aiSaveResult = await trackerClient.saveClassifications(aiRecords);
  const metrics = await trackerClient.getClassificationMetrics(query);
  const savedRecords = preAiSavedRecords + reusableResult.saved + aiSaveResult.saved;
  return {
    status: "saved",
    selectedSegments: payload.length,
    savedRecords,
    message: `Saved ${aiSaveResult.saved} AI, ${reusableResult.saved} reused AI, and ${preAiSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}.`,
    metrics,
  };
}

export async function runAiClassificationForUnknownThreshold(query: ClassificationQuery, threshold: number, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  const selectedBatchSize = EDGE_MAX_BATCH_SIZE;
  const segments = (await trackerClient.getUnclassifiedSegments({ ...query, limit: selectedBatchSize })).slice(0, selectedBatchSize);
  const privacySettings = readAiPrivacyRequestSettings();
  const workProfile = privacySettings.optional.workProfile ? await readClassificationWorkProfile(Boolean(options.localProvider)) : null;
  const payload = await Promise.all(segments.map((segment) => toMinimizedPayload(segment, workProfile, privacySettings)));
  const deterministicRecords = toDeterministicClassificationRecords(segments, payload);
  const deterministicSegmentIds = new Set(deterministicRecords.map((record) => record.segmentId));
  const deterministicSaveResult = deterministicRecords.length > 0
    ? await trackerClient.saveClassifications(deterministicRecords)
    : { saved: 0 };
  const inheritedResult = await saveInheritedYouTubeBrowseClassifications(segments, payload, deterministicSegmentIds);
  const unknownPayload = payload
    .filter((item) => !deterministicSegmentIds.has(item.segmentId) && !inheritedResult.segmentIds.has(item.segmentId))
    .slice(0, threshold);
  const preAiSavedRecords = deterministicSaveResult.saved + inheritedResult.saved;

  const reusableResult = await saveReusableAiClassifications(unknownPayload);

  if (reusableResult.misses.length < threshold) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    if (reusableResult.saved > 0) {
      const savedRecords = preAiSavedRecords + reusableResult.saved;
      const remainingCandidates = reusableResult.misses.length;
      return {
        status: "saved",
        selectedSegments: preAiSavedRecords + reusableResult.saved,
        savedRecords,
        message: remainingCandidates > 0
          ? `Saved ${reusableResult.saved} reused AI and ${preAiSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}. Only ${remainingCandidates} unknown AI classification ${remainingCandidates === 1 ? "candidate" : "candidates"} found; waiting for ${threshold}.`
          : `Saved ${reusableResult.saved} reused AI and ${preAiSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}.`,
        metrics,
      };
    }

    return {
      status: preAiSavedRecords > 0 ? "saved" : "empty",
      selectedSegments: deterministicRecords.length + inheritedResult.segmentIds.size,
      savedRecords: preAiSavedRecords,
      message: preAiSavedRecords > 0
        ? `Saved ${preAiSavedRecords} local ${preAiSavedRecords === 1 ? "classification" : "classifications"}. Only ${reusableResult.misses.length} unknown AI classification ${reusableResult.misses.length === 1 ? "candidate" : "candidates"} found; waiting for ${threshold}.`
        : `Only ${reusableResult.misses.length} unknown AI classification ${reusableResult.misses.length === 1 ? "candidate" : "candidates"} found; waiting for ${threshold}.`,
      metrics,
    };
  }

  if (reusableResult.misses.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    const savedRecords = preAiSavedRecords + reusableResult.saved;
    return {
      status: "saved",
      selectedSegments: unknownPayload.length,
      savedRecords,
      message: `Saved ${reusableResult.saved} reused AI and ${preAiSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}.`,
      metrics,
    };
  }

  if (options.localProvider) {
    return await runLocalAiClassification(query, unknownPayload.length, preAiSavedRecords + reusableResult.saved, reusableResult.misses, options.localProvider, workProfile);
  }

  const cloudAvailability = await requireCloudAiClassification();
  if (cloudAvailability) {
    const partialSummary = await savedPartialAiSummary(query, preAiSavedRecords, reusableResult.saved, reusableResult.misses.length, cloudAvailability.message);
    return partialSummary ?? cloudAvailability;
  }
  const cloudClient = supabase;
  if (!cloudClient) {
    const partialSummary = await savedPartialAiSummary(query, preAiSavedRecords, reusableResult.saved, reusableResult.misses.length, "Supabase is not configured.");
    return partialSummary ?? { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Supabase is not configured." };
  }

  const { data, error } = await cloudClient.functions.invoke("classify-activity", {
    body: await withCloudDevicePayload({
      ...cloudApiClientMetadata,
      ...(workProfile ? { workProfile } : {}),
      items: toEdgeClassificationRequestItems(reusableResult.misses),
    }),
  });

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error));
  }

  const aiRecords = toClassificationRecords(data, reusableResult.misses);
  if (aiRecords.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "error",
      selectedSegments: unknownPayload.length,
      savedRecords: preAiSavedRecords + reusableResult.saved,
      message: `AI classification returned no usable classifications for ${reusableResult.misses.length} unknown ${reusableResult.misses.length === 1 ? "segment" : "segments"}.`,
      metrics,
    };
  }

  const aiSaveResult = await trackerClient.saveClassifications(aiRecords);
  const metrics = await trackerClient.getClassificationMetrics(query);
  const savedRecords = preAiSavedRecords + reusableResult.saved + aiSaveResult.saved;
  return {
    status: "saved",
    selectedSegments: unknownPayload.length,
    savedRecords,
    message: `Saved ${aiSaveResult.saved} AI, ${reusableResult.saved} reused AI, and ${preAiSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}.`,
    metrics,
  };
}

export async function classifyLiveActivityWithAi(segment: ActivitySegment, options: AiClassificationRunOptions = {}): Promise<LiveAiClassificationResult> {
  try {
    const privacySettings = readAiPrivacyRequestSettings();
    const workProfile = privacySettings.optional.workProfile ? await readClassificationWorkProfile(Boolean(options.localProvider)) : null;
    const payload = await toMinimizedPayload(segment, workProfile, privacySettings);
    const systemRecord = toSystemSkippedClassificationRecord(segment, payload, new Date().toISOString());
    if (systemRecord) {
      await saveLiveClassificationIfRequested(systemRecord, options.persistLiveResult);
      return unavailableLiveClassification(systemRecord.reason ?? "Skipped AI classification because activity context is unavailable.");
    }

    const reusableRecord = await readReusableAiClassification(payload);
    if (reusableRecord) {
      await saveLiveClassificationIfRequested(reusableRecord, options.persistLiveResult);
      return { kind: "classified", classification: reusableRecord };
    }

    if (options.localProvider) {
      return await saveLiveResultIfRequested(
        await classifyLivePayloadWithLocalAi(payload, options.localProvider, workProfile),
        options,
      );
    }

    return await saveLiveResultIfRequested(
      await classifyLivePayloadWithCloudAi(payload, workProfile),
      options,
    );
  } catch (error) {
    return unavailableLiveClassification(messageFromUnknownError(error, "AI classification unavailable."));
  }
}

async function saveLiveResultIfRequested(result: LiveAiClassificationResult, options: AiClassificationRunOptions): Promise<LiveAiClassificationResult> {
  if (result.kind === "classified") {
    await saveLiveClassificationIfRequested(result.classification, options.persistLiveResult);
  }
  return result;
}

export async function runAiClassificationUntilEmpty(query: ClassificationQuery, batchSize = DEFAULT_BATCH_SIZE, options: AiClassificationRunOptions = {}): Promise<AiClassificationSummary> {
  let selectedSegments = 0;
  let savedRecords = 0;
  let processedBatches = 0;
  let latestMetrics: ClassificationMetrics | undefined;

  for (let batchIndex = 0; batchIndex < MAX_CLASSIFY_ALL_BATCHES; batchIndex += 1) {
    const summary = await runAiClassification(query, batchSize, options);
    latestMetrics = summary.metrics ?? latestMetrics;
    selectedSegments += summary.selectedSegments;
    savedRecords += summary.savedRecords;

    if (summary.selectedSegments === 0 || summary.status === "empty") break;
    if (summary.status === "disabled" || summary.status === "error") {
      return { ...summary, selectedSegments, savedRecords, metrics: latestMetrics ?? summary.metrics };
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
  };
}

export function toClassificationQueryForDay(day: string, limit?: number): ClassificationQuery {
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

async function toMinimizedPayload(segment: ActivitySegment, workProfile: string | null, privacySettings: AiPrivacyRequestSettings): Promise<MinimizedActivityPayload> {
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
    durationSeconds: segment.durationSeconds,
    ...(workProfile ? { workProfile } : {}),
  };

  return {
    segmentId: segment.id,
    inputFingerprint: await fingerprint(JSON.stringify(providerInput)),
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
  return payload.map((item) => {
    const title = item.siteTitle ?? item.youtubeTitle;
    return {
      id: item.segmentId,
      inputFingerprint: item.inputFingerprint,
      appName: item.appName,
      domain: item.siteDomain,
      urlHost: item.siteDomain,
      ...(item.siteUrl ? { siteUrl: item.siteUrl } : {}),
      ...(item.windowTitle ? { windowTitle: item.windowTitle } : {}),
      ...(title ? { title } : {}),
      ...(item.redditCommunity ? { redditCommunity: item.redditCommunity } : {}),
      ...(item.youtubeChannelName ? { youtubeChannelName: item.youtubeChannelName } : {}),
      ...(item.youtubeCategory ? { youtubeCategory: item.youtubeCategory } : {}),
      durationSeconds: item.durationSeconds,
    };
  });
}

function sanitizeProviderSiteUrl(value: string | null | undefined): string | null {
  const parsedUrl = providerUrlFromRaw(value);
  if (!parsedUrl) return null;
  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
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
  if (normalizeComparableText(segment.appName) === "unavailable") {
    return "Skipped AI classification because the tracker could not determine the frontmost app.";
  }

  if (!isBrowserSegment(segment) || hasMeaningfulActivityContext(segment)) return null;

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

async function saveInheritedYouTubeBrowseClassifications(
  segments: ActivitySegment[],
  payload: MinimizedActivityPayload[],
  excludedSegmentIds: ReadonlySet<string>,
): Promise<{ saved: number; segmentIds: Set<string> }> {
  const payloadById = new Map(payload.map((item) => [item.segmentId, item]));
  const browseTargets = segments.filter((segment) => isYouTubeBrowsePage(segment) && !excludedSegmentIds.has(segment.id));
  if (browseTargets.length === 0) return { saved: 0, segmentIds: new Set<string>() };

  const timelineRange = youtubeBrowseInheritanceTimelineRange(browseTargets);
  if (!timelineRange) return { saved: 0, segmentIds: new Set<string>() };

  const timeline = await trackerClient.getTimeline(timelineRange);
  const inheritedRecords = browseTargets.map((segment) => toInheritedYouTubeBrowseClassificationRecord(segment, payloadById, timeline))
    .filter((record): record is ActivityClassificationRecord => record !== null);
  if (inheritedRecords.length === 0) return { saved: 0, segmentIds: new Set<string>() };

  const saveResult = await trackerClient.saveClassifications(inheritedRecords);
  return { saved: saveResult.saved, segmentIds: new Set(inheritedRecords.map((record) => record.segmentId)) };
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

function toClassificationRecords(data: unknown, payload: MinimizedActivityPayload[]): ActivityClassificationRecord[] {
  const response = data as EdgeClassificationResponse | EdgeClassification[] | null;
  const classifications = Array.isArray(response)
    ? response
    : Array.isArray(response?.results)
      ? response.results
      : Array.isArray(response?.classifications)
        ? response.classifications
        : [];
  const model = !Array.isArray(response) && typeof response?.model === "string" ? response.model : null;
  const payloadById = new Map(payload.map((item) => [item.segmentId, item]));
  const classifiedAt = new Date().toISOString();

  return classifications.flatMap((entry): ActivityClassificationRecord[] => {
    const classification = entry as EdgeClassification;
    const segmentId = typeof classification.segmentId === "string"
      ? classification.segmentId
      : typeof classification.id === "string"
        ? classification.id
        : "";
    const sourcePayload = payloadById.get(segmentId);
    if (!sourcePayload || !isActivityCategory(classification.category) || !isProductivityLabel(classification.productivity)) return [];

    return [{
      segmentId,
      inputFingerprint: typeof classification.inputFingerprint === "string" ? classification.inputFingerprint : sourcePayload.inputFingerprint,
      category: classification.category,
      productivity: classification.productivity,
      source: "llm",
      confidence: typeof classification.confidence === "number" ? classification.confidence : 0.5,
      reason: typeof classification.reason === "string" ? classification.reason : null,
      model: typeof classification.model === "string" ? classification.model : model,
      promptVersion: AI_CLASSIFICATION_PROMPT_VERSION,
      taxonomyVersion: "v1",
      aiResult: true,
      // Fresh responses must always carry a latency so fingerprint-cache reuse
      // (which stores none) stays distinguishable as "AI cache" downstream.
      latencyMs: responseLatencyMs(data) ?? 0,
      classifiedAt,
    }];
  });
}

async function saveReusableAiClassifications(unknownPayload: MinimizedActivityPayload[]): Promise<{ saved: number; misses: MinimizedActivityPayload[] }> {
  if (unknownPayload.length === 0) return { saved: 0, misses: [] };

  const uniqueFingerprints = Array.from(new Set(unknownPayload.map((item) => item.inputFingerprint)));
  const reusableByFingerprint = await trackerClient.getReusableAiClassifications(uniqueFingerprints);
  const reusableRecords = toReusableClassificationRecords(unknownPayload, reusableByFingerprint);
  const reusableFingerprintSet = new Set(reusableRecords.map((record) => record.inputFingerprint));
  const misses = unknownPayload.filter((item) => !reusableFingerprintSet.has(item.inputFingerprint));
  if (reusableRecords.length === 0) return { saved: 0, misses };

  const saveResult = await trackerClient.saveClassifications(reusableRecords);
  return { saved: saveResult.saved, misses };
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

async function savedPartialAiSummary(
  query: ClassificationQuery,
  localSavedRecords: number,
  reusedSavedRecords: number,
  remainingUnknownSegments: number,
  blockerMessage: string,
): Promise<AiClassificationSummary | null> {
  const savedRecords = localSavedRecords + reusedSavedRecords;
  if (savedRecords === 0) return null;

  const metrics = await trackerClient.getClassificationMetrics(query);
  const remainingLabel = remainingUnknownSegments === 1 ? "segment" : "segments";
  return {
    status: "saved",
    selectedSegments: savedRecords,
    savedRecords,
    message: `Saved ${reusedSavedRecords} reused AI and ${localSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}. ${blockerMessage} Run AI classification for the remaining ${remainingUnknownSegments} unknown ${remainingLabel} after fixing provider access.`,
    metrics,
  };
}

async function classifyLivePayloadWithLocalAi(
  payload: MinimizedActivityPayload,
  provider: LocalAiProviderConfig,
  workProfile: string | null,
): Promise<LiveAiClassificationResult> {
  const providerRequest = toLocalProviderRequest(provider, [payload], workProfile);
  if (!providerRequest) return unavailableLiveClassification("Local AI provider is not fully configured.");

  try {
    const response = await invokeOpenAiChatWithManagedLocalRetry(
      providerRequest.request,
      provider.provider === "managed_local" ? provider : null,
    );
    const status = typeof response.status === "number" ? response.status : 0;
    if (status < 200 || status >= 300) {
      return unavailableLiveClassification(`Local AI classification failed with HTTP ${status || "unknown"}.`);
    }

    const data = toLocalClassificationResponse(response, providerRequest.model);
    return firstLiveClassification(data, payload, "Local AI classification returned no usable classification.");
  } catch (error) {
    return unavailableLiveClassification(messageFromUnknownError(error, "Local AI classification failed."));
  }
}

async function classifyLivePayloadWithCloudAi(payload: MinimizedActivityPayload, workProfile: string | null): Promise<LiveAiClassificationResult> {
  const cloudAvailability = await requireCloudAiClassification();
  if (cloudAvailability) return unavailableLiveClassification(cloudAvailability.message);

  const cloudClient = supabase;
  if (!cloudClient) return unavailableLiveClassification("Supabase is not configured.");

  try {
    const { data, error } = await cloudClient.functions.invoke("classify-activity", {
      body: await withCloudDevicePayload({
        ...cloudApiClientMetadata,
        ...(workProfile ? { workProfile } : {}),
        items: toEdgeClassificationRequestItems([payload]),
      }),
    });

    if (error) return unavailableLiveClassification(await edgeFunctionErrorMessage(error));
    return firstLiveClassification(data, payload, "AI classification returned no usable classification.");
  } catch (error) {
    return unavailableLiveClassification(messageFromUnknownError(error, "AI classification failed."));
  }
}

function firstLiveClassification(data: unknown, payload: MinimizedActivityPayload, unavailableReason: string): LiveAiClassificationResult {
  const records = toClassificationRecords(data, [payload]);
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
  query: ClassificationQuery,
  selectedSegments: number,
  deterministicSavedRecords: number,
  unknownPayload: MinimizedActivityPayload[],
  provider: LocalAiProviderConfig,
  workProfile: string | null,
): Promise<AiClassificationSummary> {
  const providerRequest = toLocalProviderRequest(provider, unknownPayload, workProfile);
  if (!providerRequest) {
    return {
      status: "disabled",
      selectedSegments: 0,
      savedRecords: 0,
      message: "Local AI provider is not fully configured.",
    };
  }

  const response = await invokeOpenAiChatWithManagedLocalRetry(
    providerRequest.request,
    provider.provider === "managed_local" ? provider : null,
  );
  const status = typeof response.status === "number" ? response.status : 0;
  if (status < 200 || status >= 300) {
    throw new Error(`Local AI classification failed with HTTP ${status || "unknown"}.`);
  }

  const data = toLocalClassificationResponse(response, providerRequest.model);
  const aiRecords = toClassificationRecords(data, unknownPayload);
  if (aiRecords.length === 0) {
    const metrics = await trackerClient.getClassificationMetrics(query);
    return {
      status: "error",
      selectedSegments,
      savedRecords: deterministicSavedRecords,
      message: `AI classification returned no usable classifications for ${unknownPayload.length} unknown ${unknownPayload.length === 1 ? "segment" : "segments"}.`,
      metrics,
    };
  }

  const aiSaveResult = await trackerClient.saveClassifications(aiRecords);
  const metrics = await trackerClient.getClassificationMetrics(query);
  const savedRecords = deterministicSavedRecords + aiSaveResult.saved;
  return {
    status: "saved",
    selectedSegments,
    savedRecords,
    message: `Saved ${aiSaveResult.saved} AI and ${deterministicSavedRecords} local ${savedRecords === 1 ? "classification" : "classifications"}.`,
    metrics,
  };
}

function toLocalClassificationResponse(response: NativeOpenAiChatResponse, model: string): EdgeClassificationResponse {
  const bodyText = typeof response.body === "string" ? response.body : "";
  const body = JSON.parse(bodyText) as OpenAiChatResponse;
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("\n")
    : "";
  if (!text.trim()) return { model, latencyMs: responseLatencyMs(response), results: [] };
  const parsed = JSON.parse(stripJsonCodeFence(text)) as EdgeClassificationResponse;
  return {
    ...parsed,
    model,
    latencyMs: responseLatencyMs(response),
  };
}

async function readClassificationWorkProfile(useLocalFallback: boolean): Promise<string | null> {
  const signedInUserId = await readSignedInUserId();
  const onboardingUserId = signedInUserId ?? (useLocalFallback ? "local" : null);
  if (!onboardingUserId) return null;
  return normalizeOnboardingWorkProfile(readUserOnboardingState(onboardingUserId));
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

async function requireCloudAiClassification(): Promise<AiClassificationSummary | null> {
  if (!supabase) {
    return {
      status: "disabled",
      selectedSegments: 0,
      savedRecords: 0,
      message: "Supabase is not configured.",
    };
  }

  const { data: authData } = await supabase.auth.getSession();
  if (!authData.session) {
    return {
      status: "disabled",
      selectedSegments: 0,
      savedRecords: 0,
      message: "Sign in to run AI classification.",
    };
  }

  return null;
}

function isActivityCategory(value: unknown): value is ActivityCategory {
  return typeof value === "string" && ACTIVITY_CATEGORIES.has(value as ActivityCategory);
}

function isProductivityLabel(value: unknown): value is ProductivityLabel {
  return typeof value === "string" && PRODUCTIVITY_LABELS.has(value as ProductivityLabel);
}

async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : "AI classification failed.";
  const context = isRecord(error) ? error.context : null;
  if (context instanceof Response) {
    const detail = await readEdgeErrorBody(context);
    if (detail) return `AI classification failed: ${detail}`;
  }
  return fallback;
}

async function readEdgeErrorBody(response: Response): Promise<string | null> {
  let text = "";
  try {
    text = await response.clone().text();
  } catch {
    return response.status ? `${response.status} ${response.statusText}`.trim() : null;
  }

  if (!text) return response.status ? `${response.status} ${response.statusText}`.trim() : null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      if (typeof parsed.error === "string") return parsed.error;
      if (typeof parsed.message === "string") return parsed.message;
    }
  } catch {
    // fall through to plain text
  }

  return text.slice(0, 240);
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
