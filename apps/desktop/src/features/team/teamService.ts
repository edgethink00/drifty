import { callFirstRow, callRows, fail, invokeTeamInvite, requireAuthenticatedClient } from "./teamServiceClient";
import {
  normalizeDeletedTeam,
  normalizeLeftTeam,
  normalizeOwnEmailInvite,
  normalizeOwnTeam,
  normalizeRemovedTeamMember,
  normalizePublishedTeamProjectTotals,
  normalizeStoppedTeamProjectSharing,
  normalizeTeamEmailInvite,
  normalizeTeamInvite,
  normalizeTeamMember,
  normalizeTeamMemberInvitesSetting,
  normalizeTeamProject,
  normalizeTeamProjectMemberRow,
  normalizeTeamProjectMixRow,
  normalizeTeamSharingSettings,
  readEmailInviteResults,
} from "./teamServiceMappers";
import { optionalText, requiredText } from "./teamServiceValidation";
import { MAX_EMAIL_INVITES_PER_SEND } from "./teamEmailInviteModel";
import { DEFAULT_TEAM_PERIOD } from "./teamTypes";
import type {
  AcceptTeamInviteInput,
  ArchiveTeamProjectInput,
  CancelTeamEmailInviteInput,
  CreateTeamInput,
  CreateTeamInviteInput,
  CreateTeamProjectInput,
  DeletedTeam,
  DeleteTeamInput,
  FetchTeamInvitesInput,
  FetchTeamMembersInput,
  FetchTeamProjectsInput,
  FetchTeamProjectWindowInput,
  LeaveTeamInput,
  LeftTeam,
  OwnEmailInvite,
  OwnTeam,
  PublishedTeamProjectTotals,
  PublishTeamProjectTotalsInput,
  RemovedTeamMember,
  RemoveTeamMemberInput,
  RevokeTeamInviteInput,
  SendTeamEmailInvitesInput,
  SetTeamMemberInvitesInput,
  SetTeamSharingScopeInput,
  SetTeamTrackingPolicyInput,
  StopTeamProjectSharingInput,
  StoppedTeamProjectSharing,
  TeamClient,
  TeamEmailInvite,
  TeamEmailInviteResult,
  TeamInvite,
  TeamInviteActionResponse,
  TeamMember,
  TeamMemberInvitesSetting,
  TeamPeriod,
  TeamProject,
  TeamProjectMemberRow,
  TeamProjectMixRow,
  TeamResult,
  TeamSharingSettings,
  UpdateTeamProjectInput,
} from "./teamTypes";

export { DEFAULT_TEAM_PERIOD, TEAM_PERIODS } from "./teamTypes";
export { isTeamErrorMessage, messageFromTeamError } from "./teamServiceClient";
export type {
  AcceptTeamInviteInput,
  CancelTeamEmailInviteInput,
  CreateTeamInput,
  CreateTeamInviteInput,
  DeletedTeam,
  DeleteTeamInput,
  FetchTeamInvitesInput,
  FetchTeamMembersInput,
  LeaveTeamInput,
  LeftTeam,
  OwnEmailInvite,
  OwnTeam,
  RemovedTeamMember,
  RemoveTeamMemberInput,
  RevokeTeamInviteInput,
  SendTeamEmailInvitesInput,
  SetTeamMemberInvitesInput,
  SetTeamSharingScopeInput,
  SetTeamTrackingPolicyInput,
  TeamClient,
  TeamEmailInvite,
  TeamEmailInviteOutcome,
  TeamEmailInviteResult,
  TeamFailureReason,
  TeamInvite,
  TeamInviteActionResponse,
  TeamInviteStatus,
  TeamMember,
  TeamMemberInvitesSetting,
  TeamPeriod,
  TeamResult,
  TeamSharingSettings,
} from "./teamTypes";
export { canInviteToTeam, isTeamOwner } from "./teamTypes";

export async function fetchOwnTeams(
  periodOrClient: TeamPeriod | TeamClient | null = DEFAULT_TEAM_PERIOD,
  maybeClient?: TeamClient | null,
): Promise<TeamResult<readonly OwnTeam[]>> {
  const period = typeof periodOrClient === "string" ? periodOrClient : DEFAULT_TEAM_PERIOD;
  const client = typeof periodOrClient === "string" ? maybeClient : periodOrClient;
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  return callRows(auth.data.client, "get_own_organization_teams", { period_name: period }, normalizeOwnTeam);
}

