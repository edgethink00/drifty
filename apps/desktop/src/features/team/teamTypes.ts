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

export type TeamMembershipRole = "owner" | "admin" | "member";

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
};

export function isTeamOwner(team: OwnTeam | null | undefined): boolean {
  return team?.membership_role === "owner";
}

/** Mirrors the server's can_create_organization_invite rule. */
export function canInviteToTeam(team: OwnTeam | null | undefined): boolean {
  return Boolean(team) && (isTeamOwner(team) || team?.members_can_invite === true);
}

export type SetTeamMemberInvitesInput = { readonly organization_id: string; readonly enabled: boolean };

export type TeamMemberInvitesSetting = { readonly organization_id: string; readonly members_can_invite: boolean };

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
  | "create_organization_project"
  | "update_organization_project"
  | "archive_organization_project"
  | "get_organization_projects"
  | "publish_organization_project_totals"
  | "stop_organization_project_sharing"
  | "get_organization_project_mix"
  | "get_organization_project_member_breakdown";

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
