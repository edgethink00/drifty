import type { ActivitySegment } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { capturePostHogDailyEvent, toCountBucket, toDailyDedupKey } from "../../lib/analytics/posthogClient";
import { AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { readLivingSoulForUser, type LivingSoulDocument } from "./livingSoul";
import type { LocalAiProviderConfig } from "./localAiProviderRequest";
import {
  aggregateSuggestionSurfaces,
  detectSuggestionClusters,
  generateMemorySuggestions,
  suggestionShowsTitles,
  trackedSecondsSince,
  type SuggestionLanguage,
} from "./memorySuggestions";

export { trackedSecondsSince } from "./memorySuggestions";
import { createCloudSuggestionCompleter } from "./memorySuggestionCloud";
import { createLocalSuggestionCompleter } from "./memorySuggestionProvider";
import {
  MIN_NEW_TRACKED_HOURS,
  readSuggestionStore,
  recordFailedSuggestionRun,
  recordSuggestionRun,
  shouldRunSuggestions,
  toStoredSuggestion,
  writeSuggestionStore,
} from "./memorySuggestionStore";

/** Where suggestion sentences are written: the user's own provider, or Drifty Cloud. */
export type MemorySuggestionProvider =
  | { readonly kind: "local"; readonly provider: LocalAiProviderConfig }
  | { readonly kind: "cloud" };

export const MEMORY_SUGGESTIONS_CHANGED_EVENT = "drifty:memory-suggestions-changed";
export const MEMORY_SUGGESTION_WINDOW_DAYS = 7;

export type MemorySuggestionJobOutcome = "ran" | "failed" | "cancelled" | "not_due" | "busy" | "no_memory";

const running = new Map<string, Promise<MemorySuggestionJobOutcome>>();

export function isMemorySuggestionJobRunning(ownerId: string): boolean {
  return running.has(ownerId);
}

export function notifyMemorySuggestionsChanged(ownerId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MEMORY_SUGGESTIONS_CHANGED_EVENT, { detail: { ownerId } }));
}

/** "App / site" or "App" (as stored on a pattern origin) to the cluster key "App|site". */
function placeKey(activity: string): string {
  const [app, ...rest] = activity.split(" / ");
  return app + "|" + rest.join(" / ");
}

/**
 * Places the user already ruled out: suggestions they dismissed, and adopted
 * suggestions they later marked Not right. They are never proposed again.
 */
export function blockedSuggestionPlaces(document: LivingSoulDocument | null, declinedIds: readonly string[]): Set<string> {
  const blocked = new Set(declinedIds.map((id) => id.slice(id.indexOf(":") + 1)));
  for (const entry of Object.values(document?.memoryControls?.rejectedPatterns ?? {})) {
    if (entry.origin?.source === "suggestion" && entry.origin.activity) blocked.add(placeKey(entry.origin.activity));
  }
  return blocked;
}

/**
 * Places that already have an answer: blocked ones, a suggestion still waiting
 * for the user, or a suggestion they adopted. Re-drafting those would quietly
 * change a sentence the user is reading, or duplicate one they kept.
 */
export function settledSuggestionPlaces(
  document: LivingSoulDocument | null,
  store: { readonly declined: readonly string[]; readonly suggestions: readonly { readonly id: string }[] },
): Set<string> {
  const places = blockedSuggestionPlaces(document, store.declined);
  for (const suggestion of store.suggestions) places.add(suggestion.id.slice(suggestion.id.indexOf(":") + 1));
  for (const origin of Object.values(document?.memoryControls?.origins ?? {})) {
    if (origin.source === "suggestion" && origin.activity) places.add(placeKey(origin.activity));
  }
  return places;
}

export type RunMemorySuggestionJobInput = {
  readonly ownerId: string;
  readonly provider: MemorySuggestionProvider;
  readonly language: SuggestionLanguage;
  readonly now?: Date;
  readonly loadSegments?: (range: { readonly start: string; readonly end: string }) => Promise<readonly ActivitySegment[]>;
  /** Newly tracked hours since the previous run required before running again. */
  readonly minNewTrackedHours?: number;
  /** The initiating view's owner/provider generation must still be active. */
  readonly isCurrent?: () => boolean;
};

/**
 * Looks through the last week of local activity once enough new activity has
 * been tracked since the previous run (MIN_NEW_TRACKED_HOURS), and stores the few
 * suggestions that pass detection, validation and verification. Safe to call
 * often: it returns quickly when a run is not due or already running.
 */
export function runMemorySuggestionJobIfDue(input: RunMemorySuggestionJobInput): Promise<MemorySuggestionJobOutcome> {
  const existing = running.get(input.ownerId);
  if (existing) return Promise.resolve<MemorySuggestionJobOutcome>("busy");
  const now = input.now ?? new Date();
  if (!shouldRunSuggestions(readSuggestionStore(input.ownerId), now)) return Promise.resolve<MemorySuggestionJobOutcome>("not_due");
  const job = runJob(input, now).finally(() => {
    running.delete(input.ownerId);
    notifyMemorySuggestionsChanged(input.ownerId);
  });
  running.set(input.ownerId, job);
  notifyMemorySuggestionsChanged(input.ownerId);
  return job;
}

