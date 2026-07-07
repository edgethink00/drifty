import type { ClassificationRange, DashboardPeriod } from "./dashboardPeriods";
import type { StartOfWeek } from "../settings/settingsStorage";

export type DashboardRefreshTabId = "dashboard" | "classification" | "projects" | "history" | "trends" | "leaderboard" | "team" | "settings";

export type DashboardRefreshInputs = {
  readonly selectedDay: string;
  readonly startOfDayMinutes: number;
  readonly startOfWeek: StartOfWeek;
};

export type DashboardRefreshMode = "skip" | "foreground" | "background";

export function shouldRefreshHistoryData(activeTab: DashboardRefreshTabId, dashPeriod: DashboardPeriod, classificationRange: ClassificationRange): boolean {
  if (activeTab === "dashboard") return dashPeriod !== "Today";
  if (activeTab === "classification") return classificationRange === "Week";
  return activeTab === "history" || activeTab === "trends";
}

export function resolveDashboardRefreshMode({
  hasLoadedOnce,
  nextInputs,
  previousInputs,
}: {
  readonly hasLoadedOnce: boolean;
  readonly nextInputs: DashboardRefreshInputs;
  readonly previousInputs: DashboardRefreshInputs | null;
}): DashboardRefreshMode {
  if (!hasLoadedOnce || previousInputs === null) return "foreground";
  if (
    previousInputs.selectedDay === nextInputs.selectedDay &&
    previousInputs.startOfDayMinutes === nextInputs.startOfDayMinutes &&
    previousInputs.startOfWeek === nextInputs.startOfWeek
  ) {
    return "skip";
  }

  if (
    previousInputs.startOfDayMinutes !== nextInputs.startOfDayMinutes ||
    previousInputs.startOfWeek !== nextInputs.startOfWeek
  ) {
    return "foreground";
  }

  return "background";
}

export type DashboardPreviousWeekFocusLoad = {
  readonly key: string;
  readonly focusSeconds: number;
};

export type DashboardWeekRefreshStatus = "idle" | "loading" | "error";

export type DashboardWeekRefreshState = {
  readonly key: string | null;
  readonly status: DashboardWeekRefreshStatus;
};

export const DASHBOARD_PREVIOUS_WEEK_FOCUS_DELAY_MS = 4000;
