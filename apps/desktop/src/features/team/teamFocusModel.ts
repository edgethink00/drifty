import { shiftIsoDate } from "@drifty/domain";

import type { TeamSharingScope, TeamTrackingPolicy } from "./teamSharingScope";
import { scopeSharesFocusBlocks, scopeSharesMemberFocus, scopeSharesTeamFocus } from "./teamSharingScope";
import type {
  TeamDirectoryMember,
  TeamFocusBlock,
  TeamGroup,
  TeamMemberFocusDay,
  TeamMemberPresence,
  TeamMemberProjectDay,
  TeamMembershipRole,
  TeamProject,
} from "./teamTypes";

/**
 * Pure view models for the focus dashboards. Every number here comes from
 * per-member, per-day rows the server already minimized; the builders only
 * sum, compare and sort. The caller decides which members a viewer may see.
 */

export type TeamWindow = { readonly start_date: string; readonly end_date: string };

export type TeamFocusDataset = {
  readonly members: readonly TeamDirectoryMember[];
  readonly groups: readonly TeamGroup[];
  readonly focusDays: readonly TeamMemberFocusDay[];
  readonly projectDays: readonly TeamMemberProjectDay[];
  readonly presence: readonly TeamMemberPresence[];
};

export type TeamOverviewContext = {
  readonly scope: TeamSharingScope;
  readonly policy: TeamTrackingPolicy;
  readonly window: TeamWindow;
  /** Logical today; days after it are future days of the window. */
  readonly today: string;
  readonly nowMs: number;
  /** The container: null for the whole organization, else a group and its descendants. */
  readonly groupId: string | null;
  readonly projects: readonly TeamProject[];
  readonly viewerRole: TeamMembershipRole;
  /** Days of the week the team expects tracking on (ISO 1–7); weekdays by default. */
  readonly expectedWeekdays: readonly number[];
  /** The team's daily focus goal per member, for the average's progress bar. */
  readonly dailyGoalSeconds: number;
  /** List every member of the container as a card, instead of its groups plus direct members. */
  readonly flattenGroups?: boolean;
  /** The most days a window spans; screens keep two months, an export up to a year. */
  readonly dayLimit?: number;
};

export type TeamDayPoint = {
  readonly day: string;
  readonly seconds: number;
  readonly isToday: boolean;
  readonly isFuture: boolean;
};

export type TeamProjectShare = {
  readonly projectId: string | null;
  readonly name: string | null;
  readonly color: string | null;
  readonly seconds: number;
};

/** One member's one day as the rhythm grid draws it: focus seconds, blocks (at focus_blocks) and the project split. */
export type TeamMemberDayCell = TeamDayPoint & {
  readonly tracked: boolean;
  readonly expected: boolean;
  readonly blocks: readonly TeamFocusBlock[] | null;
  readonly shares: readonly TeamProjectShare[];
};

export type TeamMemberCardModel = {
  readonly member: TeamDirectoryMember;
  readonly focusSeconds: number;
  readonly previousFocusSeconds: number;
  readonly deltaPct: number | null;
  readonly days: readonly TeamMemberDayCell[];
  readonly trackedDays: number;
  readonly expectedDays: number;
  /** Fewer tracked days than expected so far; the card says so instead of ranking low. */
  readonly sparse: boolean;
  readonly projects: readonly TeamProjectShare[];
  readonly topProject: TeamProjectShare | null;
  readonly moreProjects: number;
  readonly deepBlockCount: number;
  /** Null when presence is not shown (free policy or a member viewer). */
  readonly tracking: boolean | null;
};

export type TeamGroupCardModel = {
  readonly group: TeamGroup;
  readonly memberCount: number;
  readonly sharingMemberCount: number;
  /** Time on the team's own projects; unassigned time is not a project and stays out. */
  readonly projectSeconds: number;
  /** The group's projects, biggest first, for the share bar. */
  readonly projectShares: readonly TeamProjectShare[];
  readonly trackingCount: number | null;
  readonly childGroupCount: number;
};

