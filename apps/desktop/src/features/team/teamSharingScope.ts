/**
 * What a team shares upward, chosen by the team owner. Every level excludes
 * app, site, window and title history and the member's drift and neutral time:
 * those stay on the member's own device at every scope (AGENTS.md product
 * boundary). Levels are ordered; a higher level includes every lower one.
 */
export const TEAM_SHARING_SCOPES = ["projects", "team_focus", "member_focus", "focus_blocks"] as const;
export type TeamSharingScope = typeof TEAM_SHARING_SCOPES[number];

export const DEFAULT_TEAM_SHARING_SCOPE: TeamSharingScope = "member_focus";

const SCOPE_RANK: Readonly<Record<TeamSharingScope, number>> = {
  projects: 0,
  team_focus: 1,
  member_focus: 2,
  focus_blocks: 3,
};

export function parseTeamSharingScope(value: unknown): TeamSharingScope | null {
  return typeof value === "string" && (TEAM_SHARING_SCOPES as readonly string[]).includes(value)
    ? value as TeamSharingScope
    : null;
}

/** Whether `scope` shares at least what `needed` shares. */
export function scopeIncludes(scope: TeamSharingScope | null | undefined, needed: TeamSharingScope): boolean {
  if (!scope) return false;
  return SCOPE_RANK[scope] >= SCOPE_RANK[needed];
}

/** The team's focus seconds are visible as a pooled total (never per member). */
export function scopeSharesTeamFocus(scope: TeamSharingScope | null | undefined): boolean {
  return scopeIncludes(scope, "team_focus");
}

/** Each member's own focus time, deep focus blocks and tracked days are visible. */
export function scopeSharesMemberFocus(scope: TeamSharingScope | null | undefined): boolean {
  return scopeIncludes(scope, "member_focus");
}

/** Each member's focus blocks within the day (start, end, project) are visible. */
export function scopeSharesFocusBlocks(scope: TeamSharingScope | null | undefined): boolean {
  return scopeIncludes(scope, "focus_blocks");
}

/**
 * Whether members can pause tracking. Under `managed`, pausing is unavailable
 * on every member device and the team may set a recording schedule; outside
 * the schedule nothing is recorded for the team.
 */
export const TEAM_TRACKING_POLICIES = ["free", "managed"] as const;
export type TeamTrackingPolicy = typeof TEAM_TRACKING_POLICIES[number];

export function parseTeamTrackingPolicy(value: unknown): TeamTrackingPolicy | null {
  return typeof value === "string" && (TEAM_TRACKING_POLICIES as readonly string[]).includes(value)
    ? value as TeamTrackingPolicy
    : null;
}

/** ISO weekday numbers (1 = Monday … 7 = Sunday) and minutes from midnight. */
export type TeamRecordingSchedule = {
  readonly days: readonly number[];
  readonly start_minute: number;
  readonly end_minute: number;
  readonly timezone: string;
};

export const DEFAULT_TEAM_RECORDING_SCHEDULE: TeamRecordingSchedule = {
  days: [1, 2, 3, 4, 5],
  start_minute: 9 * 60,
  end_minute: 18 * 60,
  timezone: "Asia/Seoul",
};

/** A schedule's timezone when each member's hours follow their own computer's clock (a Dev preview candidate). */
export const TEAM_LOCAL_TIMEZONE = "local";

/** This computer's time zone, where a new team's hours start; Seoul when it cannot be read. */
export function computerTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone !== TEAM_LOCAL_TIMEZONE ? zone : DEFAULT_TEAM_RECORDING_SCHEDULE.timezone;
  } catch {
    return DEFAULT_TEAM_RECORDING_SCHEDULE.timezone;
  }
}

/** A new or never-saved team's hours: weekdays 09:00-18:00 on the clock of the computer setting them up. */
export function defaultTeamRecordingSchedule(): TeamRecordingSchedule {
  return { ...DEFAULT_TEAM_RECORDING_SCHEDULE, timezone: computerTimeZone() };
}

/** A line of what each scope shares, as translation keys for the consent and settings surfaces. */
export type TeamScopeDescription = {
  readonly scope: TeamSharingScope;
  readonly titleKey: TeamScopeTranslationKey;
  readonly bodyKey: TeamScopeTranslationKey;
  readonly sharedKeys: readonly TeamScopeTranslationKey[];
};

export type TeamScopeTranslationKey =
  | "team.scope.projects.title"
  | "team.scope.projects.body"
  | "team.scope.teamFocus.title"
  | "team.scope.teamFocus.body"
  | "team.scope.memberFocus.title"
  | "team.scope.memberFocus.body"
  | "team.scope.focusBlocks.title"
  | "team.scope.focusBlocks.body"
  | "team.scope.shares.projectTotals"
  | "team.scope.shares.projectSplit"
  | "team.scope.shares.teamFocusTotal"
  | "team.scope.shares.memberFocus"
  | "team.scope.shares.deepBlocks"
  | "team.scope.shares.focusBlocks";

export const TEAM_SCOPE_DESCRIPTIONS: readonly TeamScopeDescription[] = [
  {
    scope: "projects",
    titleKey: "team.scope.projects.title",
    bodyKey: "team.scope.projects.body",
    sharedKeys: ["team.scope.shares.projectTotals", "team.scope.shares.projectSplit"],
  },
  {
    scope: "team_focus",
    titleKey: "team.scope.teamFocus.title",
    bodyKey: "team.scope.teamFocus.body",
    sharedKeys: ["team.scope.shares.projectTotals", "team.scope.shares.projectSplit", "team.scope.shares.teamFocusTotal"],
  },
  {
    scope: "member_focus",
    titleKey: "team.scope.memberFocus.title",
    bodyKey: "team.scope.memberFocus.body",
    sharedKeys: [
      "team.scope.shares.projectTotals",
      "team.scope.shares.projectSplit",
      "team.scope.shares.teamFocusTotal",
      "team.scope.shares.memberFocus",
      "team.scope.shares.deepBlocks",
    ],
  },
  {
    scope: "focus_blocks",
    titleKey: "team.scope.focusBlocks.title",
    bodyKey: "team.scope.focusBlocks.body",
    sharedKeys: [
      "team.scope.shares.projectTotals",
      "team.scope.shares.projectSplit",
      "team.scope.shares.teamFocusTotal",
      "team.scope.shares.memberFocus",
      "team.scope.shares.deepBlocks",
      "team.scope.shares.focusBlocks",
    ],
  },
];

/** What stays on the member's device at every scope; shown beside each level. */
export const TEAM_SCOPE_PRIVATE_KEYS = [
  "team.scope.private.drift",
  "team.scope.private.apps",
  "team.scope.private.details",
] as const;

