export const FEATURE_NEW_BADGE_STORAGE_KEY = "drifty.discovery.featureNewBadges.v1";

export const FEATURE_NEW_BADGE_IDS = ["pet"] as const;

export type FeatureNewBadgeId = (typeof FEATURE_NEW_BADGE_IDS)[number];

export const FEATURE_NEW_BADGE_MAX_ACTIVE_DAYS = 14;
export const FEATURE_NEW_BADGE_DAY_MS = 24 * 60 * 60 * 1000;
export const FEATURE_NEW_BADGE_ENABLED_GRACE_MS = 4 * FEATURE_NEW_BADGE_DAY_MS;
export const FEATURE_NEW_BADGE_MAX_ACTIVE_MS = FEATURE_NEW_BADGE_MAX_ACTIVE_DAYS * FEATURE_NEW_BADGE_DAY_MS;
export const FEATURE_NEW_BADGE_CAMPAIGN_STARTED_AT = Date.parse("2026-08-22T00:00:00.000Z");

const FEATURE_NEW_BADGE_ID_SET = new Set<string>(FEATURE_NEW_BADGE_IDS);

export type FeatureNewBadgeState = {
  readonly firstSeenAt: string;
  readonly enabledAt: Partial<Record<FeatureNewBadgeId, string>>;
  readonly dismissed: Partial<Record<FeatureNewBadgeId, true>>;
};

function isFeatureNewBadgeId(value: string): value is FeatureNewBadgeId {
  return FEATURE_NEW_BADGE_ID_SET.has(value);
}

function parseIsoDate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyState(now: number): FeatureNewBadgeState {
  return {
    firstSeenAt: new Date(now).toISOString(),
    enabledAt: {},
    dismissed: {},
  };
}

function readStorage(): FeatureNewBadgeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FEATURE_NEW_BADGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const firstSeenAt = typeof record.firstSeenAt === "string" ? record.firstSeenAt : null;
    if (!firstSeenAt || parseIsoDate(firstSeenAt) === null) return null;
    const dismissed: Partial<Record<FeatureNewBadgeId, true>> = {};
    if (record.dismissed && typeof record.dismissed === "object") {
      for (const [key, value] of Object.entries(record.dismissed as Record<string, unknown>)) {
        if (value === true && isFeatureNewBadgeId(key)) dismissed[key] = true;
      }
    }
    const enabledAt: Partial<Record<FeatureNewBadgeId, string>> = {};
    if (record.enabledAt && typeof record.enabledAt === "object") {
      for (const [key, value] of Object.entries(record.enabledAt as Record<string, unknown>)) {
        if (typeof value === "string" && parseIsoDate(value) !== null && isFeatureNewBadgeId(key)) {
          enabledAt[key] = value;
        }
      }
    }
    return { firstSeenAt, enabledAt, dismissed };
  } catch {
    return null;
  }
}

function writeStorage(state: FeatureNewBadgeState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FEATURE_NEW_BADGE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

export function rememberFeatureNewBadgeAudience(now = Date.now()): FeatureNewBadgeState {
  const existing = readStorage();
  if (existing) return existing;
  const next = emptyState(now);
  writeStorage(next);
  return next;
}

export function markFeatureNewBadgeEnabled(id: FeatureNewBadgeId, now = Date.now()): FeatureNewBadgeState {
  const current = rememberFeatureNewBadgeAudience(now);
  if (current.dismissed[id] || current.enabledAt[id]) return current;
  const next = {
    firstSeenAt: current.firstSeenAt,
    enabledAt: { ...current.enabledAt, [id]: new Date(now).toISOString() },
    dismissed: current.dismissed,
  };
  writeStorage(next);
  return next;
}

export function dismissFeatureNewBadge(id: FeatureNewBadgeId, now = Date.now()): FeatureNewBadgeState {
  const current = rememberFeatureNewBadgeAudience(now);
  if (current.dismissed[id]) return current;
  const next = {
    firstSeenAt: current.firstSeenAt,
    enabledAt: current.enabledAt,
    dismissed: { ...current.dismissed, [id]: true as const },
  };
  writeStorage(next);
  return next;
}

export function isFeatureNewBadgeAudience(completedAt: string | null | undefined): boolean {
  const parsed = parseIsoDate(completedAt ?? undefined);
  return parsed !== null && parsed < FEATURE_NEW_BADGE_CAMPAIGN_STARTED_AT;
}

export function isFeatureNewBadgeVisible(
  id: FeatureNewBadgeId,
  options: {
    readonly returningUser: boolean;
    readonly now?: number;
    readonly state?: FeatureNewBadgeState | null;
  },
): boolean {
  if (!options.returningUser) return false;
  const state = options.state ?? readStorage();
  if (!state || state.dismissed[id]) return false;
  const firstSeenAt = parseIsoDate(state.firstSeenAt);
  if (firstSeenAt === null) return false;
  const now = options.now ?? Date.now();
  const enabledAt = parseIsoDate(state.enabledAt[id]);
  if (enabledAt !== null) {
    if (enabledAt - firstSeenAt >= FEATURE_NEW_BADGE_MAX_ACTIVE_MS) return false;
    return now - enabledAt < FEATURE_NEW_BADGE_ENABLED_GRACE_MS;
  }
  return now - firstSeenAt < FEATURE_NEW_BADGE_MAX_ACTIVE_MS;
}

export function readFeatureNewBadgeState(): FeatureNewBadgeState | null {
  return readStorage();
}
