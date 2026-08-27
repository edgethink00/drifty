import { fetchCommunityFocusPercentileModel } from "../leaderboard/leaderboardService";
import {
  buildCommunityFocusPercentileModel,
  isCommunityFocusPercentileModel,
  type CommunityFocusPercentileModels,
} from "./communityFocusPercentile";

export const COMMUNITY_FOCUS_MODELS_STORAGE_KEY = "drifty.companion.communityFocusModels.v1";

const MEMORY_CACHE_MS = 15 * 60 * 1000;
const PERSISTED_CACHE_MS = 36 * 60 * 60 * 1000;
const EMPTY_MODELS: CommunityFocusPercentileModels = { daily: null, weekly: null };

type PersistedCommunityFocusPercentileModels = {
  readonly savedAt: string;
  readonly models: CommunityFocusPercentileModels;
};

let memoryCache: {
  readonly loadedAtMs: number;
  readonly models: CommunityFocusPercentileModels;
} | null = null;
let inFlight: Promise<CommunityFocusPercentileModels> | null = null;

/** Load aggregate-only models without requiring account or leaderboard membership. */
export async function loadCommunityFocusPercentileModels({
  forceRefresh = false,
}: {
  readonly forceRefresh?: boolean;
} = {}): Promise<CommunityFocusPercentileModels> {
  const nowMs = Date.now();
  if (!forceRefresh && memoryCache && nowMs - memoryCache.loadedAtMs < MEMORY_CACHE_MS) {
    return memoryCache.models;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const memoryFallback =
      memoryCache && nowMs - memoryCache.loadedAtMs <= PERSISTED_CACHE_MS
        ? memoryCache.models
        : null;
    const fallback = readPersistedCommunityFocusModels(nowMs) ?? memoryFallback ?? EMPTY_MODELS;
    const [dailyResult, weeklyResult] = await Promise.all([
      fetchCommunityFocusPercentileModel("daily"),
      fetchCommunityFocusPercentileModel("weekly"),
    ]);
    const daily = dailyResult.success
      ? buildCommunityFocusPercentileModel(dailyResult.data, "daily")
      : fallback.daily;
    const weekly = weeklyResult.success
      ? buildCommunityFocusPercentileModel(weeklyResult.data, "weekly")
      : fallback.weekly;
    const models: CommunityFocusPercentileModels = {
      daily,
      weekly,
    };
    memoryCache = { loadedAtMs: nowMs, models };
    if (dailyResult.success || weeklyResult.success) {
      // A successful null/invalid aggregate is authoritative (for example, the
      // cohort fell below the minimum). Persist it so a former valid model is
      // not resurrected after reload; fallback is only for request failures.
      persistCommunityFocusModels(models, new Date(nowMs).toISOString());
    }
    return models;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

function readPersistedCommunityFocusModels(nowMs: number): CommunityFocusPercentileModels | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COMMUNITY_FOCUS_MODELS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const stored = parsed as Partial<PersistedCommunityFocusPercentileModels>;
    const savedAtMs = typeof stored.savedAt === "string" ? Date.parse(stored.savedAt) : Number.NaN;
    if (!Number.isFinite(savedAtMs) || nowMs - savedAtMs > PERSISTED_CACHE_MS || savedAtMs > nowMs + 60_000) return null;
    if (typeof stored.models !== "object" || stored.models === null) return null;
    const models = stored.models as Partial<CommunityFocusPercentileModels>;
    return {
      daily: isCommunityFocusPercentileModel(models.daily) && models.daily.period === "daily" ? models.daily : null,
      weekly: isCommunityFocusPercentileModel(models.weekly) && models.weekly.period === "weekly" ? models.weekly : null,
    };
  } catch {
    return null;
  }
}

function persistCommunityFocusModels(models: CommunityFocusPercentileModels, savedAt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COMMUNITY_FOCUS_MODELS_STORAGE_KEY,
      JSON.stringify({ savedAt, models } satisfies PersistedCommunityFocusPercentileModels),
    );
  } catch {
    // The in-memory cache remains available for this session.
  }
}
