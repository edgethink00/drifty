import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOwnLeaderboardEntry,
  type LeaderboardResult,
  type OwnLeaderboardEntry,
} from "../leaderboard/leaderboardService";
import type { ShareCardLiveRank, ShareCardLiveRanks } from "./shareCardUnifiedSvg";

import { invalidateShareCardRanks, loadShareCardRank, peekShareCardRank } from "./shareCardRankCache";

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
export function useShareCardLiveRanks(enabled: boolean, accountScope: string | null = null, windowKey = "") {
  const loadRevision = useRef(0);
  const lifetime = useRef({ accountScope, windowKey, active: true });
  lifetime.current.accountScope = accountScope;
  lifetime.current.windowKey = windowKey;
  const initialState = useCallback((): ShareCardLiveRanksState => {
    if (!enabled || !accountScope) return INITIAL_STATE;
    const periodState = (period: "daily" | "weekly") => {
      const cached = peekShareCardRank(accountScope, windowKey, period);
      return cached ? resolveShareCardRankState(cached) : LOADING_RANK;
    };
    return { daily: periodState("daily"), weekly: periodState("weekly") };
  }, [enabled, accountScope, windowKey]);
  const [snapshot, setSnapshot] = useState(() => ({ accountScope, windowKey, state: initialState() }));
  const state = snapshot.accountScope === accountScope && snapshot.windowKey === windowKey ? snapshot.state : initialState();

  const load = useCallback(async (disposed: () => boolean) => {
    if (!enabled || !accountScope) return;
    await Promise.all((["daily", "weekly"] as const).map(async period => {
      const result = await loadShareCardRank(accountScope, windowKey, period, () => fetchOwnLeaderboardEntry(period, undefined, accountScope));
      if (disposed()) return;
      setSnapshot(previous => ({ accountScope, windowKey, state: {
        ...(previous.accountScope === accountScope && previous.windowKey === windowKey ? previous.state : initialState()),
        [period]: resolveShareCardRankState(result),
      } }));
    }));
  }, [enabled, accountScope, windowKey, initialState]);

  const refresh = useCallback(async () => {
    const inactive = () => !lifetime.current.active || lifetime.current.accountScope !== accountScope || lifetime.current.windowKey !== windowKey;
    if (!enabled || !accountScope || inactive()) return;
    const revision = ++loadRevision.current;
    const obsolete = () => inactive() || revision !== loadRevision.current;
    invalidateShareCardRanks(accountScope);
    setSnapshot({ accountScope, windowKey, state: { daily: LOADING_RANK, weekly: LOADING_RANK } });
    await load(obsolete);
  }, [enabled, accountScope, windowKey, load]);

  useEffect(() => {
    let disposed = false;
    const revision = ++loadRevision.current;
    const currentLifetime = lifetime.current;
    currentLifetime.active = true;
    setSnapshot({ accountScope, windowKey, state: initialState() });
    void load(() => disposed || revision !== loadRevision.current);
    return () => { disposed = true; currentLifetime.active = false; };
  }, [accountScope, windowKey, initialState, load]);

  return { state, liveRanks: toShareCardLiveRanks(state), refresh };
}
