import { shiftIsoDate } from "@drifty/domain";

import type { TeamFocusDataset } from "./teamFocusModel";
import type { TeamBoardGridId } from "./teamBoardModel";
import { isoWeekday } from "./teamFocusModel";
import {
  DEFAULT_TEAM_RECORDING_SCHEDULE,
  TEAM_SHARING_SCOPES,
  TEAM_TRACKING_POLICIES,
  type TeamSharingScope,
  type TeamTrackingPolicy,
} from "./teamSharingScope";
import { TEAM_SHARE_FIELDS, TEAM_SHARING_PRESET_IDS, type TeamManagerAccess, type TeamManagerSharing, type TeamShareField, type TeamSharingPresetId } from "./teamSharingPolicy";
import type {
  OwnTeam,
  TeamDirectoryMember,
  TeamFocusBlock,
  TeamGroup,
  TeamInvite,
  TeamMember,
  TeamMemberFocusDay,
  TeamMemberPresence,
  TeamMemberProjectDay,
  TeamMembershipRole,
  TeamProject,
} from "./teamTypes";

/**
 * Dev-mode preview scenarios for the Team surface. Each scenario is a point in
 * a small grid (organization size × sharing scope × who is looking × tracking
 * policy) and expands to a deterministic fixture, so the same scenario renders
 * the same screen on every machine and in every screenshot. Nothing here is
 * ever published; the surface shows a "Preview data" badge while a scenario
 * is active.
 */

export const TEAM_PREVIEW_SCALES = ["fresh", "trio", "team", "company", "enterprise"] as const;
export type TeamPreviewScale = typeof TEAM_PREVIEW_SCALES[number];

/** Organization admin (the owner), a team manager, or a member: the three seats a team has. */
export const TEAM_PREVIEW_VIEWERS = ["owner", "manager", "member"] as const;
export type TeamPreviewViewer = typeof TEAM_PREVIEW_VIEWERS[number];

/** How much a previewed manager manages: their own team, several teams apart, or a whole division. */
export const TEAM_PREVIEW_MANAGER_REACHES = ["one", "several", "division"] as const;
export type TeamPreviewManagerReach = typeof TEAM_PREVIEW_MANAGER_REACHES[number];

export type TeamPreviewScenario = {
  readonly scale: TeamPreviewScale;
  readonly scope: TeamSharingScope;
  readonly viewer: TeamPreviewViewer;
  readonly policy: TeamTrackingPolicy;
  /** The per-item combination the team starts from; without it the single scope decides. */
  readonly sharing?: TeamSharingPresetId;
  /** Whether members see their team's totals; on unless a scenario turns it off. */
  readonly memberSummary?: boolean;
  /** For a manager seat: how far they see, and how many teams they manage. */
  readonly managerAccess?: TeamManagerAccess;
  readonly managerReach?: TeamPreviewManagerReach;
  /** Candidate E: whether the organization admin lets this manager narrow sharing; they may by default. */
  readonly managerSharing?: TeamManagerSharing;
};

export const DEFAULT_TEAM_PREVIEW_SCENARIO: TeamPreviewScenario = {
  scale: "team",
  scope: "focus_blocks",
  viewer: "owner",
  policy: "managed",
};

export type TeamPreviewOption<T extends string> = { readonly id: T; readonly label: string; readonly detail: string };

export const TEAM_PREVIEW_SCALE_OPTIONS: readonly TeamPreviewOption<TeamPreviewScale>[] = [
  { id: "fresh", label: "New team · only you", detail: "Just made: nobody invited yet, no projects, nothing shared" },
  { id: "trio", label: "Small team · 3 people", detail: "One team of three" },
  { id: "team", label: "Team · 8 people", detail: "One flat team, no groups" },
  { id: "company", label: "Company · 100 people", detail: "7 departments, one of two people, two on their own sharing" },
  { id: "enterprise", label: "Enterprise · 500 people", detail: "4 divisions, 14 teams, one of two people, two on their own sharing" },
];

export const TEAM_PREVIEW_SCOPE_OPTIONS: readonly TeamPreviewOption<TeamSharingScope>[] = [
  { id: "projects", label: "Projects only", detail: "Per-project totals, member split as %" },
  { id: "team_focus", label: "Team focus total", detail: "Pooled focus time, no per-member hours" },
  { id: "member_focus", label: "Member focus", detail: "Each member's focus time and deep blocks" },
  { id: "focus_blocks", label: "Focus blocks", detail: "Plus when in the day focus happened" },
];

export const TEAM_PREVIEW_VIEWER_OPTIONS: readonly TeamPreviewOption<TeamPreviewViewer>[] = [
  { id: "owner", label: "Organization admin (owner)", detail: "Every team and member, and the settings" },
  { id: "manager", label: "Team manager", detail: "The teams they manage, at their access" },
  { id: "member", label: "Member", detail: "Their own records and, if allowed, their team's totals" },
];

export const TEAM_PREVIEW_SHARING_OPTIONS: readonly TeamPreviewOption<TeamSharingPresetId>[] = [
  { id: "project_totals", label: "Project totals", detail: "Team totals per project, nothing per person" },
  { id: "work_log", label: "Daily work log", detail: "Each person's projects and work titles by day" },
  { id: "work_and_focus", label: "Work and focus", detail: "Daily work log plus each person's daily focus" },
  { id: "full_timeline", label: "Full timeline", detail: "Titles, projects and focus with their times" },
];

export const TEAM_PREVIEW_MEMBER_SUMMARY_OPTIONS: readonly TeamPreviewOption<"on" | "off">[] = [
  { id: "on", label: "Members see team totals", detail: "Their own records plus their team's totals" },
  { id: "off", label: "Members see own records only", detail: "The team summary stays with managers" },
];

export const TEAM_PREVIEW_MANAGER_ACCESS_OPTIONS: readonly TeamPreviewOption<TeamManagerAccess>[] = [
  { id: "detail", label: "Manager · individual detail", detail: "Each person's records, within the sharing" },
  { id: "summary", label: "Manager · team totals", detail: "Their teams' totals, no one's figures" },
];

