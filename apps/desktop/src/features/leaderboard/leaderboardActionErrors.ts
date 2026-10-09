import type { Translate } from "../localization/translate";

export type LeaderboardParticipationAction = "join" | "leave";

/**
 * Turns a join/leave failure into one line in the app language. The services
 * underneath report English (Supabase messages, "Not authenticated", the
 * unconfigured-client guard), which used to reach the screen verbatim; the
 * original wording still goes to analytics as error_kind.
 */
export function describeLeaderboardActionError(
  error: unknown,
  action: LeaderboardParticipationAction,
  t: Translate,
): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/not authenticated|sign in|jwt expired|session (is )?missing/i.test(message)) return t("leaderboard.error.signInRequired");
  if (/failed to fetch|load failed|network|fetch failed|offline|timed out/i.test(message)) return t("leaderboard.error.network");
  if (/supabase is not configured/i.test(message)) return t("leaderboard.error.unavailable");
  return t(action === "join" ? "leaderboard.error.joinFailed" : "leaderboard.error.leaveFailed");
}
