import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltInHeuristicClassificationMaterialization } from "../classification/heuristicClassificationMaterialization";
import {
  COMPACT_HISTORY_CACHE_MAX_ENTRIES,
  COMPACT_HISTORY_CACHE_TTL_MS,
  findDisplayableCompactHistoryLoad,
  findFreshCompactHistoryLoad,
  pruneCompactHistoryLoads,
  type CompactHistoryLoad,
} from "./compactHistoryCache";

const EMPTY_MATERIALIZATION = { segments: [], classifications: [] } as unknown as BuiltInHeuristicClassificationMaterialization;
const CURRENT_WEEK = { start: "2026-05-18T04:00:00", end: "2026-05-21T03:59:59" };
const ROLLING_WEEK = { start: "2026-05-14T04:00:00", end: "2026-05-21T03:59:59" };
const PREVIOUS_WEEK = { start: "2026-05-11T04:00:00", end: "2026-05-18T03:59:59" };

function createLoad(key: string, loadedAtMs: number, range: { start: string; end: string } = ROLLING_WEEK): CompactHistoryLoad {
  return {
    key,
    ...range,
    loadedAtMs,
    materialized: EMPTY_MATERIALIZATION,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 20, 13, 0, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pruneCompactHistoryLoads", () => {
  it("drops a load that a newer load fully covers", () => {
    const cache = new Map<string, CompactHistoryLoad>([
      ["current-week", createLoad("current-week", Date.now() - 60_000, CURRENT_WEEK)],
      ["rolling-week", createLoad("rolling-week", Date.now(), ROLLING_WEEK)],
      ["previous-week", createLoad("previous-week", Date.now() - 120_000, PREVIOUS_WEEK)],
    ]);

    pruneCompactHistoryLoads(cache);

    expect([...cache.keys()].sort()).toEqual(["previous-week", "rolling-week"]);
  });

  it("keeps an expired load that reaches the present and drops an expired past range", () => {
    const cache = new Map<string, CompactHistoryLoad>([
      ["expired-current", createLoad("expired-current", Date.now() - COMPACT_HISTORY_CACHE_TTL_MS * 12, CURRENT_WEEK)],
      ["expired-previous", createLoad("expired-previous", Date.now() - COMPACT_HISTORY_CACHE_TTL_MS - 1, PREVIOUS_WEEK)],
      ["fresh-previous", createLoad("fresh-previous", Date.now() - 1_000, { start: "2026-05-04T04:00:00", end: "2026-05-11T03:59:59" })],
    ]);

    pruneCompactHistoryLoads(cache);

    expect([...cache.keys()].sort()).toEqual(["expired-current", "fresh-previous"]);
  });

  it("bounds the cache to the newest entries", () => {
    const cache = new Map<string, CompactHistoryLoad>();
    for (let index = 0; index < COMPACT_HISTORY_CACHE_MAX_ENTRIES + 2; index += 1) {
      const start = `2026-04-${String(10 + index).padStart(2, "0")}T04:00:00`;
      const end = `2026-04-${String(10 + index).padStart(2, "0")}T23:59:59`;
      cache.set(`day-${index}`, createLoad(`day-${index}`, Date.now() - 1_000 * (index + 1), { start, end }));
    }

    pruneCompactHistoryLoads(cache);

    expect(cache.size).toBe(COMPACT_HISTORY_CACHE_MAX_ENTRIES);
    expect(cache.has("day-0")).toBe(true);
    expect(cache.has(`day-${COMPACT_HISTORY_CACHE_MAX_ENTRIES + 1}`)).toBe(false);
  });
});

describe("findDisplayableCompactHistoryLoad", () => {
  it("prefers a fresh covering load", () => {
    const fresh = createLoad("fresh", Date.now() - 1_000, CURRENT_WEEK);
    const expired = createLoad("expired", Date.now() - COMPACT_HISTORY_CACHE_TTL_MS - 1, ROLLING_WEEK);
    const cache = new Map([["expired", expired], ["fresh", fresh]]);

    expect(findDisplayableCompactHistoryLoad(cache, CURRENT_WEEK)).toBe(fresh);
  });

  it("falls back to the newest expired covering load that a fresh lookup rejects", () => {
    const older = createLoad("older", Date.now() - COMPACT_HISTORY_CACHE_TTL_MS * 3, ROLLING_WEEK);
    const newer = createLoad("newer", Date.now() - COMPACT_HISTORY_CACHE_TTL_MS - 1, CURRENT_WEEK);
    const cache = new Map([["older", older], ["newer", newer]]);

    expect(findFreshCompactHistoryLoad(cache, CURRENT_WEEK)).toBeNull();
    expect(findDisplayableCompactHistoryLoad(cache, CURRENT_WEEK)).toBe(newer);
  });

  it("does not return a load that does not cover the requested range", () => {
    const cache = new Map([["previous-week", createLoad("previous-week", Date.now(), PREVIOUS_WEEK)]]);

    expect(findDisplayableCompactHistoryLoad(cache, CURRENT_WEEK)).toBeNull();
  });
});