export const TEAM_PREVIEW_MANAGER_REACH_OPTIONS: readonly TeamPreviewOption<TeamPreviewManagerReach>[] = [
  { id: "one", label: "Manages one team", detail: "Their own team" },
  { id: "several", label: "Manages several teams", detail: "Three teams in different places" },
  { id: "division", label: "Manages a division", detail: "A division and all its teams (480 only)" },
];

export const TEAM_PREVIEW_POLICY_OPTIONS: readonly TeamPreviewOption<TeamTrackingPolicy>[] = [
  { id: "free", label: "Free", detail: "Members pause as they like" },
  { id: "managed", label: "Managed", detail: "No pausing, 09:00–18:00 Mon–Fri, tracking status shown" },
];

/**
 * Dev-only candidate for the Overview's right-hand card: the Projects page's
 * share dial (the default) or Insights' ranked rows. Read only while a
 * preview scenario is active, so it never reaches a live team.
 */
export const TEAM_PROJECT_PANEL_CANDIDATE_KEY = "drifty.dev.teamProjectPanel";
export const TEAM_PROJECT_PANEL_OPTIONS: readonly TeamPreviewOption<"list" | "donut">[] = [
  { id: "donut", label: "C · Share dial (default)", detail: "Projects page PROJECT SHARE; ranked rows past 5 projects" },
  { id: "list", label: "B · Ranked list always", detail: "Insights FOCUS APPS rows, per project" },
];

export function readTeamProjectPanelCandidate(): "list" | "donut" {
  if (typeof window === "undefined") return "donut";
  try {
    return window.localStorage.getItem(TEAM_PROJECT_PANEL_CANDIDATE_KEY) === "list" ? "list" : "donut";
  } catch {
    return "donut";
  }
}

export function writeTeamProjectPanelCandidate(value: "list" | "donut"): void {
  try {
    if (value === "donut") window.localStorage.removeItem(TEAM_PROJECT_PANEL_CANDIDATE_KEY);
    else window.localStorage.setItem(TEAM_PROJECT_PANEL_CANDIDATE_KEY, value);
  } catch {
    // The choice still applies for this session.
  }
}

/** Compare the recent-period graph around allocation; keep the original storage key for review links. */
export type TeamMemberHistoryPosition = "above" | "below";
export const TEAM_MEMBER_HISTORY_POSITION_KEY = "drifty.dev.teamMemberSummaryPosition";
export const TEAM_MEMBER_HISTORY_POSITION_OPTIONS: readonly TeamPreviewOption<TeamMemberHistoryPosition>[] = [
  { id: "above", label: "A · Recent periods above", detail: "Recent-period chart before project allocation" },
  { id: "below", label: "B · Recent periods below", detail: "Default: project allocation before recent-period chart" },
];
export function readTeamMemberHistoryPosition(): TeamMemberHistoryPosition {
  if (typeof window === "undefined") return "below";
  try {
    const tabChoice = window.sessionStorage.getItem(TEAM_MEMBER_HISTORY_POSITION_KEY);
    if (tabChoice === "above" || tabChoice === "below") return tabChoice;
  } catch {
    // A per-tab review override must not prevent the normal Dev preference.
  }
  try {
    return window.localStorage.getItem(TEAM_MEMBER_HISTORY_POSITION_KEY) === "above" ? "above" : "below";
  } catch {
    return "below";
  }
}
export function writeTeamMemberHistoryPosition(value: TeamMemberHistoryPosition): void {
  try {
    window.sessionStorage.removeItem(TEAM_MEMBER_HISTORY_POSITION_KEY);
  } catch {
    // The persistent preference can still be saved without a tab override.
  }
  try {
    if (value === "below") window.localStorage.removeItem(TEAM_MEMBER_HISTORY_POSITION_KEY);
    else window.localStorage.setItem(TEAM_MEMBER_HISTORY_POSITION_KEY, value);
  } catch {
    // Preview persistence is optional.
  }
}

/** Dev-only candidates for the member page while the owner compares them. */
export const TEAM_MEMBER_PAGE_KEY = "drifty.dev.teamMemberPage";
export type TeamMemberPageLayout =
  | "complete" | "mirror" | "mirror-stack" | "mirror-mix"
  | "week" | "week-wide" | "week-lanes"
  | "ledger" | "ledger-sheet" | "ledger-days"
  | "trend" | "trend-mix" | "trend-shifts";
export const DEFAULT_TEAM_MEMBER_PAGE: TeamMemberPageLayout = "complete";
export const TEAM_MEMBER_PAGE_OPTIONS: readonly TeamPreviewOption<TeamMemberPageLayout>[] = [
  { id: "complete", label: "Complete · Maximum sharing first", detail: "Work timeline, project detail, focus summary and recent periods; subtract by scope" },
  { id: "mirror", label: "A1 · The Overview, for one person", detail: "By day beside what they worked on" },
  { id: "mirror-stack", label: "A2 · Stacked for a meeting screen", detail: "By day full width, the mix as one bar under it" },
  { id: "mirror-mix", label: "A3 · Mix only", detail: "Each day's share by project, no hours" },
  { id: "week", label: "B1 · Calendar with a rail", detail: "Your Week calendar, what they worked on beside it" },
  { id: "week-wide", label: "B2 · Calendar full width", detail: "Projects in one row above, no rail" },
  { id: "week-lanes", label: "B3 · Day lanes", detail: "A row per day across the hours, beside the projects" },
  { id: "ledger", label: "C1 · Ledger with change", detail: "A row per project: by day, time, vs previous" },
  { id: "ledger-sheet", label: "C2 · Timesheet", detail: "Hours per project per day, with day totals" },
  { id: "ledger-days", label: "C3 · Days on each project", detail: "Which days, share and time; no hours per day" },
  { id: "trend", label: "D1 · Recent weeks in hours", detail: "Last four windows stacked by project" },
  { id: "trend-mix", label: "D2 · Mix over eight weeks", detail: "Each window's share by project, no hours" },
  { id: "trend-shifts", label: "D3 · What shifted, in words", detail: "Recent weeks beside what moved against their usual" },
];
/** How many windows the member page compares, including the current one. */
export function teamMemberPageWindowCount(layout: TeamMemberPageLayout): number {
  return layout === "trend-mix" ? 8 : 4;
}

