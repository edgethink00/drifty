import type { LeaderboardResult, OwnLeaderboardEntry } from "../leaderboard/leaderboardService";
import { shareCardRequestDeadline } from "./shareCardRequestDeadline";

type Period = "daily" | "weekly";
type Result = LeaderboardResult<OwnLeaderboardEntry | null>;
type Entry = { result?: Result; expiresAt: number; request?: Promise<Result> };
const entries = new Map<Period, Entry>();
let accountScope: string | null = null;
let windowKey = "";

/** Account facts stay in memory and cannot survive an account/window change. */
export function setShareCardRankAccountScope(scope: string | null) {
  if (accountScope === scope) return;
  accountScope = scope;
  entries.clear();
}

export function invalidateShareCardRanks(scope?: string) {
  if (scope !== undefined && scope !== accountScope) return;
  entries.clear();
}

function ensureScope(scope: string | null, key: string) {
  setShareCardRankAccountScope(scope);
  if (windowKey !== key) {
    windowKey = key;
    entries.clear();
  }
}

export function peekShareCardRank(scope: string | null, key: string, period: Period): Result | undefined {
  if (accountScope !== scope || windowKey !== key) return undefined;
  const entry = entries.get(period);
  return entry && Date.now() < entry.expiresAt ? entry.result : undefined;
}

export function loadShareCardRank(scope: string, key: string, period: Period, load: () => Promise<Result>): Promise<Result> {
  ensureScope(scope, key);
  const cached = peekShareCardRank(scope, key, period);
  if (cached) return Promise.resolve(cached);
  const pending = entries.get(period)?.request;
  if (pending) return pending;
  const entry: Entry = { expiresAt: 0 };
  entries.set(period, entry);
  entry.request = shareCardRequestDeadline(load(), { success: false, error: "Share comparison timed out" }).then(result => {
    // Invalidated or old-account requests must neither repopulate the cache nor
    // publish their result to a still-finishing consumer.
    if (accountScope !== scope || windowKey !== key || entries.get(period) !== entry) {
      return { success: false, error: "Share comparison superseded" };
    }
    entry.result = result;
    entry.expiresAt = Date.now() + (result.success ? 60_000 : 5_000);
    entry.request = undefined;
    return result;
  });
  return entry.request;
}
