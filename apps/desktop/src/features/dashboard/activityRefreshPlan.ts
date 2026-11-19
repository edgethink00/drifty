import { shiftIsoDate } from "@drifty/domain";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import {
  getDashboardPeriodRange,
  getInsightPeriodRange,
  type DashboardPeriod,
  type InsightRange,
} from "./dashboardPeriods";
import type { StartOfWeek } from "../settings/settingsStorage";

export const HISTORY_RECENT_LOOKBACK_DAYS = 6;
export const HISTORY_ARCHIVE_LOOKBACK_DAYS = 89;

type ActivityRefreshPlanInput = {
  readonly activeTab: string;
  readonly dashPeriod: DashboardPeriod;
  readonly day: string;
  readonly shouldLoadHistory: boolean;
  readonly startOfDayMinutes: number;
  readonly startOfWeek: StartOfWeek;
  readonly trendsRange: InsightRange;
};

type LogicalRange = {
  readonly start: string;
  readonly end: string;
};

export type ActivityRefreshPlan = {
  readonly historyAnchorDay: string;
  readonly historyRecentTimelineRange: LogicalRange | null;
  readonly historySummaryRange: LogicalRange;
  readonly historyTimelineRange: LogicalRange;
  readonly selectedDayRange: LogicalRange;
  readonly shouldLoadDashboardWeekHistory: boolean;
  readonly shouldLoadHistory: boolean;
  readonly shouldLoadHistorySummaries: boolean;
};

export function buildActivityRefreshPlan({
  activeTab,
  dashPeriod,
  day,
  shouldLoadHistory,
  startOfDayMinutes,
  startOfWeek,
  trendsRange,
}: ActivityRefreshPlanInput): ActivityRefreshPlan {
  const shouldLoadDashboardWeekHistory = shouldLoadHistory && activeTab === "dashboard" && dashPeriod === "Week";
  const shouldLoadTrendsHistory = activeTab === "trends";
  const trendsHistoryRange = shouldLoadTrendsHistory ? getInsightPeriodRange(day, trendsRange, startOfDayMinutes) : null;
  const historyAnchorDay = shouldLoadHistory && activeTab === "history" ? logicalTodayIsoDate(startOfDayMinutes) : day;
  const historyStartDay = trendsHistoryRange?.startDay ?? shiftIsoDate(historyAnchorDay, -HISTORY_ARCHIVE_LOOKBACK_DAYS);
  const historySummaryRange = trendsHistoryRange
    ? { start: trendsHistoryRange.start, end: trendsHistoryRange.end }
    : getLogicalDayRange(historyStartDay, historyAnchorDay, startOfDayMinutes);
  const selectedWeekRange = getDashboardPeriodRange(historyAnchorDay, "Week", startOfDayMinutes, startOfWeek);
  const todayDay = logicalTodayIsoDate(startOfDayMinutes);
  const dashboardWeekHistoryEndDay = shouldLoadDashboardWeekHistory
    && selectedWeekRange.startDay <= todayDay
    && todayDay <= selectedWeekRange.endDay
    ? todayDay
    : selectedWeekRange.endDay;
  const historyTimelineRange = trendsHistoryRange
    ? { start: trendsHistoryRange.start, end: trendsHistoryRange.end }
    // Classification's Week shows one week, so it reads that week: reading the
    // 90-day archive in full went over the tracker's 32 MiB budget on a real
    // account and the page failed with "작업을 마치지 못했어요".
    : activeTab === "classification"
      ? getLogicalDayRange(selectedWeekRange.startDay, selectedWeekRange.endDay, startOfDayMinutes)
      : getLogicalDayRange(
      shouldLoadDashboardWeekHistory ? selectedWeekRange.startDay : historyStartDay,
      shouldLoadDashboardWeekHistory
        ? dashboardWeekHistoryEndDay
        : historyAnchorDay > selectedWeekRange.endDay
          ? historyAnchorDay
          : selectedWeekRange.endDay,
      startOfDayMinutes,
    );
  const selectedDayRange = getLogicalDayRange(day, day, startOfDayMinutes);
  const shouldLoadHistorySummaries = shouldLoadHistory && !shouldLoadDashboardWeekHistory;
  const historyRecentTimelineRange = shouldLoadHistory && activeTab === "history"
    ? getLogicalDayRange(shiftIsoDate(historyAnchorDay, -HISTORY_RECENT_LOOKBACK_DAYS), historyAnchorDay, startOfDayMinutes)
    : null;

  return {
    historyAnchorDay,
    historyRecentTimelineRange,
    historySummaryRange,
    historyTimelineRange,
    selectedDayRange,
    shouldLoadDashboardWeekHistory,
    shouldLoadHistory,
    shouldLoadHistorySummaries,
  };
}