export function readTeamMemberPage(): TeamMemberPageLayout {
  if (typeof window === "undefined") return DEFAULT_TEAM_MEMBER_PAGE;
  try {
    const value = window.localStorage.getItem(TEAM_MEMBER_PAGE_KEY);
    return TEAM_MEMBER_PAGE_OPTIONS.some((option) => option.id === value) ? value as TeamMemberPageLayout : DEFAULT_TEAM_MEMBER_PAGE;
  } catch {
    return DEFAULT_TEAM_MEMBER_PAGE;
  }
}

export function writeTeamMemberPage(value: TeamMemberPageLayout): void {
  try {
    if (value === DEFAULT_TEAM_MEMBER_PAGE) window.localStorage.removeItem(TEAM_MEMBER_PAGE_KEY);
    else window.localStorage.setItem(TEAM_MEMBER_PAGE_KEY, value);
  } catch {
    // The choice still applies for this session.
  }
}

/**
 * A Dev-only choice between design candidates, stored under one key; the
 * first option is the default and is stored as nothing. Read only while a
 * preview scenario is active, so a live team never sees a candidate.
 */
function devCandidate<T extends string>(key: string, options: readonly TeamPreviewOption<T>[]) {
  const fallback = options[0]!.id;
  return {
    key,
    options,
    read(): T {
      if (typeof window === "undefined") return fallback;
      try {
        const value = window.localStorage.getItem(key);
        return options.some((option) => option.id === value) ? value as T : fallback;
      } catch {
        return fallback;
      }
    },
    write(value: T): void {
      try {
        if (value === fallback) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {
        // The choice still applies for this session.
      }
    },
  };
}

/** What a member sees of themself on the Overview. */
export type TeamMemberSelfView = "preview" | "line" | "page" | "tab" | "none" | "rize";
export const TEAM_MEMBER_SELF_VIEW = devCandidate<TeamMemberSelfView>("drifty.dev.teamMemberSelfView", [
  { id: "rize", label: "F · The managers' Overview, own row only (Rize) (decided 2026-10-21)", detail: "The same Overview managers open, its people list cut to the member's own card, with no line naming it" },
  { id: "preview", label: "A · What managers see of me (previous)", detail: "Each shared item with this period's figure, and a link to the page managers open" },
  { id: "line", label: "B · Own card and one line", detail: "The own card as before, with the shared items in one line under it" },
  { id: "page", label: "C · My records in the Overview", detail: "The page managers open of me, under the team's totals where the people would be" },
  { id: "tab", label: "D · My records tab first", detail: "The page managers open of me as its own tab, opened first; the Overview keeps the team's totals" },
  { id: "none", label: "E · No own records in the team (RescueTime)", detail: "The team page holds the team's totals only; a member's records stay in the personal views" },
]);

/** How an organization admin sets sharing for many teams. */
export type TeamSharingSettingsLayout = "picker" | "table";
export const TEAM_SHARING_SETTINGS_LAYOUT = devCandidate<TeamSharingSettingsLayout>("drifty.dev.teamSharingSettings", [
  { id: "picker", label: "A · Pick a team, same editor (decided 2026-10-21)", detail: "The default or one team in a menu above the sharing table" },
  { id: "table", label: "B · Every team in a table", detail: "One row per team with its levels; a row opens its editor" },
]);

/** Decision: what a view adding several teams shows. */
export type TeamAcrossRule = "projects" | "allFocus" | "sharedFocus";
export const TEAM_ACROSS_RULE = devCandidate<TeamAcrossRule>("drifty.dev.teamAcrossRule", [
  { id: "projects", label: "A · Project time only (decided 2026-10-21)", detail: "Focus only inside one team" },
  { id: "allFocus", label: "B · Focus when every team shares it", detail: "Otherwise project time" },
  { id: "sharedFocus", label: "C · Focus from the teams that share it", detail: "The others named as left out" },
]);

/** Decision: whether a team manager changes their team's sharing. */
export type TeamManagerEditRule = "admins" | "narrow" | "ceiling" | "delegate" | "grant";
export const TEAM_MANAGER_EDIT = devCandidate<TeamManagerEditRule>("drifty.dev.teamManagerEdit", [
  { id: "grant", label: "E · Each manager may narrow, or not (decided 2026-10-21)", detail: "Organization admins let chosen managers narrow their teams' sharing, as Rize keeps team Admin apart from Manager" },
  { id: "admins", label: "A · Organization admins only (previous)", detail: "Managers read their teams' sharing" },
  { id: "narrow", label: "B · Managers may only narrow", detail: "Up to what the admin set, never beyond" },
  { id: "ceiling", label: "C · Managers choose under a ceiling", detail: "Anything up to the organization's ceiling (preview: work and focus)" },
  { id: "delegate", label: "D · Lock or leave each item", detail: "Organization admins lock an item or leave it to managers, as Slack and GitHub do (preview: focus locked)" },
]);

/** The manager seat's own grant under candidate E. */
export const TEAM_PREVIEW_MANAGER_SHARING_OPTIONS: readonly TeamPreviewOption<TeamManagerSharing>[] = [
  { id: "narrow", label: "Manager may narrow sharing", detail: "Candidate E: the admin allowed it" },
  { id: "view", label: "Manager reads sharing only", detail: "Candidate E: the admin did not allow it" },
];

/** Decision: which clock a team's recording hours follow. */
export type TeamHoursZone = "hidden" | "choose";
export const TEAM_HOURS_ZONE = devCandidate<TeamHoursZone>("drifty.dev.teamHoursZone", [
  { id: "choose", label: "B · Team time or each person's local time (decided 2026-10-21)", detail: "Hours say whose clock they follow, as Rize keeps a time zone per member" },
  { id: "hidden", label: "A · One clock, not shown (previous)", detail: "Hours run on the organization's time zone" },
]);

/** Decision: the page title in an organization of divisions and teams. */
export type TeamPageTitle = "section" | "path" | "sectionPath" | "kind";
export const TEAM_PAGE_TITLE = devCandidate<TeamPageTitle>("drifty.dev.teamPageTitle", [
  { id: "path", label: "B · Organization / division / team (decided 2026-10-21)", detail: "The title is where you are; the small path goes" },
  { id: "section", label: "A · Teams / organization (previous)", detail: "Where you are sits in a small path above the headline" },
  { id: "sectionPath", label: "C · Teams / organization / division / team", detail: "The page name, then where you are" },
  { id: "kind", label: "D · Organization / name once it has teams", detail: "Only the first word changes; the small path stays" },
]);

/** Decision: what the title's chevron switches once the title is the seat's path (page title B or C). */
export type TeamTitleSwitcher = "organization" | "team";
export const TEAM_TITLE_SWITCHER = devCandidate<TeamTitleSwitcher>("drifty.dev.teamTitleSwitcher", [
  { id: "team", label: "B · Teams, on where you are (Rize) (decided 2026-10-21)", detail: "The chevron sits at the end of the path and lists the teams you can open, with search; other organizations move to the menu's foot" },
  { id: "organization", label: "A · Organizations (previous)", detail: "The chevron by the organization's name lists your organizations" },
]);

/** The sharing editor's form: Settings switches are the decision (2026-10-20, C); the earlier forms stay for comparison. */
export type TeamSharingEditorForm = "toggles" | "switch" | "table";
export const TEAM_SHARING_EDITOR = devCandidate<TeamSharingEditorForm>("drifty.dev.teamSharingEditor", [
  { id: "toggles", label: "C · Settings switches (decided)", detail: "Each person's work records, by time of day beneath it, focus, and team totals for members, with a sample of what a manager reads" },
  { id: "switch", label: "A · One work-record choice and a focus switch (previous)", detail: "Work record by time of day, daily totals or team totals; focus shared or not" },
  { id: "table", label: "B · Item-by-detail table (earlier)", detail: "Project time, work titles and focus each on their own level" },
]);

/** Decision: a Dashboard tab beside the Overview for admins and managers (draft, 2026-10-20). */
export type TeamDashboardTab = "tab" | "none";
export const TEAM_DASHBOARD_TAB = devCandidate<TeamDashboardTab>("drifty.dev.teamDashboardTab", [
  { id: "tab", label: "A · Dashboard tab for admins and managers (decided 2026-10-21)", detail: "A board of widgets per organization, division or team, over what it shares" },
  { id: "none", label: "B · Overview only (previous)", detail: "No Dashboard tab" },
]);

/** How the Dashboard divides the screen: A is the decision (2026-10-20); the others stay for comparison. */
export const TEAM_BOARD_GRID = devCandidate<TeamBoardGridId>("drifty.dev.teamBoardGrid", [
  { id: "calibrated", label: "A · 4 columns, 120px rows (decided)", detail: "One row holds key numbers; a 2×2 holds the project list" },
  { id: "current", label: "B · 4 columns, 148px rows (previous)", detail: "The first draft's rows" },
  { id: "thirds", label: "C · 3 columns, 120px rows", detail: "The chart takes two thirds, the project list one" },
  { id: "twelfths", label: "D · 12 columns, 32px rows", detail: "Halves, thirds and 7:5 splits; lists as tall as their rows in small steps, as Datadog and Grafana" },
  { id: "screen", label: "E · 4 columns, five rows to a screen (Rize)", detail: "The window below the board split in five, never under 120px; lists scroll inside" },
  { id: "auto", label: "F · 4 columns, rows as tall as their widgets", detail: "A size sets the width only; long lists scroll past nine rows" },
]);

/** Decision: how a leader sizes a widget on their own board (2026-10-21). */
export type TeamBoardResizeMode = "both" | "height" | "menu";
export const TEAM_BOARD_RESIZE = devCandidate<TeamBoardResizeMode>("drifty.dev.teamBoardResize", [
  { id: "both", label: "B · Drag height, and half or full width (decided 2026-10-21)", detail: "The bottom edge sets rows; widgets that read well at both widths also drag between half and full" },
  { id: "height", label: "A · Drag height only (Rize)", detail: "Each widget keeps its width; the bottom edge sets rows" },
  { id: "menu", label: "C · Pick a size from the menu (previous)", detail: "Sizes such as 4×3 and 4×2 in the widget's menu" },
]);

/** Decided 2026-10-25 (A): what sits beside the members on the Overview; the other candidates stay for comparison. */
export type TeamMemberTools = "lean" | "icon" | "auto" | "current";
export const TEAM_MEMBER_TOOLS = devCandidate<TeamMemberTools>("drifty.dev.teamMemberTools", [
  { id: "lean", label: "A · Search and grid or list (decided 2026-10-25)", detail: "No sorting: people stay in name order, so the page never ranks them" },
  { id: "icon", label: "B · A search button and grid or list", detail: "Search opens from a button and closes when empty" },
  { id: "auto", label: "C · Search only", detail: "Cards up to twelve people, a list beyond, with no switch" },
  { id: "current", label: "D · As before", detail: "Search, sorting by name, focus or team, and grid or list" },
]);

/** Decided 2026-10-25 (A): how a leader rearranges a board; the other candidates stay for comparison. */
export type TeamBoardEditMode = "mode" | "hover" | "hybrid" | "always";
export const TEAM_BOARD_EDIT = devCandidate<TeamBoardEditMode>("drifty.dev.teamBoardEdit", [
  { id: "mode", label: "A · An Edit button, then Done (decided 2026-10-25)", detail: "Rize, Grafana, Metabase, Jira: the board reads clean; while editing, a widget shows its handle when the pointer is on it" },
  { id: "hover", label: "B · On hover, no mode (Mixpanel)", detail: "The handle, size edges and menu appear on the widget under the pointer" },
  { id: "hybrid", label: "C · Sizes on hover, moving in Edit (PostHog)", detail: "Edges drag at any time; the handles come with Edit" },
  { id: "always", label: "D · Handles always shown (previous)", detail: "Every widget of a leader's own board shows its handle" },
]);

/** Decided 2026-10-25 (A): what happens when a leader changes the standard board; the other candidates stay for comparison. */
export type TeamBoardForkRule = "auto" | "duplicate" | "saveBar" | "locked";
export const TEAM_BOARD_FORK = devCandidate<TeamBoardForkRule>("drifty.dev.teamBoardFork", [
  { id: "auto", label: "A · The first change makes it your board (decided 2026-10-25)", detail: "The standard board stays; the change opens as My board with Undo" },
  { id: "duplicate", label: "B · Duplicate to edit (Datadog)", detail: "The standard board does not move; its Edit makes a copy first" },
  { id: "saveBar", label: "C · Change, then save as your board (GA4)", detail: "Changes wait in a bar: Save as my board or Discard" },
  { id: "locked", label: "D · Locked (previous)", detail: "Only New board makes a board to arrange" },
]);

/** Decided 2026-10-25 (A): what New board starts from; the other candidates stay for comparison. */
export type TeamBoardNewFlow = "popover" | "dialog" | "blank" | "copy";
export const TEAM_BOARD_NEW = devCandidate<TeamBoardNewFlow>("drifty.dev.teamBoardNew", [
  { id: "popover", label: "A · A small menu: blank, templates or a copy (decided 2026-10-25)", detail: "Each choice with a picture of its widgets" },
  { id: "dialog", label: "B · A window of larger template cards (Rize)", detail: "Start from scratch, templates and a copy of the open board" },
  { id: "blank", label: "C · Always blank", detail: "An empty board that asks for its first widget" },
  { id: "copy", label: "D · A copy of the open board (previous)", detail: "The board on screen, renamed in place" },
]);

/** Candidate D in the preview: the items an organization admin leaves to team managers, kept on this device. */
const TEAM_MANAGER_DELEGATION_KEY = "drifty.dev.teamManagerDelegation";
const DEFAULT_TEAM_MANAGER_DELEGATION: readonly TeamShareField[] = ["projects", "tasks"];

export function readTeamManagerDelegation(): readonly TeamShareField[] {
  if (typeof window === "undefined") return DEFAULT_TEAM_MANAGER_DELEGATION;
  try {
    const value = window.localStorage.getItem(TEAM_MANAGER_DELEGATION_KEY);
    if (value === null) return DEFAULT_TEAM_MANAGER_DELEGATION;
    if (value === "none") return [];
    const fields = value.split(",");
    return TEAM_SHARE_FIELDS.filter((field) => fields.includes(field));
  } catch {
    return DEFAULT_TEAM_MANAGER_DELEGATION;
  }
}

export function writeTeamManagerDelegation(fields: readonly TeamShareField[]): void {
  try {
    window.localStorage.setItem(TEAM_MANAGER_DELEGATION_KEY, fields.length > 0 ? TEAM_SHARE_FIELDS.filter((field) => fields.includes(field)).join(",") : "none");
  } catch {
    // The preview keeps the default when storage is unavailable.
  }
}

export function parseTeamPreviewScenario(value: unknown): TeamPreviewScenario | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const scale = TEAM_PREVIEW_SCALES.find((candidate) => candidate === record.scale);
  const scope = TEAM_SHARING_SCOPES.find((candidate) => candidate === record.scope);
  // "lead" was the group-lead seat before managers had their own access and reach.
  const viewer = TEAM_PREVIEW_VIEWERS.find((candidate) => candidate === (record.viewer === "lead" ? "manager" : record.viewer));
  const policy = TEAM_TRACKING_POLICIES.find((candidate) => candidate === record.policy);
  if (!scale || !scope || !viewer || !policy) return null;
  const sharing = TEAM_SHARING_PRESET_IDS.find((candidate) => candidate === record.sharing);
  const managerAccess = record.managerAccess === "summary" || record.managerAccess === "detail" ? record.managerAccess : undefined;
  const managerReach = TEAM_PREVIEW_MANAGER_REACHES.find((candidate) => candidate === record.managerReach);
  const managerSharing = record.managerSharing === "view" || record.managerSharing === "narrow" ? record.managerSharing : undefined;
  return {
    scale,
    scope,
    viewer,
    policy,
    ...(sharing ? { sharing } : {}),
    ...(typeof record.memberSummary === "boolean" ? { memberSummary: record.memberSummary } : {}),
    ...(managerAccess ? { managerAccess } : {}),
    ...(managerReach ? { managerReach } : {}),
    ...(managerSharing ? { managerSharing } : {}),
  };
}

