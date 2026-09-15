import type { DashboardPeriod, DashboardPeriodOption } from "../features/dashboard/dashboardPeriods";
import type { TranslationKey } from "../features/localization/translations";

export type TabId = "dashboard" | "agents" | "classification" | "projects" | "history" | "trends" | "leaderboard" | "profile" | "team" | "settings";

export type NavigationSnapshot = {
  tabId: TabId;
  dashPeriod: DashboardPeriod;
};

export type NavigationHistoryState = {
  entries: NavigationSnapshot[];
  index: number;
};

export function replaceNavigationHistoryTab(
  history: NavigationHistoryState,
  hiddenTab: TabId,
  replacement: NavigationSnapshot,
): NavigationHistoryState {
  const entries: NavigationSnapshot[] = [];
  let index = 0;
  let changed = false;

  history.entries.forEach((entry, entryIndex) => {
    const nextEntry = entry.tabId === hiddenTab ? replacement : entry;
    if (nextEntry !== entry) changed = true;
    const previous = entries[entries.length - 1];
    const duplicate = previous?.tabId === nextEntry.tabId && previous.dashPeriod === nextEntry.dashPeriod;
    if (!duplicate) entries.push(nextEntry);
    else changed = true;
    if (entryIndex <= history.index) index = Math.max(0, entries.length - 1);
  });

  return changed ? { entries: entries.length > 0 ? entries : [replacement], index } : history;
}

export type NavIconType = "home" | "calendar" | "agents" | "classification" | "projects" | "history" | "trends" | "leaderboard" | "profile" | "social" | "team" | "settings";

export type NavItem = {
  id: TabId;
  labelKey: TranslationKey;
  icon: NavIconType;
};

export const primaryNav: NavItem[] = [
  { id: "dashboard", labelKey: "nav.calendar", icon: "calendar" },
  { id: "agents", labelKey: "nav.agents", icon: "agents" },
  { id: "projects", labelKey: "nav.projects", icon: "projects" },
  { id: "trends", labelKey: "nav.trends", icon: "trends" },
  { id: "classification", labelKey: "nav.classification", icon: "classification" },
  { id: "history", labelKey: "nav.history", icon: "history" },
];

export const dashboardPeriodOptions: DashboardPeriodOption[] = [
  { period: "Today", label: "Your Day", detail: "Live timeline" },
  { period: "Week", label: "Your Week", detail: "Calendar week" },
];

export const activityNav: NavItem[] = [
  { id: "classification", labelKey: "nav.classification", icon: "classification" },
  { id: "projects", labelKey: "nav.projects", icon: "projects" },
  { id: "trends", labelKey: "nav.trends", icon: "trends" },
  { id: "history", labelKey: "nav.history", icon: "history" },
];
