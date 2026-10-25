import type { TeamRecordingSchedule, TeamSharingScope, TeamTrackingPolicy } from "./teamSharingScope";
import type { TeamGroupSharingPolicies, TeamSharingPolicy, TeamSharingWindow } from "./teamSharingPolicy";

export const TEAM_PERIODS = ["daily", "weekly", "monthly"] as const;
export type TeamPeriod = typeof TEAM_PERIODS[number];
export const DEFAULT_TEAM_PERIOD: TeamPeriod = "weekly";

export type TeamFailureReason =
  | "supabase_disabled"
  | "not_authenticated"
  | "full_account_required"
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "remote_error";

export type TeamResult<T = undefined> =
  | { readonly success: true; readonly error: null; readonly data: T }
  | { readonly success: false; readonly error: string; readonly reason: TeamFailureReason };

export type TeamInviteStatus = "pending" | "accepted" | "revoked" | "expired";

/** owner and admin run the organization; a lead runs one group; member is everyone else. */
export type TeamMembershipRole = "owner" | "admin" | "lead" | "member";

export type OwnTeam = {
  readonly organization_id: string;
  readonly organization_name: string;
  readonly member_display_name: string;
  readonly role_label: string;
  readonly member_count: number;
  readonly updated_at: string;
  /** Server-assigned membership role; role_label is only a display label. */
  readonly membership_role: TeamMembershipRole;
  /** Whether non-owner members may create invite links. Null when the server
   *  predates the setting, so the owner control stays hidden. */
  readonly members_can_invite: boolean | null;
  /** What the team shares upward. Absent or null when the server predates
   *  sharing scopes; the dashboards then keep the project-totals view. */
  readonly sharing_scope?: TeamSharingScope | null;
  /** Whether members may pause tracking. Absent or null from an older server (free). */
  readonly tracking_policy?: TeamTrackingPolicy | null;
  /** Under a managed policy, when the team records; null means always. */
  readonly recording_schedule?: TeamRecordingSchedule | null;
  /** Per-item sharing levels. Absent from a server that only knows the single scope. */
  readonly sharing_policy?: TeamSharingPolicy | null;
  /**
   * Teams inside the organization that share on their own policy instead of
   * sharing_policy, by group id. Only the Dev preview fills it so far; a
   * server without it leaves every team on the organization's policy.
   */
  readonly group_sharing_policies?: TeamGroupSharingPolicies | null;
  /** What the organization admin set per team, before any manager narrowed it (Dev preview decision candidate). */
  readonly group_sharing_admin_policies?: TeamGroupSharingPolicies | null;
  /** The hours whose records the team shares, under either tracking policy. */
  readonly sharing_window?: TeamSharingWindow | null;
  /** Groups (departments or teams) inside the organization; 0 or absent for a flat team. */
  readonly group_count?: number;
  /** The viewer's own group, when the organization has groups. */
  readonly viewer_group_id?: string | null;
};

export function isTeamOwner(team: OwnTeam | null | undefined): boolean {
  return team?.membership_role === "owner";
}

/** Owners and admins see every group and member; leads see their own group. */
export function isTeamAdmin(team: OwnTeam | null | undefined): boolean {
  return team?.membership_role === "owner" || team?.membership_role === "admin";
}

export function isTeamLead(team: OwnTeam | null | undefined): boolean {
  return team?.membership_role === "lead";
}

/** Mirrors the server's can_create_organization_invite rule. */
export function canInviteToTeam(team: OwnTeam | null | undefined): boolean {
  return Boolean(team) && (isTeamOwner(team) || team?.members_can_invite === true);
}

export type SetTeamMemberInvitesInput = { readonly organization_id: string; readonly enabled: boolean };

export type TeamMemberInvitesSetting = { readonly organization_id: string; readonly members_can_invite: boolean };

export type SetTeamSharingScopeInput = { readonly organization_id: string; readonly sharing_scope: TeamSharingScope };
export type SetTeamTrackingPolicyInput = { readonly organization_id: string; readonly tracking_policy: TeamTrackingPolicy };

export type TeamSharingSettings = {
  readonly organization_id: string;
  readonly sharing_scope: TeamSharingScope | null;
  readonly tracking_policy: TeamTrackingPolicy | null;
};

/** Owner-only roster row. member_key is a per-team opaque key, never an account id. */
export type TeamMember = {
  readonly member_key: string;
  readonly display_name: string;
  readonly role_label: string;
  readonly membership_role: TeamMembershipRole;
  readonly joined_at: string;
  readonly is_self: boolean;
};