export type TeamOverviewModel = {
  readonly memberCount: number;
  readonly sharingMemberCount: number;
  readonly teamFocusSeconds: number;
  readonly previousTeamFocusSeconds: number;
  readonly deltaPct: number | null;
  readonly avgPerMemberPerDaySeconds: number;
  readonly goalPct: number;
  readonly deepBlockCount: number;
  readonly avgDeepBlockSeconds: number;
  readonly trackingNow: { readonly count: number; readonly total: number; readonly members: readonly TeamDirectoryMember[] } | null;
  readonly focusByDay: readonly TeamDayPoint[];
  /** The container's focus per day split by project, for the stacked day chart. */
  readonly focusByDayProject: readonly { readonly day: string; readonly shares: readonly TeamProjectShare[] }[];
  readonly focusByProject: readonly TeamProjectShare[];
  readonly memberCards: readonly TeamMemberCardModel[];
  readonly groupCards: readonly TeamGroupCardModel[];
  readonly elapsedExpectedDays: number;
  /** Expected tracking days across the container's members so far, and how many were tracked. */
  readonly trackedPersonDays: number;
  readonly expectedPersonDays: number;
  readonly memberFocusVisible: boolean;
  readonly teamFocusVisible: boolean;
};

export type TeamMemberDayRow = {
  readonly day: string;
  readonly isToday: boolean;
  readonly isFuture: boolean;
  /** A day the team expects tracking on (its recording schedule); weekends are not. */
  readonly expected: boolean;
  readonly focusSeconds: number;
  readonly tracked: boolean;
  readonly blocks: readonly TeamFocusBlock[] | null;
  /** The day's project split, so the day plot can stack by project like the team's. */
  readonly shares: readonly TeamProjectShare[];
};

export type TeamMemberWeekPoint = {
  readonly startDay: string;
  readonly endDay: string;
  readonly memberSeconds: number;
  readonly teamAvgSeconds: number;
  readonly isCurrent: boolean;
  /** This person's time on team projects in the window, by project. */
  readonly shares: readonly TeamProjectShare[];
};

export type TeamMemberDetailModel = {
  readonly member: TeamDirectoryMember;
  readonly focusSeconds: number;
  readonly deltaPct: number | null;
  readonly mainProject: TeamProjectShare | null;
  readonly mainProjectPct: number;
  readonly deepBlockCount: number;
  readonly longestBlockSeconds: number;
  readonly longestBlockDay: string | null;
  readonly longestBlockStartMinute: number | null;
  readonly dayRows: readonly TeamMemberDayRow[];
  readonly projects: readonly TeamProjectShare[];
  /** The previous window's project split, for "what changed". */
  readonly previousProjects: readonly TeamProjectShare[];
  readonly lastWindows: readonly TeamMemberWeekPoint[];
  readonly tracking: boolean | null;
  /** The scope shares this member's own focus time (member_focus and up). */
  readonly focusVisible: boolean;
  readonly blocksVisible: boolean;
};

export const DEEP_FOCUS_BLOCK_MIN_SECONDS = 25 * 60;
/** A device that has not checked in for this long reads as offline. */
export const PRESENCE_FRESH_MS = 10 * 60 * 1000;
export function listWindowDays(window: TeamWindow, limit = 62): string[] {
  const days: string[] = [];
  for (let day = window.start_date; day <= window.end_date; day = shiftIsoDate(day, 1)) {
    days.push(day);
    if (days.length >= limit) break;
  }
  return days;
}

export function windowDayCount(window: TeamWindow, limit = 62): number {
  return listWindowDays(window, limit).length;
}

export function previousWindow(window: TeamWindow, limit = 62): TeamWindow {
  const length = windowDayCount(window, limit);
  return { start_date: shiftIsoDate(window.start_date, -length), end_date: shiftIsoDate(window.start_date, -1) };
}

