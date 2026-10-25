import type { TeamRecordingSchedule, TeamSharingScope } from "./teamSharingScope";
import type { TeamGroup } from "./teamTypes";

/**
 * What a team shares, chosen item by item by the team admin. Project time,
 * work titles and focus each get their own level, so a team can share a work
 * timeline without focus, or focus totals without work titles. No level ever
 * includes app, site or window history, drift time or personal notes: those
 * stay on the member's device (AGENTS.md product boundary).
 *
 * Project time is every recorded minute assigned to a team project, whether or
 * not it counted as focus, so project and focus figures are independent and
 * their difference never stands for drift.
 */
export const TEAM_PROJECT_SHARE_LEVELS = ["off", "team", "member_daily", "hourly"] as const;
export type TeamProjectShareLevel = (typeof TEAM_PROJECT_SHARE_LEVELS)[number];

/** Work titles are names, not numbers, so they have no team-total level. */
export const TEAM_TASK_SHARE_LEVELS = ["off", "member_daily", "hourly"] as const;
export type TeamTaskShareLevel = (typeof TEAM_TASK_SHARE_LEVELS)[number];

export const TEAM_FOCUS_SHARE_LEVELS = ["off", "team", "member_daily", "hourly"] as const;
export type TeamFocusShareLevel = (typeof TEAM_FOCUS_SHARE_LEVELS)[number];

export type TeamShareLevel = TeamProjectShareLevel;

export const TEAM_SHARE_FIELDS = ["projects", "tasks", "focus"] as const;
export type TeamShareField = (typeof TEAM_SHARE_FIELDS)[number];

export const TEAM_SHARE_LEVELS_BY_FIELD: Readonly<Record<TeamShareField, readonly TeamShareLevel[]>> = {
  projects: TEAM_PROJECT_SHARE_LEVELS,
  tasks: TEAM_TASK_SHARE_LEVELS,
  focus: TEAM_FOCUS_SHARE_LEVELS,
};

export type TeamSharingPolicy = {
  readonly projects: TeamProjectShareLevel;
  readonly tasks: TeamTaskShareLevel;
  readonly focus: TeamFocusShareLevel;
  /** Whether members without a manager role see their own team's totals; never other people's figures. */
  readonly memberSummary: boolean;
};

/** A policy being chosen. Every item starts unset: the product has no default yet. */
export type TeamSharingPolicyDraft = {
  readonly projects: TeamProjectShareLevel | null;
  readonly tasks: TeamTaskShareLevel | null;
  readonly focus: TeamFocusShareLevel | null;
  readonly memberSummary: boolean | null;
};

export const EMPTY_TEAM_SHARING_DRAFT: TeamSharingPolicyDraft = { projects: null, tasks: null, focus: null, memberSummary: null };

export function draftFromPolicy(policy: TeamSharingPolicy): TeamSharingPolicyDraft {
  return { ...policy };
}

export function completeTeamSharingPolicy(draft: TeamSharingPolicyDraft): TeamSharingPolicy | null {
  if (draft.projects === null || draft.tasks === null || draft.focus === null || draft.memberSummary === null) return null;
  return { projects: draft.projects, tasks: draft.tasks, focus: draft.focus, memberSummary: draft.memberSummary };
}

const LEVEL_RANK: Readonly<Record<TeamShareLevel, number>> = { off: 0, team: 1, member_daily: 2, hourly: 3 };

export function shareLevelRank(level: TeamShareLevel | null | undefined): number {
  return level ? LEVEL_RANK[level] : 0;
}

/** Shortcuts for common combinations; picking one sets the three items, never the team-summary choice. */
export const TEAM_SHARING_PRESET_IDS = ["project_totals", "work_log", "work_and_focus", "full_timeline"] as const;
export type TeamSharingPresetId = (typeof TEAM_SHARING_PRESET_IDS)[number];

export type TeamSharingPreset = {
  readonly id: TeamSharingPresetId;
  readonly projects: TeamProjectShareLevel;
  readonly tasks: TeamTaskShareLevel;
  readonly focus: TeamFocusShareLevel;
};

export const TEAM_SHARING_PRESETS: readonly TeamSharingPreset[] = [
  { id: "project_totals", projects: "team", tasks: "off", focus: "off" },
  { id: "work_log", projects: "member_daily", tasks: "member_daily", focus: "off" },
  { id: "work_and_focus", projects: "member_daily", tasks: "member_daily", focus: "member_daily" },
  { id: "full_timeline", projects: "hourly", tasks: "hourly", focus: "hourly" },
];

