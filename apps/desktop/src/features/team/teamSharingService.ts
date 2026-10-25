/**
 * The server side of a team's sharing (docs/teams-server-sharing.md): the
 * stored policy, roles, the totals each seat may read, shared focus days and
 * leaders' boards. Every read comes back already cut to the caller's seat;
 * nothing here carries account ids, apps, sites or blocks.
 */
import { callFirstRow, callRows, fail, requireAuthenticatedClient } from "./teamServiceClient";
import { requiredText } from "./teamServiceValidation";
import type { TeamClient, TeamMemberPresence, TeamResult } from "./teamTypes";
import {
  TEAM_FOCUS_SHARE_LEVELS,
  TEAM_PROJECT_SHARE_LEVELS,
  TEAM_TASK_SHARE_LEVELS,
  type TeamFocusShareLevel,
  type TeamProjectShareLevel,
  type TeamSharingPolicy,
  type TeamTaskShareLevel,
} from "./teamSharingPolicy";
import { parseTeamTrackingPolicy, type TeamRecordingSchedule, type TeamTrackingPolicy } from "./teamSharingScope";

export type TeamSeat = "admin" | "manager" | "member";
export type TeamManagerAccess = "totals" | "detail";
export type TeamScheduleClock = "team" | "local";

export type TeamServerSchedule = TeamRecordingSchedule & { readonly clock: TeamScheduleClock };

export type TeamServerPolicy = {
  readonly organization_id: string;
  /** A team without a stored policy keeps the beta's behavior. */
  readonly policy: TeamSharingPolicy | null;
  readonly tracking_policy: TeamTrackingPolicy;
  readonly schedule: TeamServerSchedule | null;
  readonly seat: TeamSeat | null;
  readonly manager_access: TeamManagerAccess;
  readonly manager_may_narrow: boolean;
  readonly updated_at: string | null;
};

export type TeamMemberRoleResult = {
  readonly member_key: string;
  readonly membership_role: "admin" | "manager" | "member";
  readonly manager_access: TeamManagerAccess;
  readonly manager_may_narrow: boolean;
};

/** A manager as the organization admin sees them. */
export type TeamServerManager = {
  readonly member_key: string;
  readonly display_name: string;
  readonly manager_access: TeamManagerAccess;
  readonly manager_may_narrow: boolean;
};

export type TeamTotalsRowKind = "team_project" | "member_project" | "team_focus" | "member_focus";

/** One figure the caller's seat may see: a team total, or a person's (their own, or others' where people are shared). */
export type TeamTotalsRow = {
  readonly row_kind: TeamTotalsRowKind;
  readonly organization_project_id: string | null;
  readonly member_key: string | null;
  readonly member_display_name: string | null;
  readonly is_self: boolean;
  readonly activity_date: string;
  readonly seconds: number;
};

export type TeamServerBoard = {
  readonly dashboard_id: string;
  readonly name: string | null;
  readonly seq: number;
  readonly visibility: "me" | "leaders";
  readonly grid: string;
  /** The client's layout (widgets, sizes, options), as saved. */
  readonly items: readonly unknown[];
  readonly is_own: boolean;
  readonly owner_member_key: string;
  readonly updated_at: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function record(row: unknown): Record<string, unknown> {
  return typeof row === "object" && row !== null ? row as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value as T : null;
}

export function normalizeTeamServerPolicy(row: unknown): TeamServerPolicy {
  const source = record(row);
  const projects = oneOf<TeamProjectShareLevel>(source.projects_level, TEAM_PROJECT_SHARE_LEVELS);
  const tasks = oneOf<TeamTaskShareLevel>(source.tasks_level, TEAM_TASK_SHARE_LEVELS);
  const focus = oneOf<TeamFocusShareLevel>(source.focus_level, TEAM_FOCUS_SHARE_LEVELS);
  const isSet = source.is_set === true && projects !== null && tasks !== null && focus !== null && typeof source.member_summary === "boolean";
  const days = Array.isArray(source.schedule_days) ? source.schedule_days.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7) : [];
  return {
    organization_id: text(source.organization_id),
    policy: isSet ? { projects: projects!, tasks: tasks!, focus: focus!, memberSummary: source.member_summary === true } : null,
    tracking_policy: parseTeamTrackingPolicy(source.tracking_policy) ?? "free",
    schedule: isSet && days.length > 0 ? {
      days,
      start_minute: count(source.schedule_start_minute),
      end_minute: count(source.schedule_end_minute),
      timezone: text(source.schedule_timezone) || "UTC",
      clock: source.schedule_clock === "local" ? "local" : "team",
    } : null,
    seat: oneOf<TeamSeat>(source.seat, ["admin", "manager", "member"]),
    manager_access: source.manager_access === "detail" ? "detail" : "totals",
    manager_may_narrow: source.manager_may_narrow === true,
    updated_at: nullableText(source.updated_at),
  };
}

