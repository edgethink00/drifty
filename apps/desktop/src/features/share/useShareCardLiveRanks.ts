import { useCallback, useEffect, useState } from "react";
import {
  fetchOwnLeaderboardEntry,
  type LeaderboardResult,
  type OwnLeaderboardEntry,
} from "../leaderboard/leaderboardService";
import type { ShareCardLiveRank, ShareCardLiveRanks } from "./shareCardUnifiedSvg";

export type ShareCardRankAvailability = "loading" | "ready" | "not_joined" | "unavailable";

type ShareCardRankState = {
  readonly availability: ShareCardRankAvailability;
  readonly rank: ShareCardLiveRank | null;
};

export type ShareCardLiveRanksState = {
  readonly daily: ShareCardRankState;
  readonly weekly: ShareCardRankState;
};

const LOADING_RANK: ShareCardRankState = { availability: "loading", rank: null };
const NOT_JOINED_RANK: ShareCardRankState = { availability: "not_joined", rank: null };

const INITIAL_STATE: ShareCardLiveRanksState = {
  daily: NOT_JOINED_RANK,
  weekly: NOT_JOINED_RANK,
};

function topPercent(rank: number, participantCount: number): number {
  const raw = (rank / participantCount) * 100;
  if (raw < 0.1) return Math.round(raw * 1_000) / 1_000;
  if (raw < 1) return Math.round(raw * 100) / 100;
  return Math.round(raw * 10) / 10;
}

export function toShareCardLiveRank(entry: OwnLeaderboardEntry | null | undefined): ShareCardLiveRank | null {
  const rank = entry?.rank ?? null;
  const participantCount = entry?.participant_count ?? null;
  if (!entry?.opted_in || rank === null || rank < 1 || participantCount === null || participantCount < rank) return null;
  return {
    rank,
    participantCount,
    topPercent: topPercent(rank, participantCount),
    windowStartDay: entry.window_start_date,
    windowEndDay: entry.window_end_date,
  };
}

export function resolveShareCardRankState(result: LeaderboardResult<OwnLeaderboardEntry | null>): ShareCardRankState {
  if (!result.success) return { availability: "unavailable", rank: null };
  if (!result.data?.opted_in) return NOT_JOINED_RANK;
  const rank = toShareCardLiveRank(result.data);
  return rank ? { availability: "ready", rank } : { availability: "unavailable", rank: null };
}

function isReady(state: ShareCardRankState): state is ShareCardRankState & { readonly rank: ShareCardLiveRank } {
  return state.availability === "ready" && state.rank !== null;
}

export function toShareCardLiveRanks(state: ShareCardLiveRanksState): ShareCardLiveRanks {
  return {
    daily: isReady(state.daily) ? state.daily.rank : null,
    weekly: isReady(state.weekly) ? state.weekly.rank : null,
  };
}

/**
 * Loads only the member's own aggregate leaderboard facts when the share sheet
 * opens. This deliberately does not read or transmit any local activity rows.
 */
export function useShareCardLiveRanks(enabled: boolean) {
  const [state, setState] = useState<ShareCardLiveRanksState>(INITIAL_STATE);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(INITIAL_STATE);
      return;
    }
    setState({ daily: LOADING_RANK, weekly: LOADING_RANK });
    const [daily, weekly] = await Promise.all([
      fetchOwnLeaderboardEntry("daily"),
      fetchOwnLeaderboardEntry("weekly"),
    ]);
    setState({
      daily: resolveShareCardRankState(daily),
      weekly: resolveShareCardRankState(weekly),
    });
  }, [enabled]);

  useEffect(() => {
    let disposed = false;
    if (!enabled) {
      setState(INITIAL_STATE);
      return undefined;
    }
    setState({ daily: LOADING_RANK, weekly: LOADING_RANK });
    void Promise.all([
      fetchOwnLeaderboardEntry("daily"),
      fetchOwnLeaderboardEntry("weekly"),
    ]).then(([daily, weekly]) => {
      if (disposed) return;
      setState({
        daily: resolveShareCardRankState(daily),
        weekly: resolveShareCardRankState(weekly),
      });
    }).catch(() => {
      if (disposed) return;
      setState({
        daily: { availability: "unavailable", rank: null },
        weekly: { availability: "unavailable", rank: null },
      });
    });
    return () => {
      disposed = true;
    };
  }, [enabled]);

  return { state, liveRanks: toShareCardLiveRanks(state), refresh };
}