/** The fixture depends only on these; sharing and the manager's grant are applied on top of it. */
export function teamPreviewScenarioKey(scenario: TeamPreviewScenario): string {
  return [scenario.scale, scenario.scope, scenario.viewer, scenario.policy].join("/");
}

// ── Deterministic randomness ──

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

// ── Names, roles, projects ──

const FIRST_NAMES = [
  "Minji", "Doyun", "Seoyeon", "Jiho", "Hayun", "Junseo", "Yerin", "Taeyang", "Sua", "Eunwoo", "Chaewon", "Siwoo",
  "Aria", "Devin", "Yuki", "Priya", "Sam", "Hana", "Joon", "Lena", "Mateo", "Noor", "Elif", "Kenji", "Amara", "Felix",
  "Ines", "Omar", "Zara", "Theo", "Mina", "Ravi", "Sofia", "Lucas", "Nadia", "Ethan", "Maya", "Hugo", "Leila", "Ivan",
] as const;

const LAST_NAMES = [
  "Park", "Kim", "Lee", "Choi", "Jung", "Kang", "Cho", "Yoon", "Han", "Lim", "Shin", "Seo",
  "Chen", "Ross", "Tanaka", "Nair", "Ortiz", "Novak", "Haddad", "Silva", "Okafor", "Weber", "Rossi", "Larsen",
] as const;