export function normalizeTeamTotalsRow(row: unknown): TeamTotalsRow {
  const source = record(row);
  return {
    row_kind: oneOf<TeamTotalsRowKind>(source.row_kind, ["team_project", "member_project", "team_focus", "member_focus"]) ?? "team_project",
    organization_project_id: nullableText(source.organization_project_id),
    member_key: nullableText(source.member_key),
    member_display_name: nullableText(source.member_display_name),
    is_self: source.is_self === true,
    activity_date: text(source.activity_date).slice(0, 10),
    seconds: count(source.seconds),
  };
}

export function normalizeTeamServerBoard(row: unknown): TeamServerBoard {
  const source = record(row);
  return {
    dashboard_id: text(source.dashboard_id),
    name: nullableText(source.name),
    seq: Math.max(1, count(source.seq)),
    visibility: source.visibility === "leaders" ? "leaders" : "me",
    grid: text(source.grid) || "calibrated",
    items: Array.isArray(source.items) ? source.items : [],
    is_own: source.is_own === true,
    owner_member_key: text(source.owner_member_key),
    updated_at: nullableText(source.updated_at),
  };
}

function organization(input: { readonly organization_id: string }): { ok: true; value: string } | { ok: false; error: string } {
  return requiredText(input.organization_id, "Organization id is required.", 120);
}

export async function fetchTeamServerPolicy(
  input: { readonly organization_id: string },
  client?: TeamClient | null,
): Promise<TeamResult<TeamServerPolicy | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "get_organization_team_policy", { input_organization_id: organizationId.value }, normalizeTeamServerPolicy);
}

/** An organization admin sets the team's sharing; a manager the admin allowed may only narrow it (the server refuses the rest). */
export async function saveTeamServerPolicy(
  input: {
    readonly organization_id: string;
    readonly policy: TeamSharingPolicy;
    readonly tracking_policy?: TeamTrackingPolicy;
    readonly schedule?: TeamServerSchedule;
  },
  client?: TeamClient | null,
): Promise<TeamResult<TeamServerPolicy | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const schedule = input.schedule;
  if (schedule && (schedule.days.length < 1 || schedule.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    || schedule.start_minute < 0 || schedule.end_minute > 1440 || schedule.end_minute <= schedule.start_minute)) {
    return fail("invalid_input", "Recording hours are invalid.");
  }
  return callFirstRow(auth.data.client, "set_organization_team_policy", {
    input_organization_id: organizationId.value,
    input_projects_level: input.policy.projects,
    input_tasks_level: input.policy.tasks,
    input_focus_level: input.policy.focus,
    input_member_summary: input.policy.memberSummary,
    input_tracking_policy: input.tracking_policy ?? null,
    input_schedule_days: schedule ? [...new Set(schedule.days)].sort((left, right) => left - right) : null,
    input_schedule_start_minute: schedule?.start_minute ?? null,
    input_schedule_end_minute: schedule?.end_minute ?? null,
    input_schedule_timezone: schedule?.timezone ?? null,
    input_schedule_clock: schedule?.clock ?? null,
  }, normalizeTeamServerPolicy);
}

/** An organization admin makes a member a manager (team totals, or people too, and whether they may narrow sharing). */
export async function setTeamMemberRole(
  input: {
    readonly organization_id: string;
    readonly member_key: string;
    readonly role: "admin" | "manager" | "member";
    readonly manager_access?: TeamManagerAccess;
    readonly manager_may_narrow?: boolean;
  },
  client?: TeamClient | null,
): Promise<TeamResult<TeamMemberRoleResult | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const memberKey = requiredText(input.member_key, "Member is required.", 120);
  if (!memberKey.ok) return fail("invalid_input", memberKey.error);
  return callFirstRow(auth.data.client, "set_organization_member_role", {
    input_organization_id: organizationId.value,
    input_member_key: memberKey.value,
    input_role: input.role,
    input_manager_access: input.manager_access ?? "totals",
    input_manager_may_narrow: input.manager_may_narrow ?? false,
  }, (row) => {
    const source = record(row);
    return {
      member_key: text(source.member_key),
      membership_role: oneOf(source.membership_role, ["admin", "manager", "member"] as const) ?? "member",
      manager_access: source.manager_access === "detail" ? "detail" : "totals",
      manager_may_narrow: source.manager_may_narrow === true,
    };
  });
}