export function matchingSharingPreset(draft: TeamSharingPolicyDraft): TeamSharingPresetId | null {
  const match = TEAM_SHARING_PRESETS.find((preset) => preset.projects === draft.projects && preset.tasks === draft.tasks && preset.focus === draft.focus);
  return match?.id ?? null;
}

export function applySharingPreset(draft: TeamSharingPolicyDraft, presetId: TeamSharingPresetId): TeamSharingPolicyDraft {
  const preset = TEAM_SHARING_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return draft;
  return { ...draft, projects: preset.projects, tasks: preset.tasks, focus: preset.focus };
}

/** A combination as a whole policy, for a preview scenario that starts from it. */
export function policyForPreset(presetId: TeamSharingPresetId, memberSummary: boolean): TeamSharingPolicy {
  const preset = TEAM_SHARING_PRESETS.find((candidate) => candidate.id === presetId) ?? TEAM_SHARING_PRESETS[0]!;
  return { projects: preset.projects, tasks: preset.tasks, focus: preset.focus, memberSummary };
}

/**
 * The short form of the editor (owner decision 2026-10-20): one choice for the
 * work record (project time and work titles move together) and one switch for
 * focus, which follows the work record's detail when on. A new team starts on
 * the most detailed work record, focus off and members seeing their own records.
 */
export const TEAM_WORK_SHARE_LEVELS = ["hourly", "member_daily", "team"] as const;
export type TeamWorkShareLevel = (typeof TEAM_WORK_SHARE_LEVELS)[number];

export const DEFAULT_TEAM_SHARING_DRAFT: TeamSharingPolicyDraft = { projects: "hourly", tasks: "hourly", focus: "off", memberSummary: false };

const WORK_LEVEL_FIELDS: Readonly<Record<TeamWorkShareLevel, { readonly projects: TeamProjectShareLevel; readonly tasks: TeamTaskShareLevel }>> = {
  hourly: { projects: "hourly", tasks: "hourly" },
  member_daily: { projects: "member_daily", tasks: "member_daily" },
  team: { projects: "team", tasks: "off" },
};

/** The work-record choice a draft amounts to; "custom" for a combination the short form cannot show. */
export function workShareLevelOf(draft: TeamSharingPolicyDraft): TeamWorkShareLevel | "custom" | null {
  if (draft.projects === null && draft.tasks === null) return null;
  const level = TEAM_WORK_SHARE_LEVELS.find((candidate) => WORK_LEVEL_FIELDS[candidate].projects === draft.projects && WORK_LEVEL_FIELDS[candidate].tasks === draft.tasks);
  if (!level) return "custom";
  // Focus that is on must follow the work record, or the short form cannot show it.
  if (draft.focus !== null && draft.focus !== "off" && draft.focus !== level) return "custom";
  return level;
}

export function focusSharedIn(draft: TeamSharingPolicyDraft): boolean | null {
  return draft.focus === null ? null : draft.focus !== "off";
}

/** Focus at the work record's detail, held under a ceiling's focus level. */
function followingFocus(level: TeamWorkShareLevel, ceiling: TeamSharingPolicy | null): TeamFocusShareLevel {
  if (ceiling && shareLevelRank(ceiling.focus) < shareLevelRank(level)) return ceiling.focus;
  return level;
}

export function withWorkShareLevel(draft: TeamSharingPolicyDraft, level: TeamWorkShareLevel, ceiling: TeamSharingPolicy | null = null): TeamSharingPolicyDraft {
  const focusOn = draft.focus !== null && draft.focus !== "off";
  return { ...draft, ...WORK_LEVEL_FIELDS[level], focus: focusOn ? followingFocus(level, ceiling) : draft.focus ?? "off" };
}

export function withFocusShared(draft: TeamSharingPolicyDraft, shared: boolean, ceiling: TeamSharingPolicy | null = null): TeamSharingPolicyDraft {
  if (!shared) return { ...draft, focus: "off" };
  const level = workShareLevelOf(draft);
  const work: TeamWorkShareLevel = level === null || level === "custom" ? "member_daily" : level;
  return { ...draft, focus: followingFocus(work, ceiling) };
}

