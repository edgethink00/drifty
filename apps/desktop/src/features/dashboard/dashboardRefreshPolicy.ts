import type { ClassificationRange, DashboardPeriod } from "./dashboardPeriods";
import type { StartOfWeek } from "../settings/settingsStorage";

export type DashboardRefreshTabId = "dashboard" | "agents" | "classification" | "projects" | "history" | "trends" | "leaderboard" | "profile" | "team" | "settings";

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

// An unfocused renderer keeps the selected day fresh with the cheap cursor
// live-tail. Rebuilding the whole day timeline on every 30s tick instead is
// what churned the main-window WKWebView heap into multi-GB footprints during
// long unfocused stretches, so the full (lite) rebuild runs at most at this
// cadence to bound staleness from reclassifications and edits that the
// append-only live-tail merge cannot pick up.
export const BACKGROUND_RECONCILE_INTERVAL_MS = 10 * 60_000;

export type AppRefreshTickAction = "live-tail" | "reconcile";

export function resolveAppRefreshTickAction({
  rendererFocused,
  nowMs,
  lastFullDayRefreshAtMs,
}: {
  readonly rendererFocused: boolean;
  readonly nowMs: number;
  readonly lastFullDayRefreshAtMs: number;
}): AppRefreshTickAction {
  if (rendererFocused) return "live-tail";
  return nowMs - lastFullDayRefreshAtMs >= BACKGROUND_RECONCILE_INTERVAL_MS ? "reconcile" : "live-tail";
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
