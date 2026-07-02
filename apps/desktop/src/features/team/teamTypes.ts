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

export type TeamShareScope = "private" | "focus_only";
export type TeamInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type OwnTeam = {
  readonly organization_id: string;
  readonly organization_name: string;
  readonly member_display_name: string;
  readonly role_label: string;
  readonly focus_share_scope: TeamShareScope;
  readonly member_count: number;
  readonly focus_seconds: number;
  readonly focus_score: number;
  readonly private_rank: number | null;
  readonly window_start_date: string;
  readonly window_end_date: string;
  readonly updated_at: string;
};

export type TeamFocusSummaryRow = Omit<OwnTeam, "member_count">;

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

export type PublishedTeamFocusTotal = {
  readonly organization_id: string;
  readonly period: TeamPeriod;
  readonly focus_share_scope: TeamShareScope;
  readonly focus_seconds: number;
  readonly focus_score: number;
  readonly window_start_date: string;
  readonly window_end_date: string;
  readonly updated_at: string;
};

export type StoppedTeamFocusSharing = {
  readonly organization_id: string;
  readonly focus_share_scope: TeamShareScope;
  readonly deleted_focus_total_count: number;
  readonly updated_at: string;
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

export type FetchTeamFocusSummaryInput = {
  readonly organization_id: string;
  readonly period?: TeamPeriod | string | null;
};

export type PublishTeamFocusTotalInput = {
  readonly organization_id: string;
  readonly period: TeamPeriod | string;
  readonly display_name: string;
  readonly role_label: string;
  readonly focus_seconds: number;
  readonly focus_score: number;
  readonly window_start_date: string;
  readonly window_end_date: string;
  readonly timezone: string;
};

export type StopTeamFocusSharingInput = { readonly organization_id: string };
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
  | "get_organization_focus_summary"
  | "publish_organization_focus_total"
  | "stop_organization_focus_sharing"
  | "get_organization_invites";

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
