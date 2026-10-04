import { useCallback, useEffect } from "react";
import { loadCommunityFocusPercentileModels } from "../companion/communityFocusPercentileModelService";
import { fetchOwnLeaderboardEntry } from "../leaderboard/leaderboardService";
import { loadShareCardRank } from "./shareCardRankCache";

/** Prepare aggregate comparisons once Share becomes available, without blocking Dashboard. */
export function useShareCardPreparation(enabled: boolean, accountScope: string | null, windowKey: string) {
  const prepare = useCallback(() => {
    if (!enabled) return;
    void loadCommunityFocusPercentileModels().catch(() => {});
    if (accountScope) {
      for (const period of ["daily", "weekly"] as const) {
        void loadShareCardRank(accountScope, windowKey, period, () => fetchOwnLeaderboardEntry(period, undefined, accountScope));
      }
    }
  }, [enabled, accountScope, windowKey]);
  useEffect(prepare, [prepare]);
  return prepare;
}