const ROLE_LABELS = [
  "Account Manager", "Sales Ops", "Campaign Lead", "Designer", "Intern", "Engineer", "Product Manager", "Analyst",
  "Recruiter", "Support", "Marketer", "Researcher", "Writer", "QA Engineer", "Data Scientist", "Operations",
] as const;

type ProjectSeed = { readonly id: string; readonly name: string; readonly color: string; readonly description: string };

const PROJECT_SEEDS: readonly ProjectSeed[] = [
  { id: "qa-project-campaign", name: "Q4 Campaign", color: "#5b7a3d", description: "Autumn launch campaign across paid and owned channels." },
  { id: "qa-project-reports", name: "Client reports", color: "#b8923a", description: "Monthly performance reports for retained clients." },
  { id: "qa-project-crm", name: "CRM updates", color: "#5366a3", description: "Pipeline hygiene and account notes in the CRM." },
  { id: "qa-project-proposal", name: "Proposal prep", color: "#a65b3e", description: "Decks and pricing for open proposals." },
  { id: "qa-project-website", name: "Website relaunch", color: "#2f7f78", description: "New marketing site on the design system." },
  { id: "qa-project-hiring", name: "Hiring", color: "#9b5b91", description: "Interviews, scorecards and offers." },
  { id: "qa-project-onboarding", name: "Customer onboarding", color: "#7d8a2a", description: "Kickoff calls and setup guides." },
  { id: "qa-project-platform", name: "Platform migration", color: "#3f6f9f", description: "Moving services to the new platform." },
  { id: "qa-project-analytics", name: "Analytics", color: "#8a6a2f", description: "Dashboards and data quality." },
  { id: "qa-project-support", name: "Support queue", color: "#6d5b8f", description: "Tickets and escalations." },
];

