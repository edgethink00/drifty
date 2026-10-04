import type {
  ActivityCategory,
  ActivitySegment,
  ProductivityLabel,
  RecentEpisodePromptContext,
} from "@drifty/domain";
import { buildLivingSoulRefinementPrompt } from "@drifty/domain";

import { cloudApiClientMetadata } from "../../lib/cloudContract";
import { supabase } from "../../lib/supabase/client";
import { withCloudDevicePayload } from "../cloud-devices/cloudDeviceIdentity";
import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { invokeOpenAiChatWithManagedLocalRetry } from "./managedLocalAiChat";
import {
  toLocalSoulRefinementRequest,
  type LocalAiProviderConfig,
} from "./localAiProviderRequest";
import {
  livingSoulLimits,
  resolveLivingSoulForClassification,
  updateLivingSoulLearnedState,
  type LivingSoulLearnedState,
  type LivingSoulPattern,
  type LivingSoulResolvedContext,
} from "./livingSoul";
import { buildRecentEpisodeContext } from "./recentEpisodeContext";

export type SoulFeedbackKind = "not_drift" | "manual_correction";

export type SoulLearningProvider =
  | { readonly kind: "local"; readonly provider: LocalAiProviderConfig }
  | { readonly kind: "cloud" }
  | { readonly kind: "none" };

export type SoulFeedback = {
  readonly kind: SoulFeedbackKind;
  readonly segment: ActivitySegment;
  readonly correctedCategory: ActivityCategory;
  readonly correctedProductivity: ProductivityLabel;
  readonly occurredAt: string;
};

const refinementQueues = new Map<string, Promise<void>>();

export function learnLivingSoulFromFeedback(input: {
  readonly feedback: SoulFeedback;
  readonly contextSegments: readonly ActivitySegment[];
  readonly provider: SoulLearningProvider;
}): Promise<void> {
  const useLocalFallback = input.provider.kind !== "cloud";
  return resolveLivingSoulForClassification(useLocalFallback).then((resolved) => {
    if (!resolved) return;
    return queueRefinement(resolved.ownerId, () => learnLivingSoulFromFeedbackNow(input, resolved.ownerId));
  });
}

export const buildSoulRefinementPrompt = buildLivingSoulRefinementPrompt;

async function learnLivingSoulFromFeedbackNow(input: {
  readonly feedback: SoulFeedback;
  readonly contextSegments: readonly ActivitySegment[];
  readonly provider: SoulLearningProvider;
}, ownerId: string): Promise<void> {
  const useLocalFallback = input.provider.kind !== "cloud";
  // Re-read after entering the owner queue. A provider can be changed while a
  // previous refinement is in flight; owner-scoped serialization prevents the
  // later response from replacing learned state based on a stale revision.
  const current = await resolveLivingSoulForClassification(useLocalFallback, ownerId);
  if (!current) return;
  const privacySettings = readAiPrivacyRequestSettings();
  const episode = buildRecentEpisodeContext({
    current: input.feedback.segment,
    segments: input.contextSegments,
    privacySettings,
  });
  let learned: LivingSoulLearnedState | null = null;

  if (privacySettings.optional.workProfile && input.provider.kind !== "none") {
    const safeFeedback = providerSafeFeedback(input.feedback);
    const refinementEpisode = privacySafeSoulRefinementEpisode(episode);
    const prompt = buildSoulRefinementPrompt({
      current: current.promptContext,
      feedback: safeFeedback,
      episode: refinementEpisode,
    });
    learned = input.provider.kind === "local"
      ? await refineWithLocalProvider(input.provider.provider, prompt, current, input.feedback.occurredAt, [])
      : await refineWithCloudProvider(current, safeFeedback, refinementEpisode, input.feedback.occurredAt, []);
  }

  await updateLivingSoulLearnedState({
    ownerId: current.ownerId,
    learned: learned ?? deterministicFallbackLearning(current.document.learned, input.feedback, episode),
    feedbackAt: input.feedback.occurredAt,
    expectedRevision: current.document.revision,
    feedbackKind: input.feedback.kind,
    feedbackActivity: input.feedback.segment.appName,
    feedbackProductivity: input.feedback.correctedProductivity,
  });
}

