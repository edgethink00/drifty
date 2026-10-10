import { USAGE_MILESTONE_DAY_BUCKETS, USAGE_MILESTONE_IDS } from "./eventTaxonomy";

/**
 * Usage milestones: how quickly a new install reaches 10 and 30 tracked hours.
 *
 * This measures the 30-hour bar proposed for rewarding friend invites
 * (2026-10-10) before any reward depends on it. Tracked time is the local
 * tracker's own total, which already excludes idle time; only the milestone id
 * and a days-since-start bucket ever leave the device. Installs that already
 * had hours of history when this first ran are existing users and report
 * nothing, and measurement stops after 90 days.
 */
export const USAGE_MILESTONES = [
  { id: "tracked_10h", seconds: 10 * 3_600 },
  { id: "tracked_30h", seconds: 30 * 3_600 },
] as const satisfies ReadonlyArray<{ readonly id: (typeof USAGE_MILESTONE_IDS)[number]; readonly seconds: number }>;
export type UsageMilestoneId = (typeof USAGE_MILESTONE_IDS)[number];

export type UsageMilestoneDayBucket = (typeof USAGE_MILESTONE_DAY_BUCKETS)[number];

/** Tracked before the first check; more than this means an existing install. */
export const NEW_INSTALL_MAX_SECONDS = 2 * 3_600;
export const MEASUREMENT_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export type UsageMilestoneState = {
  readonly version: 1;
  readonly startedAt: string;
  readonly reported: readonly UsageMilestoneId[];
  /** Existing install, or the measurement window has passed: never report. */
  readonly closed: boolean;
};

export type UsageMilestoneEvent = {
  readonly milestone: UsageMilestoneId;
  readonly days_since_start_bucket: UsageMilestoneDayBucket;
};

export function dayBucket(days: number): UsageMilestoneDayBucket {
  if (days <= 7) return "0_7";
  if (days <= 14) return "8_14";
  if (days <= 30) return "15_30";
  if (days <= 60) return "31_60";
  return "61_90";
}

/** Whether the tracker still needs to be asked for a total. */
export function isMeasuring(state: UsageMilestoneState | null): boolean {
  return !state || (!state.closed && state.reported.length < USAGE_MILESTONES.length);
}

export function evaluateUsageMilestones(
  state: UsageMilestoneState | null,
  trackedSeconds: number,
  now: Date,
): { readonly state: UsageMilestoneState; readonly events: readonly UsageMilestoneEvent[] } {
  if (!state) {
    const closed = trackedSeconds > NEW_INSTALL_MAX_SECONDS;
    state = { version: 1, startedAt: now.toISOString(), reported: [], closed };
    if (closed) return { state, events: [] };
  }
  if (state.closed) return { state, events: [] };
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(state.startedAt)) / DAY_MS));
  if (!Number.isFinite(days) || days > MEASUREMENT_WINDOW_DAYS) {
    return { state: { ...state, closed: true }, events: [] };
  }
  const events = USAGE_MILESTONES
    .filter((milestone) => trackedSeconds >= milestone.seconds && !state.reported.includes(milestone.id))
    .map((milestone) => ({ milestone: milestone.id, days_since_start_bucket: dayBucket(days) }));
  if (events.length === 0) return { state, events };
  return { state: { ...state, reported: [...state.reported, ...events.map((event) => event.milestone)] }, events };
}

const STORAGE_KEY = "drifty.analytics.usageMilestones.v1";

export function readUsageMilestoneState(storage: Pick<Storage, "getItem"> | null = safeStorage()): UsageMilestoneState | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || typeof record.startedAt !== "string" || !Number.isFinite(Date.parse(record.startedAt))) return null;
    const reported = Array.isArray(record.reported)
      ? record.reported.filter((id): id is UsageMilestoneId => USAGE_MILESTONES.some((milestone) => milestone.id === id))
      : [];
    return { version: 1, startedAt: record.startedAt, reported, closed: record.closed === true };
  } catch {
    return null;
  }
}

export function writeUsageMilestoneState(state: UsageMilestoneState, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: the next check simply re-evaluates.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