export async function createTeam(
  input: CreateTeamInput,
  client?: TeamClient | null,
): Promise<TeamResult<OwnTeam | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationName = requiredText(input.organizationName, "Team name is required.", 120);
  if (!organizationName.ok) return fail("invalid_input", organizationName.error);
  const roleLabel = optionalText(input.roleLabel, "Owner", 40);

  return callFirstRow(auth.data.client, "create_organization_team", {
    input_organization_name: organizationName.value,
    input_role_label: roleLabel,
  }, normalizeOwnTeam);
}

export async function fetchTeamInvites(
  input: FetchTeamInvitesInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamInvite[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_invites", {
    input_organization_id: organizationId.value,
  }, normalizeTeamInvite);
}

export async function createTeamInvite(
  input: CreateTeamInviteInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamInviteActionResponse>> {
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return invokeTeamInvite({ action: "create", organizationId: organizationId.value, roleLabel: optionalText(input.role_label, "Member", 40) }, client);
}

export async function acceptTeamInvite(
  input: AcceptTeamInviteInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamInviteActionResponse>> {
  const inviteKey = requiredText(input.inviteKey, "Enter a team invite code or paste-only invite link.", 500);
  if (!inviteKey.ok) return fail("invalid_input", inviteKey.error);
  return invokeTeamInvite({ action: "accept", inviteKey: inviteKey.value, ...(input.expectedPolicyVersion ? { expectedPolicyVersion: input.expectedPolicyVersion } : {}) }, client);
}

export async function revokeTeamInvite(
  input: RevokeTeamInviteInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamInviteActionResponse>> {
  const inviteId = requiredText(input.invite_id, "Invite id is required.", 120);
  if (!inviteId.ok) return fail("invalid_input", inviteId.error);
  return invokeTeamInvite({ action: "revoke", inviteId: inviteId.value }, client);
}

export { MAX_EMAIL_INVITES_PER_SEND };

/**
 * Email invites (owner decision 2026-10-29): stores each address and mails it
 * a link, under the caller's own invite permission. Resolves to what happened
 * to each address; a refused request (permission, a missing team) fails whole.
 */
export async function sendTeamEmailInvites(
  input: SendTeamEmailInvitesInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamEmailInviteResult[]>> {
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return fail("invalid_input", "Add at least one email address.");
  if (emails.length > MAX_EMAIL_INVITES_PER_SEND) return fail("invalid_input", "Send at most " + MAX_EMAIL_INVITES_PER_SEND + " email invites at once.");
  const result = await invokeTeamInvite({ action: "send", organizationId: organizationId.value, emails, locale: input.locale }, client);
  if (!result.success) return result;
  return { success: true, error: null, data: readEmailInviteResults(result.data.results) };
}

/** The team's email invites, newest first. Fails as unsupported on a server without them. */
export async function fetchTeamEmailInvites(
  input: FetchTeamInvitesInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamEmailInvite[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_email_invites", { input_organization_id: organizationId.value }, normalizeTeamEmailInvite);
}

export async function cancelTeamEmailInvite(
  input: CancelTeamEmailInviteInput,
  client?: TeamClient | null,
): Promise<TeamResult<null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const inviteId = requiredText(input.invite_id, "Invite id is required.", 120);
  if (!inviteId.ok) return fail("invalid_input", inviteId.error);
  const result = await callRows(auth.data.client, "cancel_organization_email_invite", { input_invite_id: inviteId.value }, () => null);
  return result.success ? { success: true, error: null, data: null } : result;
}

/** Open email invites addressed to the signed-in account, to offer without the mailed link. */
export async function fetchOwnEmailInvites(client?: TeamClient | null): Promise<TeamResult<readonly OwnEmailInvite[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  return callRows(auth.data.client, "get_own_pending_email_invites", {}, normalizeOwnEmailInvite);
}

/** Owner-only: lets non-owner members create invite links, or stops them. */
export async function setTeamMemberInvites(
  input: SetTeamMemberInvitesInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamMemberInvitesSetting | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "set_organization_member_invites", {
    input_organization_id: organizationId.value,
    input_enabled: input.enabled,
  }, normalizeTeamMemberInvitesSetting);
}

// Owner-only: what the team shares upward. Raising the scope stops members'
// sharing until they agree again; lowering it drops rows outside the new scope.
export async function setTeamSharingScope(
  input: SetTeamSharingScopeInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamSharingSettings | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "set_organization_sharing_scope", {
    input_organization_id: organizationId.value,
    input_sharing_scope: input.sharing_scope,
  }, normalizeTeamSharingSettings);
}

// Owner-only: whether members may pause tracking.
export async function setTeamTrackingPolicy(
  input: SetTeamTrackingPolicyInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamSharingSettings | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "set_organization_tracking_policy", {
    input_organization_id: organizationId.value,
    input_tracking_policy: input.tracking_policy,
  }, normalizeTeamSharingSettings);
}

// Owner-only roster. Members are addressed by a per-team opaque key.
export async function fetchTeamMembers(
  input: FetchTeamMembersInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamMember[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_members", {
    input_organization_id: organizationId.value,
  }, normalizeTeamMember);
}

