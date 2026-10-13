import type { PostHogEventName } from "../analytics/eventTaxonomy";
import type { SanitizedPostHogProperties } from "../analytics/privacyGuard";

/**
 * A short local history of what the app tried and how it went, kept so a
 * feedback report can say what happened before the person wrote in.
 *
 * Entries reuse the product-analytics event schema after its allowlist has
 * already removed every free-text field, so the journal holds only enumerated
 * outcomes (results, error kinds, provider kinds, update steps). It is written
 * whether or not product analytics is enabled because it never leaves the
 * device on its own: it is read only when someone sends feedback with
 * diagnostics included.
 */
export const SUPPORT_JOURNAL_STORAGE_KEY = "drifty.support.recentEvents.v1";
export const SUPPORT_JOURNAL_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const SUPPORT_JOURNAL_MAX_ENTRIES = 120;

/** Events that describe an outcome a support reply can act on. Navigation and funnel events stay out. */
const JOURNALED_EVENTS: ReadonlySet<PostHogEventName> = new Set<PostHogEventName>([
  "app_opened",
  "app_launch_environment",
  "startup_registration",
  "local_model_setup",
  "first_day_preparation",
  "first_day_backlog",
  "permission_action",
  "tracker_action",
  "auth_state_changed",
  "cloud_auth_action",
  "billing_action",
  "leaderboard_action",
  "ai_setup_action",
  "ai_classification_run",
  "project_classification_run",
  "memory_suggestion_run",
  "app_error",
  "app_update",
]);

export type SupportJournalEntry = {
  readonly event: PostHogEventName;
  readonly properties: SanitizedPostHogProperties;
  /** How many identical outcomes collapsed into this entry. */
  readonly count: number;
  readonly firstAt: string;
  readonly lastAt: string;
};

export function isJournaledSupportEvent(event: PostHogEventName): boolean {
  return JOURNALED_EVENTS.has(event);
}

/**
 * Records one sanitized outcome. Repeats of the same event with the same
 * properties update the existing entry instead of pushing older outcomes out,
 * so a background loop that succeeds every few minutes cannot evict the one
 * failure that explains a report.
 */
export function recordSupportJournalEvent(
  event: PostHogEventName,
  properties: SanitizedPostHogProperties,
  storage: Storage | null = browserStorage(),
  now: Date = new Date(),
): void {
  if (!storage || !isJournaledSupportEvent(event)) return;
  try {
    const nowMs = now.getTime();
    const at = now.toISOString();
    const key = entryKey(event, properties);
    const entries = readSupportJournal(storage, nowMs);
    const existingIndex = entries.findIndex((entry) => entryKey(entry.event, entry.properties) === key);
    const next = existingIndex >= 0
      ? [
          ...entries.slice(0, existingIndex),
          ...entries.slice(existingIndex + 1),
          { ...entries[existingIndex], count: entries[existingIndex].count + 1, lastAt: at },
        ]
      : [...entries, { event, properties: { ...properties }, count: 1, firstAt: at, lastAt: at }];
    storage.setItem(SUPPORT_JOURNAL_STORAGE_KEY, JSON.stringify(next.slice(-SUPPORT_JOURNAL_MAX_ENTRIES)));
  } catch {
    // The journal is a diagnostic aid; a full or blocked storage must never
    // affect the action that produced the event.
  }
}

/** Retained entries, oldest first. */
export function readSupportJournal(
  storage: Storage | null = browserStorage(),
  nowMs: number = Date.now(),
): SupportJournalEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SUPPORT_JOURNAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = nowMs - SUPPORT_JOURNAL_RETENTION_MS;
    return parsed.filter((value): value is SupportJournalEntry => {
      if (!isSupportJournalEntry(value)) return false;
      const lastAt = Date.parse(value.lastAt);
      return Number.isFinite(lastAt) && lastAt >= cutoff && lastAt <= nowMs + 60_000;
    });
  } catch {
    return [];
  }
}

function entryKey(event: string, properties: SanitizedPostHogProperties): string {
  const sorted = Object.keys(properties).sort().map((key) => [key, properties[key]]);
  return `${event}|${JSON.stringify(sorted)}`;
}

function isSupportJournalEntry(value: unknown): value is SupportJournalEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.event !== "string" || !JOURNALED_EVENTS.has(record.event as PostHogEventName)) return false;
  if (typeof record.count !== "number" || !Number.isInteger(record.count) || record.count < 1) return false;
  if (typeof record.firstAt !== "string" || typeof record.lastAt !== "string") return false;
  const properties = record.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  return Object.values(properties).every((property) => typeof property === "string" || typeof property === "boolean");
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
