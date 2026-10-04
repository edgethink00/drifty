import type { MemorySuggestion, SuggestionEvidence, SuggestionKind } from "./memorySuggestions";

/**
 * Pending suggested memories, kept in local storage per owner. They are not part
 * of Soul.md and never reach a provider prompt; a suggestion only becomes a
 * learned pattern after the user accepts it. A few example titles are kept on
 * this device, only when the title privacy settings allow them, so the user can
 * see what a suggestion was based on before adding it.
 */

export type SuggestionExample = {
  readonly title: string;
  readonly filedAs: SuggestionEvidence["filedAs"];
  readonly minutes: number;
};

export type StoredSuggestion = {
  readonly id: string;
  readonly kind: SuggestionKind;
  readonly summary: string;
  readonly app: string;
  readonly domain: string;
  readonly minutes: number;
  readonly days: number;
  readonly blocks: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly createdAt: string;
  /** Largest records behind the suggestion, one from each side first. Absent when titles are off. */
  readonly examples?: readonly SuggestionExample[];
};

export type SuggestionStoreState = {
  readonly version: 1;
  /** End of the last completed run. Only activity tracked after it counts toward the next run. */
  readonly lastRunAt: string | null;
  /** After a run where the provider could not be reached, no run before this time. */
  readonly retryAfter?: string | null;
  readonly suggestions: readonly StoredSuggestion[];
  /** `kind:cluster key` of suggestions the user rejected; they are not proposed again. */
  readonly declined: readonly string[];
};

/**
 * A run needs this much newly tracked activity since the previous run. Re-reading
 * nearly the same week would only reproduce the same suggestions.
 */
export const MIN_NEW_TRACKED_HOURS = 20;
export const MAX_PENDING_SUGGESTIONS = 8;
export const MAX_DECLINED_SUGGESTIONS = 64;
export const MAX_SUGGESTION_EXAMPLES = 3;
const MAX_EXAMPLE_TITLE_CHARS = 120;
const FILED_AS = ["focus", "neutral", "drift", "unclassified"] as const;

const EMPTY_STATE: SuggestionStoreState = { version: 1, lastRunAt: null, retryAfter: null, suggestions: [], declined: [] };

export function suggestionStoreKey(ownerId: string): string {
  return "drifty:memory-suggestions:v1:" + ownerId;
}