export async function removeTeamMember(
  input: RemoveTeamMemberInput,
  client?: TeamClient | null,
): Promise<TeamResult<RemovedTeamMember | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const memberKey = requiredText(input.member_key, "Team member is required.", 120);
  if (!memberKey.ok) return fail("invalid_input", memberKey.error);
  return callFirstRow(auth.data.client, "remove_organization_member", {
    input_organization_id: organizationId.value,
    input_member_key: memberKey.value,
  }, normalizeRemovedTeamMember);
}

export async function leaveTeam(
  input: LeaveTeamInput,
  client?: TeamClient | null,
): Promise<TeamResult<LeftTeam | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "leave_organization", {
    input_organization_id: organizationId.value,
  }, normalizeLeftTeam);
}

/** Owner-only. The server checks the typed name again and deletes the team with everything in it. */
export async function deleteTeam(
  input: DeleteTeamInput,
  client?: TeamClient | null,
): Promise<TeamResult<DeletedTeam | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const confirmationName = requiredText(input.confirmation_name, "Type the team name to confirm.", 120);
  if (!confirmationName.ok) return fail("invalid_input", confirmationName.error);
  return callFirstRow(auth.data.client, "delete_organization_team", {
    input_organization_id: organizationId.value,
    input_confirmation_name: confirmationName.value,
  }, normalizeDeletedTeam);
}

// ---------------------------------------------------------------------------
// Team shared projects: shared definitions + aggregate-only per-project totals.
// ---------------------------------------------------------------------------

function toAnchorPayload(anchors: CreateTeamProjectInput["anchors"]): { kind: string; value: string }[] {
  if (!anchors) return [];
  const payload: { kind: string; value: string }[] = [];
  for (const anchor of anchors) {
    const value = typeof anchor?.value === "string" ? anchor.value.trim() : "";
    if ((anchor?.kind === "app" || anchor?.kind === "domain" || anchor?.kind === "keyword") && value.length > 0 && value.length <= 120) {
      payload.push({ kind: anchor.kind, value });
    }
  }
  return payload.slice(0, 40);
}

function optionalDescription(value?: string | null): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
}

function optionalColor(value?: string | null): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed.slice(0, 40) : null;
}

function parseProjectWindow(input: FetchTeamProjectWindowInput) {
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return organizationId;
  const start = requiredText(input.start_date, "Project window dates are invalid.", 20);
  if (!start.ok) return start;
  const end = requiredText(input.end_date, "Project window dates are invalid.", 20);
  if (!end.ok) return end;
  if (end.value < start.value) return { ok: false as const, error: "Project window dates are invalid." };
  return {
    ok: true as const,
    value: { input_organization_id: organizationId.value, input_start_date: start.value, input_end_date: end.value },
  };
}

function sanitizeProjectEntries(entries: PublishTeamProjectTotalsInput["entries"], start: string, end: string) {
  const payload: { project_id: string; activity_date: string; seconds: number }[] = [];
  for (const entry of entries ?? []) {
    const projectId = typeof entry?.project_id === "string" ? entry.project_id.trim() : "";
    const activityDate = typeof entry?.activity_date === "string" ? entry.activity_date.trim() : "";
    const seconds = Number(entry?.seconds);
    if (projectId.length > 0 && activityDate >= start && activityDate <= end && Number.isFinite(seconds) && seconds > 0) {
      payload.push({ project_id: projectId, activity_date: activityDate, seconds: Math.round(seconds) });
    }
  }
  return payload;
}