export function isoWeekday(day: string): number {
  const date = new Date(day + "T00:00:00Z");
  const utcDay = date.getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/** Ids of the group and every group under it. */
export function groupSubtreeIds(groups: readonly TeamGroup[], groupId: string): ReadonlySet<string> {
  const ids = new Set<string>([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const group of groups) {
      if (group.parent_group_id && ids.has(group.parent_group_id) && !ids.has(group.id)) {
        ids.add(group.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function membersInContainer(
  members: readonly TeamDirectoryMember[],
  groups: readonly TeamGroup[],
  groupId: string | null,
): readonly TeamDirectoryMember[] {
  if (groupId === null) return members;
  const ids = groupSubtreeIds(groups, groupId);
  return members.filter((member) => member.group_id !== null && ids.has(member.group_id));
}

export function childGroups(groups: readonly TeamGroup[], groupId: string | null): readonly TeamGroup[] {
  return groups.filter((group) => group.parent_group_id === groupId);
}

/**
 * The part of the organization one seat may see: the given groups with
 * everything under them, and only those groups' people and records. Groups
 * whose parent falls outside become top-level, so a manager of three teams in
 * different divisions starts from those three. Null or no groups keeps it all.
 */
export function scopeDatasetToGroups(dataset: TeamFocusDataset, groupIds: readonly string[] | null): TeamFocusDataset {
  if (!groupIds || groupIds.length === 0 || dataset.groups.length === 0) return dataset;
  const allowed = new Set<string>();
  for (const id of groupIds) for (const inner of groupSubtreeIds(dataset.groups, id)) allowed.add(inner);
  const groups = dataset.groups
    .filter((group) => allowed.has(group.id))
    .map((group) => (group.parent_group_id && !allowed.has(group.parent_group_id) ? { ...group, parent_group_id: null } : group));
  const members = dataset.members.filter((member) => member.group_id !== null && allowed.has(member.group_id));
  const keys = new Set(members.map((member) => member.member_key));
  return {
    members,
    groups,
    focusDays: dataset.focusDays.filter((row) => keys.has(row.member_key)),
    projectDays: dataset.projectDays.filter((row) => keys.has(row.member_key)),
    presence: dataset.presence.filter((row) => keys.has(row.member_key)),
  };
}

/** The path of groups from the top down to the given group. */
export function groupPath(groups: readonly TeamGroup[], groupId: string | null): readonly TeamGroup[] {
  const path: TeamGroup[] = [];
  let current = groupId;
  while (current !== null) {
    const group = groups.find((candidate) => candidate.id === current);
    if (!group) break;
    path.unshift(group);
    current = group.parent_group_id;
  }
  return path;
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function projectShare(projects: readonly TeamProject[], projectId: string | null, seconds: number): TeamProjectShare {
  const project = projectId ? projects.find((candidate) => candidate.id === projectId) ?? null : null;
  return { projectId, name: project?.name ?? null, color: project?.color ?? null, seconds };
}

function sumProjectShares(
  rows: readonly TeamMemberProjectDay[],
  projects: readonly TeamProject[],
): TeamProjectShare[] {
  const byProject = new Map<string | null, number>();
  for (const row of rows) {
    byProject.set(row.organization_project_id, (byProject.get(row.organization_project_id) ?? 0) + row.seconds);
  }
  return [...byProject.entries()]
    .map(([projectId, seconds]) => projectShare(projects, projectId, seconds))
    .filter((share) => share.seconds > 0)
    .sort((left, right) => {
      // Unassigned time sorts last regardless of size, as in the design.
      if (left.projectId === null) return 1;
      if (right.projectId === null) return -1;
      return right.seconds - left.seconds;
    });
}

/**
 * Unassigned time is focus outside the team's projects, so it is shared only
 * where the scope shares that focus: pooled for the team from team_focus, and
 * per person from member_focus. Below that, project rows carry team projects only.
 */
function sharedProjectRows<T extends { readonly organization_project_id: string | null }>(rows: readonly T[], focusShared: boolean): readonly T[] {
  return focusShared ? rows : rows.filter((row) => row.organization_project_id !== null);
}

function dayPoints(
  days: readonly string[],
  secondsByDay: ReadonlyMap<string, number>,
  today: string,
): TeamDayPoint[] {
  return days.map((day) => ({
    day,
    seconds: secondsByDay.get(day) ?? 0,
    isToday: day === today,
    isFuture: day > today,
  }));
}

function inWindow(day: string, window: TeamWindow): boolean {
  return day >= window.start_date && day <= window.end_date;
}

function presenceOf(presence: readonly TeamMemberPresence[], memberKey: string, nowMs: number): boolean {
  const row = presence.find((candidate) => candidate.member_key === memberKey);
  if (!row || !row.tracking) return false;
  const seen = Date.parse(row.last_seen_at);
  return Number.isFinite(seen) && nowMs - seen <= PRESENCE_FRESH_MS;
}

/** Presence is a managed-policy signal for leads and admins only. */
export function presenceVisible(policy: TeamTrackingPolicy, viewerRole: TeamMembershipRole): boolean {
  return policy === "managed" && viewerRole !== "member";
}

export function buildTeamOverviewModel(dataset: TeamFocusDataset, context: TeamOverviewContext): TeamOverviewModel {
  const { window, today, projects, scope, policy, viewerRole } = context;
  const previous = previousWindow(window, context.dayLimit);
  const days = listWindowDays(window, context.dayLimit);
  const members = membersInContainer(dataset.members, dataset.groups, context.groupId);
  const memberKeys = new Set(members.map((member) => member.member_key));
  const focusVisible = scopeSharesTeamFocus(scope);
  const memberFocusVisible = scopeSharesMemberFocus(scope);
  const showPresence = presenceVisible(policy, viewerRole);

  const expectedDays = days.filter((day) => day <= today && context.expectedWeekdays.includes(isoWeekday(day)));
  const elapsedExpectedDays = expectedDays.length;

  const currentFocus = dataset.focusDays.filter((row) => memberKeys.has(row.member_key) && inWindow(row.activity_date, window));
  const previousFocus = dataset.focusDays.filter((row) => memberKeys.has(row.member_key) && inWindow(row.activity_date, previous));
  const teamProjectRows = sharedProjectRows(dataset.projectDays, focusVisible);
  const currentProjects = teamProjectRows.filter((row) => memberKeys.has(row.member_key) && inWindow(row.activity_date, window));
  const previousProjects = teamProjectRows.filter((row) => memberKeys.has(row.member_key) && inWindow(row.activity_date, previous));

  const sharingKeys = new Set((focusVisible ? currentFocus.map((row) => row.member_key) : currentProjects.map((row) => row.member_key)));
  const sharingMemberCount = sharingKeys.size;
  // Totals show at any team size (owner decision 2026-10-22): the team's sharing switches decide what each seat sees.
  const totalFocus = currentFocus;
  const totalProjects = currentProjects;
  const teamFocusSeconds = focusVisible ? sum(totalFocus, (row) => row.focus_seconds) : sum(totalProjects, (row) => row.seconds);
  const previousTeamFocusSeconds = focusVisible ? sum(previousFocus, (row) => row.focus_seconds) : sum(previousProjects, (row) => row.seconds);
  const avgPerMemberPerDaySeconds = sharingMemberCount > 0 && elapsedExpectedDays > 0
    ? teamFocusSeconds / sharingMemberCount / elapsedExpectedDays
    : 0;
  const goalPct = context.dailyGoalSeconds > 0 ? Math.min(100, Math.round((avgPerMemberPerDaySeconds / context.dailyGoalSeconds) * 100)) : 0;
  // Deep focus blocks are focus data: below team_focus nothing about them is shown.
  const deepBlockCount = focusVisible ? sum(totalFocus, (row) => row.deep_block_count) : 0;
  const deepBlockSeconds = focusVisible ? sum(totalFocus, (row) => row.deep_block_seconds) : 0;
  const avgDeepBlockSeconds = deepBlockCount > 0 ? deepBlockSeconds / deepBlockCount : 0;

  const secondsByDay = new Map<string, number>();
  for (const row of focusVisible ? totalFocus : []) secondsByDay.set(row.activity_date, (secondsByDay.get(row.activity_date) ?? 0) + row.focus_seconds);
  if (!focusVisible) for (const row of totalProjects) secondsByDay.set(row.activity_date, (secondsByDay.get(row.activity_date) ?? 0) + row.seconds);
  const focusByDay = dayPoints(days, secondsByDay, today);
  const focusByProject = sumProjectShares(totalProjects, projects);
  const focusByDayProject = days.map((day) => ({ day, shares: sumProjectShares(totalProjects.filter((row) => row.activity_date === day), projects) }));

  const trackingNow = showPresence
    ? (() => {
        const tracking = members.filter((member) => presenceOf(dataset.presence, member.member_key, context.nowMs));
        return { count: tracking.length, total: members.length, members: tracking };
      })()
    : null;

  const children = context.flattenGroups ? [] : childGroups(dataset.groups, context.groupId);
  const groupCards = children.map((group) => buildGroupCard(group, dataset, context, showPresence, focusVisible));
  // With groups under this container, the people shown directly are only those
  // not in any child group (for example the organization's own admins).
  const directMembers = children.length > 0
    ? members.filter((member) => member.group_id === context.groupId)
    : members;
  // Cards exist at every scope; below member_focus they carry the project split only.
  const memberCards = directMembers.map((member) => buildMemberCard(member, dataset, context, days, previous, expectedDays, showPresence, memberFocusVisible));
  const expectedDaySet = new Set(expectedDays);
  const trackedPersonDays = memberFocusVisible
    ? currentFocus.filter((row) => row.tracked_seconds > 0 && expectedDaySet.has(row.activity_date)).length
    : 0;

  return {
    memberCount: members.length,
    sharingMemberCount,
    teamFocusSeconds,
    previousTeamFocusSeconds,
    deltaPct: deltaPercent(teamFocusSeconds, previousTeamFocusSeconds),
    avgPerMemberPerDaySeconds,
    goalPct,
    deepBlockCount,
    avgDeepBlockSeconds,
    trackingNow,
    focusByDay,
    focusByDayProject,
    focusByProject,
    memberCards,
    groupCards,
    elapsedExpectedDays,
    trackedPersonDays,
    expectedPersonDays: memberFocusVisible ? members.length * expectedDays.length : 0,
    memberFocusVisible,
    teamFocusVisible: focusVisible,
  };
}

/**
 * A team as one card among teams: its projects and how its time split
 * between them. Focus time stays off these cards, so teams are not ranked by
 * how much they focused.
 */
function buildGroupCard(
  group: TeamGroup,
  dataset: TeamFocusDataset,
  context: TeamOverviewContext,
  showPresence: boolean,
  focusVisible: boolean,
): TeamGroupCardModel {
  const members = membersInContainer(dataset.members, dataset.groups, group.id);
  const keys = new Set(members.map((member) => member.member_key));
  const current = dataset.focusDays.filter((row) => keys.has(row.member_key) && inWindow(row.activity_date, context.window));
  const projectRows = sharedProjectRows(dataset.projectDays, focusVisible).filter((row) => keys.has(row.member_key) && inWindow(row.activity_date, context.window));
  const sharing = new Set((focusVisible ? current : projectRows).map((row) => row.member_key)).size;
  const shares = sumProjectShares(projectRows, context.projects).filter((share) => share.projectId !== null);
  return {
    group,
    memberCount: members.length,
    sharingMemberCount: sharing,
    projectSeconds: sum(shares, (share) => share.seconds),
    projectShares: shares,
    trackingCount: showPresence ? members.filter((member) => presenceOf(dataset.presence, member.member_key, context.nowMs)).length : null,
    childGroupCount: childGroups(dataset.groups, group.id).length,
  };
}

function buildMemberCard(
  member: TeamDirectoryMember,
  dataset: TeamFocusDataset,
  context: TeamOverviewContext,
  days: readonly string[],
  previous: TeamWindow,
  expectedDays: readonly string[],
  showPresence: boolean,
  memberFocusVisible: boolean,
): TeamMemberCardModel {
  const current = dataset.focusDays.filter((row) => row.member_key === member.member_key && inWindow(row.activity_date, context.window));
  const prior = dataset.focusDays.filter((row) => row.member_key === member.member_key && inWindow(row.activity_date, previous));
  const projectRows = sharedProjectRows(dataset.projectDays, memberFocusVisible).filter((row) => row.member_key === member.member_key && inWindow(row.activity_date, context.window));
  const shares = sumProjectShares(projectRows, context.projects);
  const focusSeconds = memberFocusVisible ? sum(current, (row) => row.focus_seconds) : 0;
  const previousFocusSeconds = memberFocusVisible ? sum(prior, (row) => row.focus_seconds) : 0;
  const blocksVisible = scopeSharesFocusBlocks(context.scope);
  const rowByDay = new Map(current.map((row) => [row.activity_date, row]));
  const expectedDaySet = new Set(expectedDays);
  const cells: TeamMemberDayCell[] = days.map((day) => {
    const row = rowByDay.get(day) ?? null;
    return {
      day,
      seconds: memberFocusVisible ? row?.focus_seconds ?? 0 : 0,
      isToday: day === context.today,
      isFuture: day > context.today,
      tracked: (row?.tracked_seconds ?? 0) > 0 || projectRows.some((candidate) => candidate.activity_date === day && candidate.seconds > 0),
      expected: expectedDaySet.has(day) || (day <= context.today && context.expectedWeekdays.includes(isoWeekday(day))),
      blocks: blocksVisible ? row?.blocks ?? [] : null,
      shares: sumProjectShares(projectRows.filter((candidate) => candidate.activity_date === day), context.projects),
    };
  });
  const trackedDays = memberFocusVisible
    ? current.filter((row) => row.tracked_seconds > 0 && expectedDays.includes(row.activity_date)).length
    : 0;
  const topProject = shares.find((share) => share.projectId !== null) ?? shares[0] ?? null;
  return {
    member,
    focusSeconds,
    previousFocusSeconds,
    deltaPct: memberFocusVisible ? deltaPercent(focusSeconds, previousFocusSeconds) : null,
    days: cells,
    trackedDays,
    expectedDays: expectedDays.length,
    sparse: memberFocusVisible && expectedDays.length >= 3 && trackedDays < expectedDays.length - 1,
    projects: shares,
    topProject,
    moreProjects: Math.max(0, shares.length - 1),
    deepBlockCount: memberFocusVisible ? sum(current, (row) => row.deep_block_count) : 0,
    tracking: showPresence ? presenceOf(dataset.presence, member.member_key, context.nowMs) : null,
  };
}

export type TeamMemberDetailContext = TeamOverviewContext & {
  readonly memberKey: string;
  /** How many windows back to compare, including the current one. */
  readonly windowCount?: number;
};

export function buildTeamMemberDetailModel(dataset: TeamFocusDataset, context: TeamMemberDetailContext): TeamMemberDetailModel | null {
  const member = dataset.members.find((candidate) => candidate.member_key === context.memberKey);
  if (!member) return null;
  const { window, today, projects, scope, policy, viewerRole } = context;
  const days = listWindowDays(window);
  const previous = previousWindow(window);
  const memberFocusVisible = scopeSharesMemberFocus(scope);
  const blocksVisible = scopeSharesFocusBlocks(scope);
  const showPresence = presenceVisible(policy, viewerRole);

  const rowsAll = dataset.focusDays.filter((row) => row.member_key === member.member_key);
  const current = rowsAll.filter((row) => inWindow(row.activity_date, window));
  const prior = rowsAll.filter((row) => inWindow(row.activity_date, previous));
  const memberProjectRows = sharedProjectRows(dataset.projectDays, memberFocusVisible).filter((row) => row.member_key === member.member_key);
  const projectRows = memberProjectRows.filter((row) => inWindow(row.activity_date, window));
  const previousProjects = sumProjectShares(memberProjectRows.filter((row) => inWindow(row.activity_date, previous)), projects);
  const shares = sumProjectShares(projectRows, projects);
  const focusSeconds = memberFocusVisible ? sum(current, (row) => row.focus_seconds) : sum(projectRows, (row) => row.seconds);
  const previousSeconds = memberFocusVisible ? sum(prior, (row) => row.focus_seconds) : 0;
  const mainProject = shares.find((share) => share.projectId !== null) ?? shares[0] ?? null;
  const projectTotal = sum(shares, (share) => share.seconds);

  let longest: TeamMemberFocusDay | null = null;
  for (const row of current) {
    if (!longest || row.longest_block_seconds > longest.longest_block_seconds) longest = row;
  }

  const byDay = new Map(current.map((row) => [row.activity_date, row]));
  const dayRows: TeamMemberDayRow[] = days.map((day) => {
    const row = byDay.get(day) ?? null;
    return {
      day,
      isToday: day === today,
      isFuture: day > today,
      expected: context.expectedWeekdays.includes(isoWeekday(day)),
      focusSeconds: memberFocusVisible ? row?.focus_seconds ?? 0 : 0,
      tracked: memberFocusVisible && (row?.tracked_seconds ?? 0) > 0,
      blocks: blocksVisible ? row?.blocks ?? [] : null,
      shares: sumProjectShares(projectRows.filter((projectRow) => projectRow.activity_date === day), projects),
    };
  });

  const windowCount = Math.max(1, context.windowCount ?? 4);
  const length = days.length;
  const containerMembers = membersInContainer(dataset.members, dataset.groups, context.groupId);
  const containerKeys = new Set(containerMembers.map((candidate) => candidate.member_key));
  const lastWindows: TeamMemberWeekPoint[] = [];
  for (let index = windowCount - 1; index >= 0; index -= 1) {
    const endDay = shiftIsoDate(window.end_date, -index * length);
    const startDay = shiftIsoDate(endDay, -(length - 1));
    const span = { start_date: startDay, end_date: endDay };
    const memberSeconds = memberFocusVisible ? sum(rowsAll.filter((row) => inWindow(row.activity_date, span)), (row) => row.focus_seconds) : 0;
    const teamRows = dataset.focusDays.filter((row) => containerKeys.has(row.member_key) && inWindow(row.activity_date, span));
    const teamMembers = new Set(teamRows.map((row) => row.member_key)).size;
    lastWindows.push({
      startDay,
      endDay,
      memberSeconds,
      teamAvgSeconds: scopeSharesTeamFocus(scope) && teamMembers > 0 ? sum(teamRows, (row) => row.focus_seconds) / teamMembers : 0,
      isCurrent: index === 0,
      shares: sumProjectShares(memberProjectRows.filter((row) => inWindow(row.activity_date, span)), projects),
    });
  }

  return {
    member,
    focusSeconds,
    deltaPct: memberFocusVisible ? deltaPercent(focusSeconds, previousSeconds) : null,
    mainProject,
    mainProjectPct: mainProject && projectTotal > 0 ? Math.round((mainProject.seconds / projectTotal) * 100) : 0,
    deepBlockCount: memberFocusVisible ? sum(current, (row) => row.deep_block_count) : 0,
    longestBlockSeconds: memberFocusVisible ? longest?.longest_block_seconds ?? 0 : 0,
    longestBlockDay: memberFocusVisible ? longest?.activity_date ?? null : null,
    longestBlockStartMinute: blocksVisible ? longest?.longest_block_start_minute ?? null : null,
    dayRows,
    projects: shares,
    previousProjects,
    lastWindows,
    tracking: showPresence ? presenceOf(dataset.presence, member.member_key, context.nowMs) : null,
    focusVisible: memberFocusVisible,
    blocksVisible,
  };
}

function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  let total = 0;
  for (const row of rows) total += pick(row);
  return total;
}