/** A new display name for the team or organization; its organization admins may set it. */
export async function renameTeam(
  input: { readonly organization_id: string; readonly name: string },
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly organization_id: string; readonly name: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const name = requiredText(input.name, "Team name must be between 1 and 120 characters.", 120);
  if (!name.ok) return fail("invalid_input", name.error);
  return callFirstRow(auth.data.client, "rename_organization_team", {
    input_organization_id: organizationId.value,
    input_name: name.value,
  }, (row) => {
    const source = record(row);
    return { organization_id: text(source.organization_id), name: text(source.organization_name) };
  });
}

/** The owner hands the team to one of its organization admins and stays an organization admin. */
export async function transferTeamOwnership(
  input: { readonly organization_id: string; readonly member_key: string },
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly member_key: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const memberKey = requiredText(input.member_key, "Member is required.", 120);
  if (!memberKey.ok) return fail("invalid_input", memberKey.error);
  return callFirstRow(auth.data.client, "transfer_organization_ownership", {
    input_organization_id: organizationId.value,
    input_member_key: memberKey.value,
  }, (row) => ({ member_key: text(record(row).member_key) }));
}

/** A team its owner deleted, closed to everyone and kept until the end of its grace period. */
export type TeamScheduledDeletion = {
  readonly organization_id: string;
  readonly organization_name: string;
  readonly purge_after: string;
};

/** The caller's own teams that are being deleted, for them to restore. */
export async function fetchScheduledTeamDeletions(client?: TeamClient | null): Promise<TeamResult<readonly TeamScheduledDeletion[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  return callRows(auth.data.client, "get_own_scheduled_team_deletions", {}, (row) => {
    const source = record(row);
    return { organization_id: text(source.organization_id), organization_name: text(source.organization_name), purge_after: text(source.deletion_purge_after) };
  });
}

/** Brings a deleted team back within its grace period; only its owner may. */
export async function restoreTeam(
  input: { readonly organization_id: string },
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly organization_id: string; readonly name: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "restore_organization_team", { input_organization_id: organizationId.value }, (row) => {
    const source = record(row);
    return { organization_id: text(source.organization_id), name: text(source.organization_name) };
  });
}

/** The team's managers; only an organization admin may read them. */
export async function fetchTeamManagers(
  input: { readonly organization_id: string },
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamServerManager[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_managers", { input_organization_id: organizationId.value }, (row) => {
    const source = record(row);
    return {
      member_key: text(source.member_key),
      display_name: text(source.display_name),
      manager_access: source.manager_access === "detail" ? "detail" : "totals",
      manager_may_narrow: source.manager_may_narrow === true,
    };
  });
}

/** Someone who left the team with records still in it (owner decision 2026-10-25). */
export type TeamFormerMember = {
  readonly member_key: string;
  readonly display_name: string;
  readonly departure: "left" | "removed";
  readonly left_at: string;
};

/** People who left with records still in the team; organization admins and managers who see people may read them. */
export async function fetchTeamFormerMembers(
  input: { readonly organization_id: string },
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamFormerMember[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_former_members", { input_organization_id: organizationId.value }, (row) => {
    const source = record(row);
    return { member_key: text(source.member_key), display_name: text(source.display_name), departure: source.departure === "removed" ? "removed" : "left", left_at: text(source.left_at) };
  });
}

/** An organization admin deletes what a former member shared with the team, as a step of its own. */
export async function deleteFormerMemberRecords(
  input: { readonly organization_id: string; readonly member_key: string },
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly removed_project_rows: number; readonly removed_focus_rows: number } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const memberKey = requiredText(input.member_key, "Member is required.", 120);
  if (!memberKey.ok) return fail("invalid_input", memberKey.error);
  return callFirstRow(auth.data.client, "delete_former_member_shared_records", {
    input_organization_id: organizationId.value,
    input_member_key: memberKey.value,
  }, (row) => {
    const source = record(row);
    return { removed_project_rows: count(source.removed_project_rows), removed_focus_rows: count(source.removed_focus_rows) };
  });
}

