import type { BuiltInHeuristicClassificationMaterialization } from "../classification/heuristicClassificationMaterialization";

export type CompactHistoryLoad = {
  readonly key: string;
  readonly start: string;
  readonly end: string;
  readonly loadedAtMs: number;
  readonly materialized: BuiltInHeuristicClassificationMaterialization;
};

export type CompactHistoryRange = {
  readonly start: string;
  readonly end: string;
};

// Compact history is mostly closed-day data that rarely changes, so it does not need
// to expire on the 30s live-refresh cadence. A longer TTL keeps the prefetch cache
// warm across typical "browse Today, then open Week/Trends" navigation, avoiding
// a full tracker IPC on most period switches.
export const COMPACT_HISTORY_CACHE_TTL_MS = 5 * 60_000;

// Past the TTL a load that still reaches the present (the current week or the
// rolling Today prefetch) keeps painting closed days while a reload runs, so
// age alone no longer evicts it. This count bounds the cache instead.
export const COMPACT_HISTORY_CACHE_MAX_ENTRIES = 4;

export function compactHistoryRangeKey(range: CompactHistoryRange): string {
  return `${range.start}:${range.end}`;
}

export function isFreshCompactHistoryLoad(load: CompactHistoryLoad): boolean {
  return Date.now() - load.loadedAtMs <= COMPACT_HISTORY_CACHE_TTL_MS;
}

export function compactHistoryRangeContains(outer: CompactHistoryRange, inner: CompactHistoryRange): boolean {
  return new Date(outer.start).getTime() <= new Date(inner.start).getTime()
    && new Date(outer.end).getTime() >= new Date(inner.end).getTime();
}

// Run after inserting a load. Drops a load a newer one fully covers (it can
// never be chosen again), an expired load of a range that has already ended
// (a past week, evicted as before), and anything beyond the newest few.
export function pruneCompactHistoryLoads(cache: Map<string, CompactHistoryLoad>): void {
  const nowMs = Date.now();
  const newestFirst = [...cache.values()].sort((left, right) => right.loadedAtMs - left.loadedAtMs);
  const kept: CompactHistoryLoad[] = [];
  for (const load of newestFirst) {
    const superseded = kept.some((newer) => compactHistoryRangeContains(newer, load));
    const expiredPastRange = !isFreshCompactHistoryLoad(load) && new Date(load.end).getTime() < nowMs;
    if (superseded || expiredPastRange || kept.length >= COMPACT_HISTORY_CACHE_MAX_ENTRIES) {
      cache.delete(load.key);
      continue;
    }
    kept.push(load);
  }
}

export function findFreshCompactHistoryLoad(cache: ReadonlyMap<string, CompactHistoryLoad>, range: CompactHistoryRange): CompactHistoryLoad | null {
  const exact = cache.get(compactHistoryRangeKey(range));
  if (exact && isFreshCompactHistoryLoad(exact) && compactHistoryRangeContains(exact, range)) return exact;

  for (const load of cache.values()) {
    if (isFreshCompactHistoryLoad(load) && compactHistoryRangeContains(load, range)) return load;
  }
  return null;
}

// For painting only: prefer a fresh load, otherwise fall back to the newest
// covering load of any age. Callers still use findFreshCompactHistoryLoad to
// decide whether to reload, so an old copy is shown while it is replaced
// rather than the view dropping every day but the live one.
export function findDisplayableCompactHistoryLoad(cache: ReadonlyMap<string, CompactHistoryLoad>, range: CompactHistoryRange): CompactHistoryLoad | null {
  const fresh = findFreshCompactHistoryLoad(cache, range);
  if (fresh) return fresh;

  let newest: CompactHistoryLoad | null = null;
  for (const load of cache.values()) {
    if (!compactHistoryRangeContains(load, range)) continue;
    if (newest === null || load.loadedAtMs > newest.loadedAtMs) newest = load;
  }
  return newest;
}
