import { shiftIsoDate } from "@drifty/domain";
import {
  estimateCommunityFocusPercentile,
  isCommunityFocusPercentileModelFresh,
  type CommunityFocusPercentileModels,
} from "../companion/communityFocusPercentile";
import type { ShareCardData, ShareWeekCardData } from "./shareCard";

/** Same cohort, freshness gate, and calculation used by Companion achievements. */
export function estimateShareCardFocusPercentile(
  data: ShareCardData | ShareWeekCardData,
  models: CommunityFocusPercentileModels | undefined,
) {
  if (!data.isCurrentPeriod || !Number.isFinite(data.focusSeconds) || data.focusSeconds <= 0) return null;
  const period = "day" in data ? "daily" : "weekly";
  const model = models?.[period];
  if (!isCommunityFocusPercentileModelFresh(model) || model.period !== period) return null;
  // Calendar weeks usually differ from the leaderboard's rolling seven days.
  // Never compare a partial calendar week with a full rolling-week cohort.
  if (!("day" in data) && (
    !data.comparisonDay
    || data.endDay !== data.comparisonDay
    || data.startDay !== shiftIsoDate(data.comparisonDay, -6)
  )) return null;
  return estimateCommunityFocusPercentile(data.focusSeconds, model);
}