/** One group (department or team) inside an organization. */
export type TeamGroup = {
  readonly id: string;
  readonly organization_id: string;
  readonly parent_group_id: string | null;
  readonly name: string;
  readonly lead_display_name: string | null;
  readonly member_count: number;
};

/** A member as the focus dashboards address them: by per-team opaque key, never an account id. */
export type TeamDirectoryMember = {
  readonly member_key: string;
  readonly display_name: string;
  readonly role_label: string;
  readonly membership_role: TeamMembershipRole;
  readonly group_id: string | null;
  readonly is_self: boolean;
  /** The member's own weekly focus goal, when they set one. Admins never set it. */
  readonly weekly_goal_seconds: number | null;
};

/** A focus block inside one logical day: minutes from the day's start, and the team project it went to. */
export type TeamFocusBlock = {
  readonly start_minute: number;
  readonly end_minute: number;
  readonly project_id: string | null;
};

/**
 * One member's one day, as shared with the team. Which fields are filled
 * follows the team's sharing scope: focus seconds from team_focus up (pooled
 * on the server below member_focus), blocks only at focus_blocks.
 */
export type TeamMemberFocusDay = {
  readonly member_key: string;
  readonly activity_date: string;
  readonly focus_seconds: number;
  readonly tracked_seconds: number;
  readonly deep_block_count: number;
  /** Seconds inside deep focus blocks (25 minutes or longer), for the average block length. */
  readonly deep_block_seconds: number;
  readonly longest_block_seconds: number;
  /** Minutes from the day's start at which the longest block began; null when unknown. */
  readonly longest_block_start_minute: number | null;
  readonly blocks: readonly TeamFocusBlock[] | null;
};

/** Focus seconds one member put into one team project on one day; null is unassigned focus. */
export type TeamMemberProjectDay = {
  readonly member_key: string;
  readonly organization_project_id: string | null;
  readonly activity_date: string;
  readonly seconds: number;
};

/** Whether a member's device is recording right now; shown only under a managed policy. */
export type TeamMemberPresence = {
  readonly member_key: string;
  readonly tracking: boolean;
  readonly last_seen_at: string;
};

export type FetchTeamMembersInput = { readonly organization_id: string };
export type RemoveTeamMemberInput = { readonly organization_id: string; readonly member_key: string };
export type LeaveTeamInput = { readonly organization_id: string };

export type RemovedTeamMember = {
  readonly organization_id: string;
  readonly member_count: number;
  readonly removed_total_rows: number;
  readonly revoked_invite_count: number;
};

export type LeftTeam = {
  readonly organization_id: string;
  readonly removed_total_rows: number;
  readonly revoked_invite_count: number;
};

export type DeleteTeamInput = { readonly organization_id: string; readonly confirmation_name: string };

export type DeletedTeam = {
  readonly organization_id: string;
  readonly member_count: number;
  readonly deleted_total_rows: number;
};