/** The figures the caller's seat may see in a window, already cut by the server. */
export async function fetchTeamTotals(
  input: { readonly organization_id: string; readonly start_date: string; readonly end_date: string },
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamTotalsRow[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  if (!DATE.test(input.start_date) || !DATE.test(input.end_date) || input.end_date < input.start_date) return fail("invalid_input", "Team window dates are invalid.");
  return callRows(auth.data.client, "get_organization_team_totals", {
    input_organization_id: organizationId.value,
    input_start_date: input.start_date,
    input_end_date: input.end_date,
  }, normalizeTeamTotalsRow);
}

/** A member's focus per day, only while the team shares focus; days outside the window are dropped here as on the server. */
export async function publishTeamFocusDays(
  input: {
    readonly organization_id: string;
    readonly display_name: string;
    readonly window_start_date: string;
    readonly window_end_date: string;
    readonly entries: readonly { readonly activity_date: string; readonly seconds: number }[];
  },
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly published_row_count: number } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const displayName = requiredText(input.display_name, "Display name is required.", 80);
  if (!displayName.ok) return fail("invalid_input", displayName.error);
  if (!DATE.test(input.window_start_date) || !DATE.test(input.window_end_date) || input.window_end_date < input.window_start_date) {
    return fail("invalid_input", "Focus window dates are invalid.");
  }
  const entries = input.entries
    .filter((entry) => DATE.test(entry.activity_date) && entry.activity_date >= input.window_start_date && entry.activity_date <= input.window_end_date)
    .map((entry) => ({ activity_date: entry.activity_date, seconds: Math.min(86400, Math.max(0, Math.round(entry.seconds))) }))
    .filter((entry) => entry.seconds > 0);
  return callFirstRow(auth.data.client, "publish_organization_shared_focus_days", {
    input_organization_id: organizationId.value,
    input_display_name: displayName.value,
    input_window_start_date: input.window_start_date,
    input_window_end_date: input.window_end_date,
    input_entries: entries,
  }, (row) => ({ published_row_count: count(record(row).published_row_count) }));
}

export async function fetchTeamServerBoards(
  input: { readonly organization_id: string },
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamServerBoard[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_dashboards", { input_organization_id: organizationId.value }, normalizeTeamServerBoard);
}

/** Saves the caller's own board; a null id makes a new one. */
export async function saveTeamServerBoard(
  input: {
    readonly organization_id: string;
    readonly dashboard_id: string | null;
    readonly name: string | null;
    readonly seq: number;
    readonly visibility: "me" | "leaders";
    readonly grid: string;
    readonly items: readonly unknown[];
  },
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly dashboard_id: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  if (input.items.length > 40) return fail("invalid_input", "A board holds at most 40 widgets.");
  const name = input.name?.trim() || null;
  if (name !== null && name.length > 60) return fail("invalid_input", "A board name is at most 60 characters.");
  return callFirstRow(auth.data.client, "save_organization_dashboard", {
    input_organization_id: organizationId.value,
    input_dashboard_id: input.dashboard_id,
    input_name: name,
    input_seq: Math.min(999, Math.max(1, Math.round(input.seq))),
    input_visibility: input.visibility,
    input_grid: input.grid,
    input_items: input.items,
  }, (row) => ({ dashboard_id: text(record(row).dashboard_id) }));
}

export async function deleteTeamServerBoard(
  input: { readonly dashboard_id: string },
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly deleted_count: number } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const dashboardId = requiredText(input.dashboard_id, "Board is required.", 120);
  if (!dashboardId.ok) return fail("invalid_input", dashboardId.error);
  return callFirstRow(auth.data.client, "delete_organization_dashboard", { input_dashboard_id: dashboardId.value }, (row) => ({ deleted_count: count(record(row).deleted_count) }));
}

/**
 * Managed tracking: while this computer records, it names the managed teams whose hours hold
 * now. The server keeps the time of the last report for member seats only and clears the
 * caller's other teams, so an empty list at the end of the hours leaves nothing behind.
 */
export async function reportTeamPresence(
  organizationIds: readonly string[],
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly reported_count: number } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const ids = [...new Set(organizationIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (ids.length > 50) return fail("invalid_input", "Too many teams.");
  return callFirstRow(auth.data.client, "report_organization_presence", { input_organization_ids: ids }, (row) => ({ reported_count: count(record(row).reported_count) }));
}

/** Who in a managed team is recording now, for the seats that see people, inside the team's hours. */
export async function fetchTeamPresence(
  input: { readonly organization_id: string },
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamMemberPresence[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_presence", { input_organization_id: organizationId.value }, (row) => {
    const source = record(row);
    // Only fresh reports come back, so every row is someone recording now.
    return { member_key: text(source.member_key), tracking: true, last_seen_at: text(source.last_seen_at) };
  });
}
