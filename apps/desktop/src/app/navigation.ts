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

export const commandBarTabs = [
  { id: "dashboard", labelKey: "nav.group.dashboard", subKey: "command.dashboardSub" },
  { id: "classification", labelKey: "nav.classification", subKey: "command.classificationSub" },
  { id: "projects", labelKey: "nav.projects", subKey: "command.projectsSub" },
  { id: "trends", labelKey: "nav.trends", subKey: "command.trendsSub" },
  { id: "history", labelKey: "nav.history", subKey: "command.historySub" },
  { id: "leaderboard", labelKey: "nav.group.social", subKey: "command.socialSub" },
  { id: "settings", labelKey: "common.settings", subKey: "command.settingsSub" },
] satisfies ReadonlyArray<{ id: TabId; labelKey: TranslationKey; subKey: TranslationKey }>;

export type NavIconType = "home" | "calendar" | "agents" | "classification" | "projects" | "history" | "trends" | "leaderboard" | "profile" | "social" | "team" | "settings";

export type NavItem = {
  id: TabId;
  labelKey: TranslationKey;
  icon: NavIconType;
};

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
