// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateShareCardRanks, loadShareCardRank, peekShareCardRank, setShareCardRankAccountScope } from "./shareCardRankCache";

const result = { success: true, error: null, data: null };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { vi.useFakeTimers(); setShareCardRankAccountScope(null); invalidateShareCardRanks(); });
afterEach(() => { vi.useRealTimers(); setShareCardRankAccountScope(null); });

describe("share rank preparation cache", () => {
  it("coalesces preparation and opening, exposes a synchronous snapshot, and expires after 60 seconds", async () => {
    const pending = deferred<typeof result>(); const load = vi.fn(() => pending.promise);
    const first = loadShareCardRank("a", "day", "daily", load);
    expect(loadShareCardRank("a", "day", "daily", load)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(result); await first;
    expect(peekShareCardRank("a", "day", "daily")).toBe(result);
    await loadShareCardRank("a", "day", "daily", load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(peekShareCardRank("a", "day", "daily")).toBeUndefined();
  });

  it("discards old-account responses, including switching back to that account", async () => {
    const pending = deferred<typeof result>();
    const old = loadShareCardRank("a", "day", "daily", () => pending.promise);
    setShareCardRankAccountScope(null); setShareCardRankAccountScope("b");
    await loadShareCardRank("b", "day", "daily", async () => result);
    pending.resolve(result);
    expect((await old).success).toBe(false);
    expect(peekShareCardRank("b", "day", "daily")).toBe(result);
    expect(peekShareCardRank("a", "day", "daily")).toBeUndefined();
  });

  it("invalidates periods on publication or window changes and rejects a pending invalidated response", async () => {
    const pending = deferred<typeof result>();
    const old = loadShareCardRank("a", "day", "daily", () => pending.promise);
    invalidateShareCardRanks("other");
    invalidateShareCardRanks("a"); pending.resolve(result);
    expect((await old).success).toBe(false);
    expect(peekShareCardRank("a", "day", "daily")).toBeUndefined();
    await loadShareCardRank("a", "day", "daily", async () => result);
    expect(peekShareCardRank("a", "next-day", "daily")).toBeUndefined();
  });

  it("settles a timeout, ignores late completion, and permits retry after a short failure cache", async () => {
    const pending = deferred<typeof result>();
    const first = loadShareCardRank("a", "day", "daily", () => pending.promise);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await first).success).toBe(false);
    pending.resolve(result); await Promise.resolve();
    expect(peekShareCardRank("a", "day", "daily")?.success).toBe(false);
    vi.advanceTimersByTime(5_000);
    await loadShareCardRank("a", "day", "daily", async () => result);
    expect(peekShareCardRank("a", "day", "daily")).toBe(result);
  });
});