async function refineWithLocalProvider(
  provider: LocalAiProviderConfig,
  prompt: string,
  current: LivingSoulResolvedContext,
  feedbackAt: string,
  privateFragments: readonly string[],
): Promise<LivingSoulLearnedState | null> {
  try {
    const request = toLocalSoulRefinementRequest(provider, prompt);
    if (!request) return null;
    const response = await invokeOpenAiChatWithManagedLocalRetry(
      request.request,
      provider.provider === "managed_local" ? provider : null,
    );
    const status = typeof response.status === "number" ? response.status : 0;
    if (status < 200 || status >= 300 || typeof response.body !== "string") return null;
    const parsedBody: unknown = JSON.parse(response.body);
    const content = openAiResponseContent(parsedBody);
    return content ? parseSoulRefinement(content, current.document.learned, feedbackAt, privateFragments) : null;
  } catch {
    return null;
  }
}

async function refineWithCloudProvider(
  current: LivingSoulResolvedContext,
  feedback: ReturnType<typeof providerSafeFeedback>,
  recentEpisode: RecentEpisodePromptContext,
  feedbackAt: string,
  privateFragments: readonly string[],
): Promise<LivingSoulLearnedState | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke("classify-activity", {
      body: await withCloudDevicePayload({
        ...cloudApiClientMetadata,
        mode: "refine_soul",
        currentSoul: current.promptContext,
        feedback,
        recentEpisode,
      }),
    });
    if (error) return null;
    return parseSoulRefinement(data, current.document.learned, feedbackAt, privateFragments);
  } catch {
    return null;
  }
}

function providerSafeFeedback(
  feedback: SoulFeedback,
) {
  const segment = feedback.segment;
  return {
    kind: feedback.kind,
    occurredAt: feedback.occurredAt,
    correctedCategory: feedback.correctedCategory,
    correctedProductivity: feedback.correctedProductivity,
    activity: {
      appName: cleanText(segment.appName, 120) ?? "Unknown",
      domain: cleanText(segment.siteDomain, 160),
      durationSeconds: Math.max(0, Math.min(1_800, Math.round(segment.durationSeconds))),
    },
  };
}

export function privacySafeSoulRefinementEpisode(
  episode: RecentEpisodePromptContext,
): RecentEpisodePromptContext {
  return {
    ...episode,
    transitions: episode.transitions.map(({ title: _title, ...transition }) => transition),
  };
}

export function parseSoulRefinement(
  value: unknown,
  current: LivingSoulLearnedState,
  feedbackAt: string,
  privateFragments: readonly string[] = [],
): LivingSoulLearnedState | null {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(stripJsonCodeFence(value));
    } catch {
      return null;
    }
  }
  if (!isRecord(candidate)) return null;
  const workSupport = parsePatternArray(candidate.learnedWorkSupport, livingSoulLimits.maxWorkSupportPatterns, current, feedbackAt, privateFragments);
  const drift = parsePatternArray(candidate.learnedDrift, livingSoulLimits.maxDriftPatterns, current, feedbackAt, privateFragments);
  const ambiguities = parsePatternArray(candidate.ambiguities, livingSoulLimits.maxAmbiguityPatterns, current, feedbackAt, privateFragments);
  return workSupport && drift && ambiguities ? { workSupport, drift, ambiguities } : null;
}

function parsePatternArray(
  value: unknown,
  limit: number,
  current: LivingSoulLearnedState,
  feedbackAt: string,
  privateFragments: readonly string[],
): LivingSoulPattern[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const previousBySummary = new Map(
    [...current.workSupport, ...current.drift, ...current.ambiguities]
      .map((pattern) => [pattern.summary.toLocaleLowerCase(), pattern] as const),
  );
  const patterns: LivingSoulPattern[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const summary = cleanPatternSummary(item.summary, privateFragments);
    if (!summary) return null;
    const previous = previousBySummary.get(summary.toLocaleLowerCase());
    // The model chooses semantic organization, never accumulated evidence.
    // Existing metadata is host-owned; a new or rewritten pattern starts low
    // with exactly one explicit correction behind it.
    patterns.push(previous
      ? { ...previous, summary }
      : { summary, confidence: "low", evidenceCount: 1, lastObservedAt: feedbackAt });
  }
  return patterns;
}