/** Whether a ceiling allows this work-record choice. */
export function workShareLevelAllowed(level: TeamWorkShareLevel, ceiling: TeamSharingPolicy | null): boolean {
  if (!ceiling) return true;
  const fields = WORK_LEVEL_FIELDS[level];
  return shareLevelRank(fields.projects) <= shareLevelRank(ceiling.projects) && shareLevelRank(fields.tasks) <= shareLevelRank(ceiling.tasks);
}

export type TeamSharingItem = TeamShareField | "memberSummary";

export type TeamSharingChange = {
  /** Items that now share more: applied to records from the change on, never to earlier private records. */
  readonly widened: readonly TeamSharingItem[];
  /** Items that now share less: hidden at once, including what was shared before. */
  readonly narrowed: readonly TeamSharingItem[];
};

export function compareTeamSharingPolicies(before: TeamSharingPolicy, after: TeamSharingPolicy): TeamSharingChange {
  const widened: TeamSharingItem[] = [];
  const narrowed: TeamSharingItem[] = [];
  for (const field of TEAM_SHARE_FIELDS) {
    const delta = shareLevelRank(after[field]) - shareLevelRank(before[field]);
    if (delta > 0) widened.push(field);
    else if (delta < 0) narrowed.push(field);
  }
  if (after.memberSummary !== before.memberSummary) (after.memberSummary ? widened : narrowed).push("memberSummary");
  return { widened, narrowed };
}

/**
 * What a person's rows may carry. A link between items follows the lower of
 * the two levels, so a timeline never shows a project name the team shares
 * only as a total, and a work title never says whether it was focus unless
 * focus is shared by time too.
 */
export type TeamSharingVisibility = {
  readonly teamProjects: boolean;
  readonly teamFocus: boolean;
  readonly memberProjects: boolean;
  readonly memberTasks: boolean;
  readonly memberFocus: boolean;
  readonly timelineProjects: boolean;
  readonly timelineTasks: boolean;
  readonly timelineFocus: boolean;
  /** Anything about one person beyond their own view. */
  readonly personal: boolean;
  /** Anything placed at a time of day. */
  readonly timeline: boolean;
};

export function teamSharingVisibility(policy: TeamSharingPolicyDraft): TeamSharingVisibility {
  const projects = shareLevelRank(policy.projects);
  const tasks = shareLevelRank(policy.tasks);
  const focus = shareLevelRank(policy.focus);
  const visibility = {
    teamProjects: projects >= 1,
    teamFocus: focus >= 1,
    memberProjects: projects >= 2,
    memberTasks: tasks >= 2,
    memberFocus: focus >= 2,
    timelineProjects: projects >= 3,
    timelineTasks: tasks >= 3,
    timelineFocus: focus >= 3,
  };
  return {
    ...visibility,
    personal: visibility.memberProjects || visibility.memberTasks || visibility.memberFocus,
    timeline: visibility.timelineProjects || visibility.timelineTasks || visibility.timelineFocus,
  };
}

/** The single scope the existing dashboards read; the focus item decides it. */
export function legacyScopeForPolicy(policy: TeamSharingPolicy): TeamSharingScope {
  if (policy.focus === "hourly") return "focus_blocks";
  if (policy.focus === "member_daily") return "member_focus";
  if (policy.focus === "team") return "team_focus";
  return "projects";
}

/** A Dev preview scenario's single scope, read as the per-item policy it previews. */
export function policyForLegacyScope(scope: TeamSharingScope): TeamSharingPolicy {
  if (scope === "focus_blocks") return { projects: "hourly", tasks: "hourly", focus: "hourly", memberSummary: true };
  if (scope === "member_focus") return { projects: "member_daily", tasks: "member_daily", focus: "member_daily", memberSummary: true };
  if (scope === "team_focus") return { projects: "member_daily", tasks: "off", focus: "team", memberSummary: true };
  return { projects: "member_daily", tasks: "off", focus: "off", memberSummary: true };
}

/**
 * The hours a team records for sharing. Only records inside them are shared,
 * and nothing from before someone joined is ever shared.
 */
export type TeamSharingWindow = TeamRecordingSchedule;

export function isValidSharingWindow(window: TeamSharingWindow): boolean {
  return window.days.length > 0 && window.start_minute < window.end_minute;
}

/** A manager sees the teams assigned to them; whether they see individuals is a separate grant. */
export type TeamManagerAccess = "summary" | "detail";

/**
 * Candidate E: whether an organization admin lets this manager narrow their
 * teams' sharing, as Rize keeps a team Admin's settings apart from a Manager's
 * reading and approving.
 */
export type TeamManagerSharing = "view" | "narrow";

