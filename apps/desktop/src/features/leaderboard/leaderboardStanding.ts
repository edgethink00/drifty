import type { LeaderboardRow } from "./leaderboardService";

/**
 * Derived, aggregate-only standing helpers for the public profile popup.
 *
 * Everything here is computed from leaderboard rows the board already renders:
 * rank, participant count, and focus totals. No raw app, site, window, or
 * session history is involved.
 */

export type RankTier = "gold" | "silver" | "bronze";

export type RankGap = {
  /** `lead` is the #1 margin over the runner-up; `chase` is the deficit to the rank above. */
  readonly kind: "lead" | "chase";
  readonly seconds: number;
  readonly rivalRank: number;
};

export function getRankTier(rank: number): RankTier | null {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return null;
}

/**
 * Top-N% standing. Rounded up so the leader reads as "top 1%" instead of
 * "top 0%", and suppressed when the participant count cannot support the claim.
 */
export function getTopPercentile(rank: number, participantCount: number | null | undefined): number | null {
  if (!Number.isFinite(rank) || rank < 1) return null;
  const total = Number(participantCount);
  if (!Number.isFinite(total) || total < 1 || rank > total) return null;
  return Math.min(100, Math.max(1, Math.ceil((rank / total) * 100)));
}

/** Highest focus total on the same period board, or null when it is unusable. */
export function getLeaderFocusSeconds(rows: readonly LeaderboardRow[], row: LeaderboardRow): number | null {
  let best = 0;
  for (const candidate of rows) {
    if (candidate.period !== row.period) continue;
    best = Math.max(best, Math.max(0, candidate.focus_seconds));
  }
  best = Math.max(best, Math.max(0, row.focus_seconds));
  return best > 0 ? best : null;
}

/** 0..1 share of the leader's total, used for the popup progress meter. */
export function getLeaderShareRatio(focusSeconds: number, leaderFocusSeconds: number | null): number | null {
  if (leaderFocusSeconds === null || leaderFocusSeconds <= 0) return null;
  if (!Number.isFinite(focusSeconds) || focusSeconds <= 0) return 0;
  return Math.min(1, focusSeconds / leaderFocusSeconds);
}

/** Distance to the next rank up, or the leader's margin when this row is #1. */
export function getRankGap(rows: readonly LeaderboardRow[], row: LeaderboardRow): RankGap | null {
  if (!Number.isFinite(row.rank) || row.rank < 1) return null;
  const rivalRank = row.rank === 1 ? 2 : row.rank - 1;
  const rival = rows.find((candidate) => candidate.period === row.period && candidate.rank === rivalRank);
  if (!rival) return null;
  const seconds = row.rank === 1
    ? Math.max(0, row.focus_seconds - rival.focus_seconds)
    : Math.max(0, rival.focus_seconds - row.focus_seconds);
  return { kind: row.rank === 1 ? "lead" : "chase", seconds, rivalRank };
}