export async function fetchTeamProjects(
  input: FetchTeamProjectsInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamProject[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_projects", {
    input_organization_id: organizationId.value,
  }, normalizeTeamProject);
}

export async function createTeamProject(
  input: CreateTeamProjectInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamProject | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const name = requiredText(input.name, "Project name is required.", 120);
  if (!name.ok) return fail("invalid_input", name.error);
  return callFirstRow(auth.data.client, "create_organization_project", {
    input_organization_id: organizationId.value,
    input_name: name.value,
    input_description: optionalDescription(input.description),
    input_color: optionalColor(input.color),
    input_anchors: toAnchorPayload(input.anchors),
  }, normalizeTeamProject);
}

export async function updateTeamProject(
  input: UpdateTeamProjectInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamProject | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const projectId = requiredText(input.project_id, "Project id is required.", 120);
  if (!projectId.ok) return fail("invalid_input", projectId.error);
  const name = requiredText(input.name, "Project name is required.", 120);
  if (!name.ok) return fail("invalid_input", name.error);
  return callFirstRow(auth.data.client, "update_organization_project", {
    input_project_id: projectId.value,
    input_name: name.value,
    input_description: optionalDescription(input.description),
    input_color: optionalColor(input.color),
    input_anchors: input.anchors === undefined ? null : toAnchorPayload(input.anchors),
  }, normalizeTeamProject);
}

export async function archiveTeamProject(
  input: ArchiveTeamProjectInput,
  client?: TeamClient | null,
): Promise<TeamResult<{ readonly id: string; readonly status: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const projectId = requiredText(input.project_id, "Project id is required.", 120);
  if (!projectId.ok) return fail("invalid_input", projectId.error);
  return callFirstRow(auth.data.client, "archive_organization_project", {
    input_project_id: projectId.value,
    input_archived: input.archived ?? true,
  }, (row) => {
    const record = (typeof row === "object" && row !== null ? row : {}) as Record<string, unknown>;
    return {
      id: typeof record.id === "string" ? record.id : "",
      status: record.status === "archived" ? "archived" : "active",
    };
  });
}

export async function publishTeamProjectTotals(
  input: PublishTeamProjectTotalsInput,
  client?: TeamClient | null,
): Promise<TeamResult<PublishedTeamProjectTotals | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const displayName = requiredText(input.display_name, "Display name is required.", 80);
  if (!displayName.ok) return fail("invalid_input", displayName.error);
  const start = requiredText(input.window_start_date, "Project window dates are invalid.", 20);
  if (!start.ok) return fail("invalid_input", start.error);
  const end = requiredText(input.window_end_date, "Project window dates are invalid.", 20);
  if (!end.ok) return fail("invalid_input", end.error);
  if (end.value < start.value) return fail("invalid_input", "Project window dates are invalid.");
  return callFirstRow(auth.data.client, "publish_organization_project_totals", {
    input_organization_id: organizationId.value,
    input_display_name: displayName.value,
    input_window_start_date: start.value,
    input_window_end_date: end.value,
    input_entries: sanitizeProjectEntries(input.entries, start.value, end.value),
  }, normalizePublishedTeamProjectTotals);
}

export async function stopTeamProjectSharing(
  input: StopTeamProjectSharingInput,
  client?: TeamClient | null,
): Promise<TeamResult<StoppedTeamProjectSharing | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "stop_organization_project_sharing", {
    input_organization_id: organizationId.value,
  }, normalizeStoppedTeamProjectSharing);
}

export async function fetchTeamProjectMix(
  input: FetchTeamProjectWindowInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamProjectMixRow[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const window = parseProjectWindow(input);
  if (!window.ok) return fail("invalid_input", window.error);
  return callRows(auth.data.client, "get_organization_project_mix", window.value, normalizeTeamProjectMixRow);
}

export async function fetchTeamProjectMemberBreakdown(
  input: FetchTeamProjectWindowInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamProjectMemberRow[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const window = parseProjectWindow(input);
  if (!window.ok) return fail("invalid_input", window.error);
  return callRows(auth.data.client, "get_organization_project_member_breakdown", window.value, normalizeTeamProjectMemberRow);
}