function deterministicFallbackLearning(
  current: LivingSoulLearnedState,
  feedback: SoulFeedback,
  episode: RecentEpisodePromptContext,
): LivingSoulLearnedState {
  const surface = cleanText(feedback.segment.siteDomain, 80) ?? cleanText(feedback.segment.appName, 80) ?? "this surface";
  const flowQualifier = episode.transitions.length > 1 ? " when it follows a related work or research flow" : " when surrounding intent supports it";
  const summary = feedback.correctedProductivity === "focus"
    ? `Using ${surface} can support work${flowQualifier}.`
    : feedback.correctedProductivity === "drift"
      ? `Using ${surface} can be drift when the surrounding sequence is leisure.`
      : `${surface} is not always drift; classify it from the surrounding sequence.`;
  const nextPattern: LivingSoulPattern = {
    summary,
    confidence: "low",
    evidenceCount: 1,
    lastObservedAt: feedback.occurredAt,
  };
  if (feedback.correctedProductivity === "focus") {
    return { ...current, workSupport: mergeFallbackPattern(current.workSupport, nextPattern, livingSoulLimits.maxWorkSupportPatterns) };
  }
  if (feedback.correctedProductivity === "drift") {
    return { ...current, drift: mergeFallbackPattern(current.drift, nextPattern, livingSoulLimits.maxDriftPatterns) };
  }
  return { ...current, ambiguities: mergeFallbackPattern(current.ambiguities, nextPattern, livingSoulLimits.maxAmbiguityPatterns) };
}

function mergeFallbackPattern(
  patterns: readonly LivingSoulPattern[],
  next: LivingSoulPattern,
  limit: number,
): LivingSoulPattern[] {
  const existingIndex = patterns.findIndex((pattern) => pattern.summary.toLocaleLowerCase() === next.summary.toLocaleLowerCase());
  const merged = [...patterns];
  if (existingIndex >= 0) {
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      confidence: existing.evidenceCount >= 2 ? "medium" : existing.confidence,
      evidenceCount: Math.min(99, existing.evidenceCount + 1),
      lastObservedAt: next.lastObservedAt,
    };
  } else {
    merged.unshift(next);
  }
  return merged.slice(0, limit);
}

function openAiResponseContent(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  const content = choice.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content.flatMap((part) => isRecord(part) && typeof part.text === "string" ? [part.text] : []).join("\n") || null;
}

function cleanPatternSummary(value: unknown, privateFragments: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  const withoutUrls = value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[site]")
    .replace(/["“”'‘’][^"“”'‘’]{2,}["“”'‘’]/g, "[private context]");
  const cleaned = cleanText(withoutUrls, 240);
  if (!cleaned || privateFragments.some((fragment) => hasSensitiveTextOverlap(cleaned, fragment))) return null;
  return cleaned;
}

function hasSensitiveTextOverlap(summary: string, privateFragment: string): boolean {
  const summaryTokens = textTokens(summary);
  const privateTokens = textTokens(privateFragment);
  if (privateTokens.some((token) => token.length >= 8 && summaryTokens.includes(token))) return true;
  const summaryPairs = new Set(summaryTokens.slice(0, -1).map((token, index) => `${token} ${summaryTokens[index + 1]}`));
  return privateTokens.slice(0, -1).some((token, index) => {
    const next = privateTokens[index + 1];
    return token.length >= 3 && next.length >= 3 && summaryPairs.has(`${token} ${next}`);
  });
}

function textTokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function cleanText(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = value
    ?.replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength).trim() || null : null;
}

function stripJsonCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queueRefinement(ownerId: string, operation: () => Promise<void>): Promise<void> {
  const previous = refinementQueues.get(ownerId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  refinementQueues.set(ownerId, next);
  void next.finally(() => {
    if (refinementQueues.get(ownerId) === next) refinementQueues.delete(ownerId);
  }).catch(() => undefined);
  return next;
}
