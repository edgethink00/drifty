import type { DashboardPeriod, DashboardPeriodOption } from "../features/dashboard/dashboardPeriods";

export type TabId = "dashboard" | "classification" | "projects" | "history" | "trends" | "leaderboard" | "profile" | "team" | "settings";

export type NavigationSnapshot = {
  tabId: TabId;
  dashPeriod: DashboardPeriod;
};

export type NavigationHistoryState = {
  entries: NavigationSnapshot[];
  index: number;
};

export const commandBarTabs = [
  { id: "dashboard", label: "Dashboard", sub: "Today at a glance" },
  { id: "classification", label: "Classification", sub: "Activity breakdown" },
  { id: "projects", label: "Projects", sub: "Time grouped by project" },
  { id: "trends", label: "Trends", sub: "Patterns and trends" },
  { id: "history", label: "History", sub: "Local records" },
  { id: "profile", label: "Social", sub: "Public profile and ranking" },
  { id: "settings", label: "Settings", sub: "App preferences" },
] satisfies ReadonlyArray<{ id: TabId; label: string; sub: string }>;

export type NavIconType = "home" | "calendar" | "classification" | "projects" | "history" | "trends" | "leaderboard" | "profile" | "social" | "team" | "settings";

export type NavItem = {
  id: TabId;
  label: string;
  icon: NavIconType;
};

export const dashboardPeriodOptions: DashboardPeriodOption[] = [
  { period: "Today", label: "Your Day", detail: "Live timeline" },
  { period: "Week", label: "Your Week", detail: "Calendar week" },
];

export const activityNav: NavItem[] = [
  { id: "classification", label: "Classification", icon: "classification" },
  { id: "projects", label: "Projects", icon: "projects" },
  { id: "trends", label: "Trends", icon: "trends" },
  { id: "history", label: "History", icon: "history" },
];
