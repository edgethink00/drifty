import type { DriftAlarmDebugEvent, DriftAlarmDebugEventKind } from "./driftAlarmDebugLog";

// Durable, local-only ledger of drift-alarm delivery and automatic-close
// outcomes. The 5-minute debug log answers "what just happened"; this ledger
// answers "how often did automatic close work this month, and why not".
//
// Entries carry no URL, title, or domain. Browser name, category, site source,
// diagnostics, and reason codes are the only activity-derived fields, so the
// ledger can be pasted into a review without exposing history.

export const INTERVENTION_LEDGER_STORAGE_KEY = "drifty.companion.interventionLedger.v1";
export const INTERVENTION_LEDGER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const INTERVENTION_LEDGER_LIMIT = 3000;

export const INTERVENTION_LEDGER_EVENT_KINDS = [
  "delivery_delivered",
  "delivery_suppressed",
  "extreme_nudge_started",
  "extreme_nudge_pet_skipped",
  "extreme_nudge_result",
  "extreme_nudge_error",
] as const satisfies readonly DriftAlarmDebugEventKind[];

export type InterventionLedgerEventKind = typeof INTERVENTION_LEDGER_EVENT_KINDS[number];

export type InterventionLedgerEntry = {
  readonly id: string;
  readonly recordedAt: string;
  readonly kind: InterventionLedgerEventKind;
  readonly alertKey: string | null;
  readonly result: string | null;
  readonly reason: string | null;
  readonly message: string | null;
  readonly browserName: string | null;
  readonly category: string | null;
  readonly siteSource: string | null;
  readonly hasSiteContext: boolean | null;
  readonly deliveryMode: string | null;
};

export type InterventionLedgerSummary = {
  readonly days: number;
  readonly since: string;
  readonly entries: number;
  readonly delivered: number;
  readonly suppressed: number;
  readonly closeAttempts: number;
  readonly closeApplied: number;
  readonly closeNotApplied: number;
  readonly petSkipped: number;
  readonly errors: number;
  readonly notAppliedDiagnostics: Readonly<Record<string, number>>;
  readonly petSkipReasons: Readonly<Record<string, number>>;
  readonly errorCodes: Readonly<Record<string, number>>;
  readonly byBrowser: Readonly<Record<string, { attempts: number; applied: number }>>;
};

const LEDGER_KIND_SET: ReadonlySet<string> = new Set(INTERVENTION_LEDGER_EVENT_KINDS);

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function isInterventionLedgerEventKind(kind: string): kind is InterventionLedgerEventKind {
  return LEDGER_KIND_SET.has(kind);
}

export function toInterventionLedgerEntry(event: DriftAlarmDebugEvent): InterventionLedgerEntry | null {
  if (!isInterventionLedgerEventKind(event.kind)) return null;
  const segment = event.candidate?.segment ?? event.segment ?? null;
  return {
    id: event.id,
    recordedAt: event.recordedAt,
    kind: event.kind,
    alertKey: event.alertKey,
    result: event.result,
    reason: event.reason,
    message: event.message,
    browserName: segment?.browserName ?? event.currentSnapshot?.browserName ?? null,
    category: event.candidate?.category ?? segment?.classification?.category ?? null,
    siteSource: segment?.siteSource ?? null,
    hasSiteContext: segment?.hasSiteContext ?? null,
    deliveryMode: event.delivery?.mode ?? null,
  };
}

function isEntry(value: unknown): value is InterventionLedgerEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.recordedAt === "string"
    && typeof entry.kind === "string"
    && isInterventionLedgerEventKind(entry.kind);
}

