import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltInHeuristicClassificationMaterialization } from "../classification/heuristicClassificationMaterialization";
import {
  COMPACT_HISTORY_CACHE_TTL_MS,
  pruneStaleCompactHistoryLoads,
  type CompactHistoryLoad,
} from "./compactHistoryCache";

const EMPTY_MATERIALIZATION = { segments: [], classifications: [] } as unknown as BuiltInHeuristicClassificationMaterialization;

function createLoad(key: string, loadedAtMs: number): CompactHistoryLoad {
  return {
    key,
    start: "2026-05-18T00:00:00",
    end: "2026-05-24T23:59:59",
    loadedAtMs,
    materialized: EMPTY_MATERIALIZATION,
  };
}

describe("pruneStaleCompactHistoryLoads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 13, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops entries older than the TTL and keeps fresh ones", () => {
    const cache = new Map<string, CompactHistoryLoad>([
      ["stale", createLoad("stale", Date.now() - COMPACT_HISTORY_CACHE_TTL_MS - 1)],
      ["fresh", createLoad("fresh", Date.now() - 1_000)],
      ["boundary", createLoad("boundary", Date.now() - COMPACT_HISTORY_CACHE_TTL_MS)],
    ]);

    pruneStaleCompactHistoryLoads(cache);

    expect([...cache.keys()].sort()).toEqual(["boundary", "fresh"]);
  });

  it("leaves an all-fresh cache untouched", () => {
    const cache = new Map<string, CompactHistoryLoad>([
      ["a", createLoad("a", Date.now())],
      ["b", createLoad("b", Date.now() - 1)],
    ]);

    pruneStaleCompactHistoryLoads(cache);

    expect(cache.size).toBe(2);
  });
});