export type TeamManagerAssignment = {
  readonly member_key: string;
  readonly display_name: string;
  /** Groups they manage; empty for a team without groups, where they manage the whole team. */
  readonly group_ids: readonly string[];
  readonly access: TeamManagerAccess;
  readonly sharing?: TeamManagerSharing;
};

export type TeamManagerDraft = {
  readonly member_key: string | null;
  readonly group_ids: readonly string[];
  readonly access: TeamManagerAccess | null;
  readonly sharing?: TeamManagerSharing;
};

export function isManagerDraftComplete(draft: TeamManagerDraft, hasGroups: boolean): boolean {
  return draft.member_key !== null && draft.access !== null && (!hasGroups || draft.group_ids.length > 0);
}

/**
 * Teams that share differently from the organization's default, by group id.
 * A team without an entry follows the nearest division that has one, then
 * the organization's default.
 */
export type TeamGroupSharingPolicies = Readonly<Record<string, TeamSharingPolicy>>;

/** The policy a team actually shares on: its own, its division's, or the organization's default. */
export function sharingPolicyForGroup(
  defaultPolicy: TeamSharingPolicy,
  groupPolicies: TeamGroupSharingPolicies | null | undefined,
  groups: readonly TeamGroup[],
  groupId: string | null,
): TeamSharingPolicy {
  let current = groupId;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const own = groupPolicies?.[current];
    if (own) return own;
    current = groups.find((group) => group.id === current)?.parent_group_id ?? null;
  }
  return defaultPolicy;
}

/** Whether this team has its own entry, as opposed to following a division or the default. */
export function groupHasOwnSharingPolicy(groupPolicies: TeamGroupSharingPolicies | null | undefined, groupId: string): boolean {
  return Boolean(groupPolicies?.[groupId]);
}

/**
 * What a view over several teams may show. Teams can share on different
 * policies, so a view that adds teams together (the organization, a division,
 * a manager's several teams) carries only what every team shares as a total:
 * project time. Focus and anything about one person appear inside one team,
 * on that team's policy. Teams that keep project time to themselves stay out
 * of the sums (see teamsWithoutSharedProjects).
 */
export function sharingPolicyAcrossTeams(defaultPolicy: TeamSharingPolicy): TeamSharingPolicy {
  return { projects: "team", tasks: "off", focus: "off", memberSummary: defaultPolicy.memberSummary };
}

/** Leaf teams whose policy shares no project time; their records leave every sum across teams. */
export function teamsWithoutSharedProjects(
  defaultPolicy: TeamSharingPolicy,
  groupPolicies: TeamGroupSharingPolicies | null | undefined,
  groups: readonly TeamGroup[],
): readonly string[] {
  return groups
    .filter((group) => !groups.some((child) => child.parent_group_id === group.id))
    .filter((group) => sharingPolicyForGroup(defaultPolicy, groupPolicies, groups, group.id).projects === "off")
    .map((group) => group.id);
}

/** The combination a policy matches, for a one-word label; null when its items were picked one by one. */
export function sharingPresetForPolicy(policy: TeamSharingPolicy): TeamSharingPresetId | null {
  return matchingSharingPreset(policy);
}

/** Whether a level lies above a ceiling's level for the same item. */
export function levelAboveCeiling(level: TeamShareLevel, ceiling: TeamShareLevel): boolean {
  return shareLevelRank(level) > shareLevelRank(ceiling);
}

/** Whether a policy stays within a ceiling on every item and on the members' team summary. */
export function policyWithinCeiling(policy: TeamSharingPolicyDraft, ceiling: TeamSharingPolicy): boolean {
  return TEAM_SHARE_FIELDS.every((field) => policy[field] === null || !levelAboveCeiling(policy[field]!, ceiling[field]))
    && !(policy.memberSummary === true && !ceiling.memberSummary);
}

/** Where several teams are added together, the teams that share focus and the ones left out. */
export function teamsByFocusSharing(
  defaultPolicy: TeamSharingPolicy,
  groupPolicies: TeamGroupSharingPolicies | null | undefined,
  groups: readonly TeamGroup[],
  teamIds: readonly string[],
): { readonly sharing: readonly string[]; readonly withheld: readonly string[] } {
  const sharing: string[] = [];
  const withheld: string[] = [];
  for (const id of teamIds) (sharingPolicyForGroup(defaultPolicy, groupPolicies, groups, id).focus === "off" ? withheld : sharing).push(id);
  return { sharing, withheld };
}