async function runJob(input: RunMemorySuggestionJobInput, now: Date): Promise<MemorySuggestionJobOutcome> {
  const settings = readAiPrivacyRequestSettings();
  const privacy = { windowTitle: settings.optional.windowTitle, contentContext: settings.optional.contentContext };
  let cancelled = false;
  const canSend = () => {
    const current = readAiPrivacyRequestSettings().optional;
    cancelled ||= input.isCurrent?.() === false
      || current.windowTitle !== privacy.windowTitle || current.contentContext !== privacy.contentContext;
    return !cancelled;
  };
  const onPrivacyChange = () => { canSend(); };
  if (typeof window !== "undefined") window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, onPrivacyChange);
  try {
    if (!canSend()) return "cancelled";
    // Accepting a suggestion writes into Soul.md, so there must be a readable one.
    const soul = await readLivingSoulForUser(input.ownerId);
    if (!canSend()) return "cancelled";
    if (soul.state !== "ready") return "no_memory";
    const document = soul.context.document;
    const until = now.toISOString();
    const since = new Date(now.getTime() - MEMORY_SUGGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const load = input.loadSegments ?? ((range) => trackerClient.getTimeline(range));
    // Count only activity tracked after the previous run; read the full week only when enough is new.
    const lastRunAt = readSuggestionStore(input.ownerId).lastRunAt;
    const countFrom = lastRunAt && lastRunAt > since ? lastRunAt : since;
    const recent = await load({ start: countFrom, end: until });
    if (!canSend()) return "cancelled";
    const requiredSeconds = (input.minNewTrackedHours ?? MIN_NEW_TRACKED_HOURS) * 3600;
    if (trackedSecondsSince(recent, countFrom, until) < requiredSeconds) return "not_due";
    const segments = countFrom === since ? recent : await load({ start: since, end: until });
    if (!canSend()) return "cancelled";
    const answered = settledSuggestionPlaces(document, readSuggestionStore(input.ownerId));
    const clusters = detectSuggestionClusters(aggregateSuggestionSurfaces(segments, { since, until }))
      .filter((cluster) => !answered.has(cluster.key));
    const existing = [
      ...Object.values(document.learned).flat().map((pattern) => pattern.summary),
      ...Object.values(document.memoryControls?.rejectedPatterns ?? {}).map((entry) => entry.pattern.summary),
    ];
    const complete = input.provider.kind === "cloud"
      ? createCloudSuggestionCompleter(canSend, input.ownerId, () => { cancelled = true; })
      : createLocalSuggestionCompleter(input.provider.provider, canSend);
    const result = clusters.length === 0
      ? { suggestions: [], rejected: [] }
      : await generateMemorySuggestions({
        clusters, language: input.language, existingSummaries: existing, privacy,
        complete: async (request) => {
          if (!canSend()) return null;
          const response = await complete(request);
          return canSend() ? response : null;
        },
      });
    // Revoked settings invalidate the whole prepared result, including local
    // examples. Do not spend its activity watermark or failure retry allowance.
    if (!canSend()) return "cancelled";
    const store = readSuggestionStore(input.ownerId);
    const retryableFailure = result.rejected.some((entry) => entry.reason === "no_response");
    const next = recordSuggestionRun(store, result.suggestions.map((suggestion) => toStoredSuggestion(suggestion, { since, until }, until,
      { includeTitles: suggestionShowsTitles(privacy) })), existing, now);
    // Keep verified suggestions from a partial run, but leave unanswered
    // activity eligible for the hourly retry instead of requiring 20 new hours.
    writeSuggestionStore(input.ownerId, retryableFailure
      ? recordFailedSuggestionRun({ ...next, lastRunAt: store.lastRunAt }, now)
      : next);
    reportSuggestionRun(input.provider, retryableFailure ? "error" : clusters.length === 0 ? "skipped" : "success", clusters.length, result.suggestions.length);
    return retryableFailure ? "failed" : "ran";
  } catch {
    // Not recorded, so the next check tries again.
    return canSend() ? "failed" : "cancelled";
  } finally {
    if (typeof window !== "undefined") window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, onPrivacyChange);
  }
}

/**
 * Counts only: how often a run finds candidates and keeps a suggestion. No
 * sentence, place or title is sent. Runs are machine-driven, so at most one
 * event per combination per day.
 */
function reportSuggestionRun(provider: MemorySuggestionProvider, result: "success" | "skipped" | "error", candidates: number, added: number): void {
  const local = provider.kind === "local" ? provider.provider.provider : null;
  const properties = {
    provider_kind: provider.kind === "cloud" ? "cloud" as const : local === "managed_local" ? "local" as const : "custom" as const,
    result,
    candidate_count_bucket: toCountBucket(candidates),
    added_count_bucket: toCountBucket(added),
  };
  capturePostHogDailyEvent("memory_suggestion_run", toDailyDedupKey(properties), properties);
}
