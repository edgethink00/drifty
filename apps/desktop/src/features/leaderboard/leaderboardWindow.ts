import type { LeaderboardPeriod } from "./leaderboardService";
import { shiftIsoDate } from "@drifty/domain";

export function getLeaderboardWindowStartDay(endDay: string, period: LeaderboardPeriod) {
  if (period === "daily") return endDay;
  return shiftIsoDate(endDay, period === "weekly" ? -6 : -29);
}

export function getLeaderboardPeriodFocusLabel(period: LeaderboardPeriod) {
  if (period === "daily") return "Daily focus total";
  if (period === "monthly") return "Rolling 30-day focus total";
  return "Rolling 7-day focus total";
}