export type TeamInvite = {
  readonly invite_id: string;
  readonly organization_id: string;
  readonly organization_name: string;
  readonly invite_code: string;
  readonly invite_url: string;
  readonly role_label: string;
  readonly status: TeamInviteStatus;
  readonly expires_at: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type TeamProjectStatus = "active" | "archived";

export type TeamProjectAnchor = {
  readonly kind: "app" | "domain" | "keyword";
  readonly value: string;
};

export type TeamProject = {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly status: TeamProjectStatus;
  readonly anchors: readonly TeamProjectAnchor[];
  readonly can_manage: boolean;
  readonly created_at: string;
  readonly updated_at: string;
};

export type TeamProjectMixRow = {
  readonly organization_id: string;
  readonly organization_project_id: string;
  readonly project_name: string;
  readonly project_color: string;
  readonly project_status: TeamProjectStatus;
  readonly activity_date: string;
  readonly seconds: number;
};

export type TeamProjectMemberRow = {
  readonly organization_id: string;
  readonly organization_project_id: string;
  readonly project_name: string;
  readonly member_display_name: string;
  /** Per-team opaque member key when the server shares member focus; absent or null below that scope or from an older server. */
  readonly member_key?: string | null;
  /**
   * Tells members apart within one response, so two people sharing under the
   * same name stay separate. Not an identifier. Null from an older server.
   */
  readonly member_slot: number | null;
  /** Whether the row is the caller's own. Null from an older server. */
  readonly is_self: boolean | null;
  readonly seconds: number;
};

export type PublishedTeamProjectTotals = {
  readonly organization_id: string;
  readonly window_start_date: string;
  readonly window_end_date: string;
  readonly published_row_count: number;
  readonly updated_at: string;
};

export type StoppedTeamProjectSharing = {
  readonly organization_id: string;
  readonly deleted_row_count: number;
  readonly updated_at: string;
};

export type TeamProjectTotalsEntry = {
  readonly project_id: string;
  readonly activity_date: string;
  readonly seconds: number;
};

export type CreateTeamProjectInput = {
  readonly organization_id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly color?: string | null;
  readonly anchors?: readonly TeamProjectAnchor[] | null;
};

export type UpdateTeamProjectInput = {
  readonly project_id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly color?: string | null;
  readonly anchors?: readonly TeamProjectAnchor[] | null;
};

export type ArchiveTeamProjectInput = { readonly project_id: string; readonly archived?: boolean };
export type FetchTeamProjectsInput = { readonly organization_id: string };
export type StopTeamProjectSharingInput = { readonly organization_id: string };
export type FetchTeamProjectWindowInput = {
  readonly organization_id: string;
  readonly start_date: string;
  readonly end_date: string;
};
export type PublishTeamProjectTotalsInput = {
  readonly organization_id: string;
  readonly display_name: string;
  readonly window_start_date: string;
  readonly window_end_date: string;
  readonly entries: readonly TeamProjectTotalsEntry[];
};

export type TeamInviteActionResponse = {
  readonly ok?: boolean;
  readonly action?: string;
  readonly inviteId?: string;
  readonly organizationId?: string;
  readonly organizationName?: string | null;
  readonly roleLabel?: string;
  readonly expiresAt?: string;
  readonly inviteCode?: string;
  readonly inviteUrl?: string;
  readonly memberDisplayName?: string;
};

export type CreateTeamInput = {
  readonly organizationName: string;
  readonly roleLabel?: string | null;
};

export type FetchTeamInvitesInput = { readonly organization_id: string };
export type CreateTeamInviteInput = { readonly organization_id: string; readonly role_label?: string | null };
export type AcceptTeamInviteInput = { readonly inviteKey: string };
export type RevokeTeamInviteInput = { readonly invite_id: string };

export type AuthUser = {
  readonly id: string;
  readonly email?: string | null;
  readonly is_anonymous?: boolean | null;
  readonly app_metadata?: { readonly provider?: string | null; readonly providers?: readonly string[] | null } | null;
};

export type RpcProcedure =
  | "get_own_organization_teams"
  | "create_organization_team"
  | "get_organization_invites"
  | "set_organization_member_invites"
  | "set_organization_sharing_scope"
  | "set_organization_tracking_policy"
  | "get_organization_members"
  | "remove_organization_member"
  | "leave_organization"
  | "get_organization_former_members"
  | "delete_former_member_shared_records"
  | "delete_organization_team"
  | "create_organization_project"
  | "update_organization_project"
  | "archive_organization_project"
  | "get_organization_projects"
  | "publish_organization_project_totals"
  | "stop_organization_project_sharing"
  | "get_organization_project_mix"
  | "get_organization_project_member_breakdown"
  | "get_organization_team_policy"
  | "set_organization_team_policy"
  | "set_organization_member_role"
  | "rename_organization_team"
  | "transfer_organization_ownership"
  | "get_own_scheduled_team_deletions"
  | "restore_organization_team"
  | "get_organization_managers"
  | "get_organization_team_totals"
  | "publish_organization_shared_focus_days"
  | "get_organization_dashboards"
  | "save_organization_dashboard"
  | "delete_organization_dashboard";

export type RpcResponse = {
  readonly data: readonly unknown[] | null;
  readonly error: { readonly message: string; readonly code?: string } | null;
};

export type TeamClient = {
  readonly auth: {
    readonly getUser: () => Promise<{ readonly data: { readonly user: AuthUser | null }; readonly error: unknown }>;
  };
  readonly rpc: (procedure: RpcProcedure, args?: Record<string, unknown>) => Promise<RpcResponse>;
  readonly functions: {
    readonly invoke: (
      name: "team-invites",
      options: { readonly body: Record<string, unknown> },
    ) => Promise<{ readonly data: unknown; readonly error: unknown | null }>;
  };
};

export type AuthenticatedClient = {
  readonly client: TeamClient;
  readonly user: AuthUser;
};

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export type TeamInviteFunctionBody =
  | { readonly action: "create"; readonly organizationId: string; readonly roleLabel: string }
  | { readonly action: "accept"; readonly inviteKey: string }
  | { readonly action: "revoke"; readonly inviteId: string };