function readStoredEntries(storage: Storage): InterventionLedgerEntry[] {
  try {
    const raw = storage.getItem(INTERVENTION_LEDGER_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function pruneEntries(entries: readonly InterventionLedgerEntry[], nowMs: number): InterventionLedgerEntry[] {
  const cutoff = nowMs - INTERVENTION_LEDGER_RETENTION_MS;
  return entries
    .filter((entry) => {
      const at = Date.parse(entry.recordedAt);
      return Number.isFinite(at) && at >= cutoff && at <= nowMs + 60_000;
    })
    .slice(-INTERVENTION_LEDGER_LIMIT);
}

export function appendInterventionLedgerEvent(
  event: DriftAlarmDebugEvent,
  storage = browserStorage(),
  now = new Date(),
): InterventionLedgerEntry[] {
  if (!storage) return [];
  const entry = toInterventionLedgerEntry(event);
  const existing = readStoredEntries(storage);
  if (!entry) return existing;
  const next = pruneEntries([...existing, entry], now.getTime());
  try {
    storage.setItem(INTERVENTION_LEDGER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private-mode failures must never break alarm delivery.
  }
  return next;
}

export function readInterventionLedger(storage = browserStorage(), nowMs = Date.now()): InterventionLedgerEntry[] {
  if (!storage) return [];
  return pruneEntries(readStoredEntries(storage), nowMs);
}

export function clearInterventionLedger(storage = browserStorage()): void {
  try {
    storage?.removeItem(INTERVENTION_LEDGER_STORAGE_KEY);
  } catch {
    // Ignore storage failures on clear.
  }
}

function bump(counts: Record<string, number>, key: string | null | undefined, fallback = "unknown"): void {
  const name = key && key.trim() ? key : fallback;
  counts[name] = (counts[name] ?? 0) + 1;
}

export function summarizeInterventionLedger(
  entries: readonly InterventionLedgerEntry[],
  days: number,
  nowMs = Date.now(),
): InterventionLedgerSummary {
  const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
  const notAppliedDiagnostics: Record<string, number> = {};
  const petSkipReasons: Record<string, number> = {};
  const errorCodes: Record<string, number> = {};
  const byBrowser: Record<string, { attempts: number; applied: number }> = {};
  let count = 0;
  let delivered = 0;
  let suppressed = 0;
  let closeAttempts = 0;
  let closeApplied = 0;
  let closeNotApplied = 0;
  let petSkipped = 0;
  let errors = 0;

  for (const entry of entries) {
    const at = Date.parse(entry.recordedAt);
    if (!Number.isFinite(at) || at < sinceMs) continue;
    count += 1;
    const browser = entry.browserName ?? "(no browser)";
    switch (entry.kind) {
      case "delivery_delivered":
        delivered += 1;
        break;
      case "delivery_suppressed":
        suppressed += 1;
        break;
      case "extreme_nudge_started":
        closeAttempts += 1;
        byBrowser[browser] ??= { attempts: 0, applied: 0 };
        byBrowser[browser].attempts += 1;
        break;
      case "extreme_nudge_result":
        if (entry.result === "applied") {
          closeApplied += 1;
          byBrowser[browser] ??= { attempts: 0, applied: 0 };
          byBrowser[browser].applied += 1;
        } else {
          closeNotApplied += 1;
          bump(notAppliedDiagnostics, entry.reason);
        }
        break;
      case "extreme_nudge_pet_skipped":
        petSkipped += 1;
        bump(petSkipReasons, entry.reason);
        break;
      case "extreme_nudge_error":
        errors += 1;
        bump(errorCodes, entry.reason);
        break;
    }
  }

  return {
    days,
    since: new Date(sinceMs).toISOString(),
    entries: count,
    delivered,
    suppressed,
    closeAttempts,
    closeApplied,
    closeNotApplied,
    petSkipped,
    errors,
    notAppliedDiagnostics,
    petSkipReasons,
    errorCodes,
    byBrowser,
  };
}

export function buildInterventionLedgerDebugInput(storage = browserStorage(), nowMs = Date.now()) {
  const entries = readInterventionLedger(storage, nowMs);
  return {
    retentionDays: INTERVENTION_LEDGER_RETENTION_MS / (24 * 60 * 60 * 1000),
    last7Days: summarizeInterventionLedger(entries, 7, nowMs),
    last30Days: summarizeInterventionLedger(entries, 30, nowMs),
    entries,
  };
}
