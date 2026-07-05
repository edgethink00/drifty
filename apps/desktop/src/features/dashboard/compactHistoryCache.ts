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

export function findFreshCompactHistoryLoad(cache: ReadonlyMap<string, CompactHistoryLoad>, range: CompactHistoryRange): CompactHistoryLoad | null {
  const exact = cache.get(compactHistoryRangeKey(range));
  if (exact && isFreshCompactHistoryLoad(exact) && compactHistoryRangeContains(exact, range)) return exact;

  for (const load of cache.values()) {
    if (isFreshCompactHistoryLoad(load) && compactHistoryRangeContains(load, range)) return load;
  }
  return null;
}