export function readSuggestionStore(ownerId: string): SuggestionStoreState {
  try {
    const raw = window.localStorage.getItem(suggestionStoreKey(ownerId));
    return raw ? parseSuggestionStore(JSON.parse(raw)) ?? EMPTY_STATE : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export function writeSuggestionStore(ownerId: string, state: SuggestionStoreState): void {
  try {
    window.localStorage.setItem(suggestionStoreKey(ownerId), JSON.stringify(state));
  } catch {
    // Suggestions are regenerable; a full or unavailable store only costs a rerun.
  }
}

/** False only while waiting out the retry delay after an unreachable provider. */
export function shouldRunSuggestions(state: SuggestionStoreState, now: Date): boolean {
  if (!state.retryAfter) return true;
  const retry = Date.parse(state.retryAfter);
  return Number.isNaN(retry) || now.getTime() >= retry;
}

export function declinedKeyFor(suggestion: Pick<StoredSuggestion, "id">): string {
  return suggestion.id;
}

export function toStoredSuggestion(
  suggestion: MemorySuggestion,
  window: { readonly since: string; readonly until: string },
  createdAt: string,
  options: { readonly includeTitles?: boolean } = {},
): StoredSuggestion {
  const { cluster } = suggestion;
  const examples = options.includeTitles ? pickSuggestionExamples(cluster.evidence) : [];
  return {
    id: suggestion.id, kind: suggestion.kind, summary: suggestion.summary, app: cluster.app, domain: cluster.domain,
    minutes: Math.round(cluster.minutes), days: cluster.days, blocks: cluster.blocks,
    windowStart: window.since, windowEnd: window.until, createdAt,
    ...(examples.length > 0 ? { examples } : {}),
  };
}

/** The largest record from each side the place was filed as, then the next largest, ordered by time. */
export function pickSuggestionExamples(evidence: readonly SuggestionEvidence[]): SuggestionExample[] {
  const byMinutes = evidence.filter((row) => row.title.trim()).sort((a, b) => b.minutes - a.minutes);
  const picked = FILED_AS.flatMap((label) => byMinutes.find((row) => row.filedAs === label) ?? []);
  for (const row of byMinutes) if (!picked.includes(row)) picked.push(row);
  return picked.slice(0, MAX_SUGGESTION_EXAMPLES).sort((a, b) => b.minutes - a.minutes).map((row) => ({
    title: row.title.trim().slice(0, MAX_EXAMPLE_TITLE_CHARS), filedAs: row.filedAs, minutes: Math.max(1, Math.round(row.minutes)),
  }));
}

/** Record a finished run: keep pending items, add new ones, drop declined, cap the list. */
export function recordSuggestionRun(
  state: SuggestionStoreState,
  generated: readonly StoredSuggestion[],
  existingSummaries: readonly string[],
  now: Date,
): SuggestionStoreState {
  const declined = new Set(state.declined);
  const known = new Set(existingSummaries.map(normalizeSummary));
  const byId = new Map<string, StoredSuggestion>();
  for (const suggestion of [...state.suggestions, ...generated]) {
    // A pending sentence stays as the user first saw it; a later draft for the same place is dropped.
    if (byId.has(suggestion.id) || declined.has(suggestion.id) || known.has(normalizeSummary(suggestion.summary))) continue;
    byId.set(suggestion.id, suggestion);
  }
  return { ...state, lastRunAt: now.toISOString(), retryAfter: null, suggestions: [...byId.values()].slice(0, MAX_PENDING_SUGGESTIONS) };
}

/** A run where every call failed is retried in about an hour instead of waiting a day. */
export const SUGGESTION_RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

export function recordFailedSuggestionRun(state: SuggestionStoreState, now: Date): SuggestionStoreState {
  // The activity was not used, so lastRunAt stays put and it still counts next time.
  return { ...state, retryAfter: new Date(now.getTime() + SUGGESTION_RETRY_AFTER_FAILURE_MS).toISOString() };
}

export function removeSuggestion(state: SuggestionStoreState, id: string): SuggestionStoreState {
  return { ...state, suggestions: state.suggestions.filter((suggestion) => suggestion.id !== id) };
}

export function declineSuggestion(state: SuggestionStoreState, id: string): SuggestionStoreState {
  const declined = [...state.declined.filter((value) => value !== id), id].slice(-MAX_DECLINED_SUGGESTIONS);
  return { ...removeSuggestion(state, id), declined };
}

function normalizeSummary(summary: string): string {
  return summary.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSuggestionStore(value: unknown): SuggestionStoreState | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const lastRunAt = typeof value.lastRunAt === "string" && !Number.isNaN(Date.parse(value.lastRunAt)) ? value.lastRunAt : null;
  const declined = Array.isArray(value.declined)
    ? value.declined.filter((entry): entry is string => typeof entry === "string" && entry.length <= 400).slice(-MAX_DECLINED_SUGGESTIONS)
    : [];
  const suggestions = Array.isArray(value.suggestions)
    ? value.suggestions.flatMap((entry) => {
      const parsed = parseStoredSuggestion(entry);
      return parsed ? [parsed] : [];
    }).slice(0, MAX_PENDING_SUGGESTIONS)
    : [];
  const retryAfter = typeof value.retryAfter === "string" && !Number.isNaN(Date.parse(value.retryAfter)) ? value.retryAfter : null;
  return { version: 1, lastRunAt, retryAfter, suggestions, declined };
}

function parseStoredSuggestion(value: unknown): StoredSuggestion | null {
  if (!isRecord(value)) return null;
  const { id, kind, summary, app, domain, minutes, days, blocks, windowStart, windowEnd, createdAt } = value;
  if (typeof id !== "string" || !id || id.length > 400) return null;
  if (kind !== "work" && kind !== "drift" && kind !== "ambiguous") return null;
  if (typeof summary !== "string" || summary.length < 1 || summary.length > 240) return null;
  if (typeof app !== "string" || typeof domain !== "string" || app.length > 160 || domain.length > 160) return null;
  if (![minutes, days, blocks].every((count) => typeof count === "number" && Number.isFinite(count) && count >= 0)) return null;
  if (![windowStart, windowEnd, createdAt].every((stamp) => typeof stamp === "string" && !Number.isNaN(Date.parse(stamp)))) return null;
  const examples = Array.isArray(value.examples)
    ? value.examples.flatMap((entry): SuggestionExample[] => {
      if (!isRecord(entry)) return [];
      const { title, filedAs, minutes: exampleMinutes } = entry;
      if (typeof title !== "string" || !title.trim() || title.length > MAX_EXAMPLE_TITLE_CHARS) return [];
      if (!FILED_AS.includes(filedAs as SuggestionExample["filedAs"])) return [];
      if (typeof exampleMinutes !== "number" || !Number.isFinite(exampleMinutes) || exampleMinutes < 0) return [];
      return [{ title, filedAs: filedAs as SuggestionExample["filedAs"], minutes: exampleMinutes }];
    }).slice(0, MAX_SUGGESTION_EXAMPLES)
    : [];
  return {
    id, kind, summary, app, domain, minutes: minutes as number, days: days as number, blocks: blocks as number,
    windowStart: windowStart as string, windowEnd: windowEnd as string, createdAt: createdAt as string,
    ...(examples.length > 0 ? { examples } : {}),
  };
}