const SCALE_PROJECT_COUNT: Readonly<Record<TeamPreviewScale, number>> = { fresh: 0, trio: 3, team: 4, company: 7, enterprise: 10 };

type GroupSeed = { readonly id: string; readonly name: string; readonly parent: string | null; readonly size: number };

const COMPANY_GROUPS: readonly GroupSeed[] = [
  { id: "qa-group-sales", name: "Sales", parent: null, size: 16 },
  { id: "qa-group-marketing", name: "Marketing", parent: null, size: 12 },
  { id: "qa-group-product", name: "Product", parent: null, size: 14 },
  { id: "qa-group-engineering", name: "Engineering", parent: null, size: 26 },
  { id: "qa-group-cs", name: "Customer Success", parent: null, size: 16 },
  { id: "qa-group-ops", name: "Operations", parent: null, size: 13 },
  // Two people: too few for a total, so its card is a name and a size.
  { id: "qa-group-legal", name: "Legal", parent: null, size: 2 },
];

const ENTERPRISE_GROUPS: readonly GroupSeed[] = [
  { id: "qa-div-consumer", name: "Consumer", parent: null, size: 0 },
  { id: "qa-div-enterprise", name: "Enterprise", parent: null, size: 0 },
  { id: "qa-div-platform", name: "Platform", parent: null, size: 0 },
  { id: "qa-div-corporate", name: "Corporate", parent: null, size: 0 },
  { id: "qa-team-growth", name: "Growth", parent: "qa-div-consumer", size: 46 },
  { id: "qa-team-mobile", name: "Mobile App", parent: "qa-div-consumer", size: 52 },
  { id: "qa-team-web", name: "Web", parent: "qa-div-consumer", size: 36 },
  { id: "qa-team-sales", name: "Sales", parent: "qa-div-enterprise", size: 48 },
  { id: "qa-team-solutions", name: "Solutions", parent: "qa-div-enterprise", size: 30 },
  { id: "qa-team-success", name: "Customer Success", parent: "qa-div-enterprise", size: 38 },
  { id: "qa-team-infra", name: "Infrastructure", parent: "qa-div-platform", size: 44 },
  { id: "qa-team-data", name: "Data", parent: "qa-div-platform", size: 36 },
  { id: "qa-team-security", name: "Security", parent: "qa-div-platform", size: 22 },
  { id: "qa-team-devex", name: "Developer Experience", parent: "qa-div-platform", size: 26 },
  { id: "qa-team-finance", name: "Finance", parent: "qa-div-corporate", size: 42 },
  { id: "qa-team-people", name: "People", parent: "qa-div-corporate", size: 47 },
  { id: "qa-team-legal", name: "Legal", parent: "qa-div-corporate", size: 30 },
  // Two people: too few for a total, so its card is a name and a size.
  { id: "qa-team-audit", name: "Internal Audit", parent: "qa-div-corporate", size: 2 },
];

const SCALE_GROUPS: Readonly<Record<TeamPreviewScale, readonly GroupSeed[]>> = {
  fresh: [],
  trio: [],
  team: [],
  company: COMPANY_GROUPS,
  enterprise: ENTERPRISE_GROUPS,
};

/**
 * Teams that start on their own sharing instead of the organization's, so an
 * organization of many teams previews mixed policies: one shares a work log
 * without focus, one only project totals.
 */
const SCALE_GROUP_SHARING: Readonly<Record<TeamPreviewScale, Readonly<Record<string, TeamSharingPresetId>>>> = {
  fresh: {},
  trio: {},
  team: {},
  company: { "qa-group-engineering": "work_log", "qa-group-legal": "project_totals" },
  enterprise: { "qa-team-security": "project_totals", "qa-team-finance": "work_log" },
};

const SCALE_ORG_NAME: Readonly<Record<TeamPreviewScale, string>> = {
  fresh: "New Team",
  trio: "Design Studio",
  team: "Sales Team",
  company: "Brightline",
  enterprise: "Northwind Group",
};

/** People in a flat team: the viewer and everyone else. */
const FLAT_SCALE_SIZE: Readonly<Record<TeamPreviewScale, number>> = { fresh: 1, trio: 3, team: 8, company: 0, enterprise: 0 };
const SELF_NAME = "Minseok Park";
const PREVIEW_ORG_ID_PREFIX = "qa-preview-";

export function isTeamPreviewOrganizationId(organizationId: string | null | undefined): boolean {
  return typeof organizationId === "string" && organizationId.startsWith(PREVIEW_ORG_ID_PREFIX);
}

export type TeamPreviewFixture = {
  readonly scenario: TeamPreviewScenario;
  readonly team: OwnTeam;
  readonly projects: readonly TeamProject[];
  readonly dataset: TeamFocusDataset;
  readonly roster: readonly TeamMember[];
  readonly invite: TeamInvite;
  /** Days of the week the fixture expects tracking on. */
  readonly expectedWeekdays: readonly number[];
  /** Teams that start on their own sharing combination, by group id. */
  readonly groupSharing: Readonly<Record<string, TeamSharingPresetId>>;
};

export type TeamPreviewFixtureInput = {
  readonly scenario: TeamPreviewScenario;
  /** Logical today (ISO date) and the minute of that day now, so today reads as partial. */
  readonly today: string;
  readonly nowMinuteOfDay: number;
  readonly nowMs: number;
  /** How many days of history to generate before today. */
  readonly historyDays?: number;
};

const DAY_WEIGHT_BY_WEEKDAY: Readonly<Record<number, number>> = { 1: 1.0, 2: 1.08, 3: 0.92, 4: 1.04, 5: 0.74, 6: 0.14, 7: 0.06 };
const WORKDAY_START_MINUTE = 9 * 60;
const WORKDAY_END_MINUTE = 18 * 60 + 30;

