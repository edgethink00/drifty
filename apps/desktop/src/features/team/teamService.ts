import { callFirstRow, callRows, fail, invokeTeamInvite, requireAuthenticatedClient } from "./teamServiceClient";
import {
  normalizeFocusSummaryRow,
  normalizeOwnTeam,
  normalizePublishedFocusTotal,
  normalizeStoppedSharing,
  normalizeTeamInvite,
} from "./teamServiceMappers";
import { optionalText, parsePeriod, parsePublishPayload, requiredText } from "./teamServiceValidation";
import { DEFAULT_TEAM_PERIOD } from "./teamTypes";
import type {
  AcceptTeamInviteInput,
  CreateTeamInput,
  CreateTeamInviteInput,
  FetchTeamFocusSummaryInput,
  FetchTeamInvitesInput,
  OwnTeam,
  PublishedTeamFocusTotal,
  PublishTeamFocusTotalInput,
  RevokeTeamInviteInput,
  StopTeamFocusSharingInput,
  StoppedTeamFocusSharing,
  TeamClient,
  TeamFocusSummaryRow,
  TeamInvite,
  TeamInviteActionResponse,
  TeamPeriod,
  TeamResult,
} from "./teamTypes";

export { DEFAULT_TEAM_PERIOD, TEAM_PERIODS } from "./teamTypes";
export { isTeamErrorMessage, messageFromTeamError } from "./teamServiceClient";
export type {
  AcceptTeamInviteInput,
  CreateTeamInput,
  CreateTeamInviteInput,
  FetchTeamFocusSummaryInput,
  FetchTeamInvitesInput,
  OwnTeam,
  PublishedTeamFocusTotal,
  PublishTeamFocusTotalInput,
  RevokeTeamInviteInput,
  StopTeamFocusSharingInput,
  StoppedTeamFocusSharing,
  TeamClient,
  TeamFailureReason,
  TeamFocusSummaryRow,
  TeamInvite,
  TeamInviteActionResponse,
  TeamInviteStatus,
  TeamPeriod,
  TeamResult,
  TeamShareScope,
} from "./teamTypes";

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

export async function fetchTeamFocusSummary(
  input: FetchTeamFocusSummaryInput,
  client?: TeamClient | null,
): Promise<TeamResult<readonly TeamFocusSummaryRow[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const period = parsePeriod(input.period ?? DEFAULT_TEAM_PERIOD);
  if (!period.ok) return fail("invalid_input", period.error);

  return callRows(auth.data.client, "get_organization_focus_summary", {
    input_organization_id: organizationId.value,
    period_name: period.value,
  }, normalizeFocusSummaryRow);
}

export async function publishTeamFocusTotal(
  input: PublishTeamFocusTotalInput,
  client?: TeamClient | null,
): Promise<TeamResult<PublishedTeamFocusTotal | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const payload = parsePublishPayload(input);
  if (!payload.ok) return fail("invalid_input", payload.error);
  return callFirstRow(auth.data.client, "publish_organization_focus_total", payload.value, normalizePublishedFocusTotal);
}

export async function stopTeamFocusSharing(
  input: StopTeamFocusSharingInput,
  client?: TeamClient | null,
): Promise<TeamResult<StoppedTeamFocusSharing | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "stop_organization_focus_sharing", {
    input_organization_id: organizationId.value,
  }, normalizeStoppedSharing);
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
  return invokeTeamInvite({ action: "accept", inviteKey: inviteKey.value }, client);
}

export async function revokeTeamInvite(
  input: RevokeTeamInviteInput,
  client?: TeamClient | null,
): Promise<TeamResult<TeamInviteActionResponse>> {
  const inviteId = requiredText(input.invite_id, "Invite id is required.", 120);
  if (!inviteId.ok) return fail("invalid_input", inviteId.error);
  return invokeTeamInvite({ action: "revoke", inviteId: inviteId.value }, client);
}