export function buildTeamPreviewFixture(input: TeamPreviewFixtureInput): TeamPreviewFixture {
  const { scenario, today, nowMinuteOfDay, nowMs } = input;
  const historyDays = input.historyDays ?? 70;
  const organizationId = PREVIEW_ORG_ID_PREFIX + scenario.scale;
  const groupSeeds = SCALE_GROUPS[scenario.scale];
  const projects: TeamProject[] = PROJECT_SEEDS.slice(0, SCALE_PROJECT_COUNT[scenario.scale]).map((seed): TeamProject => ({
    id: seed.id,
    organization_id: organizationId,
    name: seed.name,
    description: seed.description,
    color: seed.color,
    status: "active" as const,
    anchors: [],
    can_manage: scenario.viewer === "owner",
    created_at: "2026-06-20T09:00:00.000Z",
    updated_at: "2026-07-10T09:00:00.000Z",
  })).concat(groupSeeds.length === 0 ? [] : [{
    id: "qa-project-archived",
    organization_id: organizationId,
    name: "Spring launch",
    description: "Archived once the launch shipped.",
    color: "#9ca3af",
    status: "archived" as const,
    anchors: [],
    can_manage: scenario.viewer === "owner",
    created_at: "2026-03-01T09:00:00.000Z",
    updated_at: "2026-06-01T09:00:00.000Z",
  }]);
  const activeProjectIds = projects.filter((project) => project.status === "active").map((project) => project.id);

  // Groups and where the viewer sits.
  const groups: TeamGroup[] = [];
  const leafGroups = groupSeeds.filter((seed) => seed.size > 0);
  const viewerGroup = leafGroups[0] ?? null;
  // A manager seat is the server's lead role; their reach and access come from their assignment.
  const viewerRole: TeamMembershipRole = scenario.viewer === "owner" ? "owner" : scenario.viewer === "manager" ? "lead" : "member";

  // Members: the viewer first, then everyone else, each with a stable key.
  const members: TeamDirectoryMember[] = [];
  const usedNames = new Set<string>([SELF_NAME]);
  const nameRandom = makeRandom(organizationId + ":names");
  const nextName = (): string => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const name = pick(nameRandom, FIRST_NAMES) + " " + pick(nameRandom, LAST_NAMES);
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    const fallback = "Member " + String(members.length + 1);
    usedNames.add(fallback);
    return fallback;
  };
  const pushMember = (name: string, role: TeamMembershipRole, groupId: string | null, isSelf: boolean, index: number): TeamDirectoryMember => {
    const random = makeRandom(organizationId + ":member:" + String(index));
    const member: TeamDirectoryMember = {
      member_key: "qa-member-" + String(index),
      display_name: name,
      role_label: role === "owner" ? "Owner" : role === "lead" ? "Team Lead" : pick(random, ROLE_LABELS),
      membership_role: role,
      group_id: groupId,
      is_self: isSelf,
      weekly_goal_seconds: random() < 0.6 ? pick(random, [12, 15, 18, 20]) * 3600 : null,
    };
    members.push(member);
    return member;
  };

  let memberIndex = 0;
  pushMember(SELF_NAME, viewerRole, viewerRole === "owner" ? null : viewerGroup?.id ?? null, true, memberIndex++);
  if (groupSeeds.length === 0) {
    while (members.length < FLAT_SCALE_SIZE[scenario.scale]) pushMember(nextName(), "member", null, false, memberIndex++);
  } else {
    // A flat company or a nested enterprise: one lead per leaf group plus its members.
    for (const seed of groupSeeds) {
      const leadMember = seed.size > 0
        ? (viewerRole === "lead" && seed.id === viewerGroup?.id ? members[0]! : pushMember(nextName(), "lead", seed.id, false, memberIndex++))
        : null;
      groups.push({
        id: seed.id,
        organization_id: organizationId,
        parent_group_id: seed.parent,
        name: seed.name,
        lead_display_name: leadMember?.display_name ?? null,
        member_count: 0,
      });
      const alreadyIn = members.filter((member) => member.group_id === seed.id).length;
      for (let count = alreadyIn; count < seed.size; count += 1) pushMember(nextName(), "member", seed.id, false, memberIndex++);
    }
    // An admin viewer besides the owner, so the org level is not one person.
    if (viewerRole !== "owner") pushMember(nextName(), "owner", null, false, memberIndex++);
  }
  // Group counts include nested groups' members.
  const countIn = (groupId: string): number => members.filter((member) => member.group_id === groupId).length
    + groups.filter((group) => group.parent_group_id === groupId).reduce((sum, child) => sum + countIn(child.id), 0);
  const groupsWithCounts = groups.map((group) => ({ ...group, member_count: countIn(group.id) }));

  // Per-member, per-day focus, blocks and project split.
  const focusDays: TeamMemberFocusDay[] = [];
  const projectDays: TeamMemberProjectDay[] = [];
  const presence: TeamMemberPresence[] = [];
  // The fixture always carries the fullest data; the view models hide what the
  // scope withholds, so a scope changed in Team settings previews at once.
  const firstDay = shiftIsoDate(today, -historyDays);
  for (const member of members) {
    const memberRandom = makeRandom(organizationId + ":profile:" + member.member_key);
    const diligence = between(memberRandom, 0.55, 1.3);
    const weights = activeProjectIds.map(() => between(memberRandom, 0.2, 1));
    // Two or three projects dominate each person's week, as on a real team.
    for (let index = 0; index < weights.length; index += 1) if (memberRandom() < 0.55) weights[index]! *= 0.15;
    const unassignedWeight = between(memberRandom, 0.03, 0.14);
    const sparse = memberRandom() < 0.12;
    const trackingNow = memberRandom() < 0.68;

    // A team made a moment ago has nothing shared yet.
    for (let day = firstDay; scenario.scale !== "fresh" && day <= today; day = shiftIsoDate(day, 1)) {
      const weekday = isoWeekday(day);
      const dayRandom = makeRandom(organizationId + ":" + member.member_key + ":" + day);
      const isToday = day === today;
      const untracked = sparse && weekday <= 5 && dayRandom() < 0.4;
      if (untracked) continue;
      const weight = DAY_WEIGHT_BY_WEEKDAY[weekday] ?? 1;
      if (weight < 0.2 && dayRandom() > weight * 2) continue;
      let targetFocusMinutes = 192 * diligence * weight * between(dayRandom, 0.72, 1.28);
      const dayEndMinute = isToday ? Math.min(WORKDAY_END_MINUTE, nowMinuteOfDay) : WORKDAY_END_MINUTE;
      if (isToday) targetFocusMinutes *= Math.max(0, Math.min(1, (nowMinuteOfDay - WORKDAY_START_MINUTE) / (WORKDAY_END_MINUTE - WORKDAY_START_MINUTE)));
      if (targetFocusMinutes < 8) continue;

      // Blocks fill the workday with gaps and a lunch break; the day's focus is their sum.
      const blocks: TeamFocusBlock[] = [];
      let cursor = WORKDAY_START_MINUTE + Math.round(between(dayRandom, 0, 50));
      let remaining = targetFocusMinutes;
      const lunchStart = 12 * 60 + Math.round(between(dayRandom, 0, 40));
      const lunchEnd = lunchStart + Math.round(between(dayRandom, 40, 70));
      // Spread the day's focus across the whole workday instead of front-loading it.
      const spread = Math.max(0.6, (dayEndMinute - cursor) / Math.max(1, targetFocusMinutes * 1.9));
      while (remaining > 10 && cursor < dayEndMinute - 15) {
        if (cursor < lunchEnd && cursor + 20 > lunchStart) cursor = lunchEnd;
        const length = Math.min(Math.round(remaining), Math.round(between(dayRandom, 20, 105)), dayEndMinute - cursor);
        if (length < 10) break;
        const projectRoll = dayRandom();
        let projectId: string | null = null;
        if (projectRoll >= unassignedWeight) {
          const total = weights.reduce((sum, value) => sum + value, 0);
          let threshold = dayRandom() * total;
          for (let index = 0; index < weights.length; index += 1) {
            threshold -= weights[index]!;
            if (threshold <= 0) {
              projectId = activeProjectIds[index] ?? null;
              break;
            }
          }
          if (projectId === null) projectId = activeProjectIds[activeProjectIds.length - 1] ?? null;
        }
        blocks.push({ start_minute: cursor, end_minute: cursor + length, project_id: projectId });
        remaining -= length;
        cursor += length + Math.round(between(dayRandom, 8, 55) * spread);
      }
      if (blocks.length === 0) continue;
      const focusMinutes = blocks.reduce((sum, block) => sum + (block.end_minute - block.start_minute), 0);
      const deepBlocks = blocks.filter((block) => block.end_minute - block.start_minute >= 25);
      const longest = blocks.reduce((best, block) => (block.end_minute - block.start_minute > best.end_minute - best.start_minute ? block : best), blocks[0]!);

      focusDays.push({
        member_key: member.member_key,
        activity_date: day,
        focus_seconds: focusMinutes * 60,
        tracked_seconds: Math.round(focusMinutes * between(dayRandom, 1.4, 2.1)) * 60,
        deep_block_count: deepBlocks.length,
        deep_block_seconds: deepBlocks.reduce((sum, block) => sum + (block.end_minute - block.start_minute), 0) * 60,
        longest_block_seconds: (longest.end_minute - longest.start_minute) * 60,
        longest_block_start_minute: longest.start_minute,
        blocks,
      });
      const secondsByProject = new Map<string | null, number>();
      for (const block of blocks) secondsByProject.set(block.project_id, (secondsByProject.get(block.project_id) ?? 0) + (block.end_minute - block.start_minute) * 60);
      for (const [projectId, seconds] of secondsByProject) {
        projectDays.push({ member_key: member.member_key, organization_project_id: projectId, activity_date: day, seconds });
      }
    }

    const todayWeekday = isoWeekday(today);
    const inWorkHours = todayWeekday <= 5 && nowMinuteOfDay >= WORKDAY_START_MINUTE && nowMinuteOfDay <= WORKDAY_END_MINUTE;
    const seenMinutesAgo = trackingNow && inWorkHours ? between(memberRandom, 1, 8) : between(memberRandom, 25, 600);
    presence.push({
      member_key: member.member_key,
      tracking: trackingNow && inWorkHours,
      last_seen_at: new Date(nowMs - seenMinutesAgo * 60 * 1000).toISOString(),
    });
  }

  const self = members[0]!;
  const team: OwnTeam = {
    organization_id: organizationId,
    organization_name: SCALE_ORG_NAME[scenario.scale],
    member_display_name: self.display_name,
    role_label: self.role_label,
    member_count: members.length,
    updated_at: "2026-10-10T09:00:00.000Z",
    membership_role: viewerRole,
    members_can_invite: true,
    sharing_scope: scenario.scope,
    tracking_policy: scenario.policy,
    recording_schedule: scenario.policy === "managed" ? DEFAULT_TEAM_RECORDING_SCHEDULE : null,
    group_count: groupsWithCounts.length,
    viewer_group_id: self.group_id,
  };

  const roster: TeamMember[] = members.map((member) => ({
    member_key: member.member_key,
    display_name: member.display_name,
    role_label: member.role_label,
    membership_role: member.membership_role,
    joined_at: "2026-06-02T09:00:00.000Z",
    is_self: member.is_self,
  }));

  const invite: TeamInvite = {
    invite_id: "qa-invite-" + scenario.scale,
    organization_id: organizationId,
    organization_name: team.organization_name,
    invite_code: "DRFT-K4M2-9QXZ",
    invite_url: "/team-invite?code=DRFT-K4M2-9QXZ",
    role_label: "Member",
    status: "pending",
    expires_at: "2026-12-31T00:00:00.000Z",
    created_at: "2026-10-10T09:00:00.000Z",
    updated_at: "2026-10-10T09:00:00.000Z",
  };

  return {
    scenario,
    team,
    projects,
    dataset: { members, groups: groupsWithCounts, focusDays, projectDays, presence },
    roster,
    invite,
    expectedWeekdays: team.recording_schedule?.days ?? DEFAULT_TEAM_RECORDING_SCHEDULE.days,
    groupSharing: SCALE_GROUP_SHARING[scenario.scale],
  };
}

