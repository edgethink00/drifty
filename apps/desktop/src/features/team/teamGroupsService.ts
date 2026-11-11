/**
 * Teams inside an organization (owner decision 2026-11-08): the organization's
 * teams as the caller's seat sees them, an organization admin's changes to
 * them, and the organization's switch for keeping a Your Day block from the
 * team. Teams are one level deep; people and managers are named by member key.
 */
import { callFirstRow, callRows, fail, requireAuthenticatedClient } from "./teamServiceClient";
import { requiredText } from "./teamServiceValidation";
import type { TeamClient, TeamResult } from "./teamTypes";

/** One team of the organization, as the caller's seat reads it. */
export type TeamServerGroup = {
  readonly group_id: string;
  readonly name: string;
  /** Its people; a member reads only themselves in their own team. */
  readonly member_keys: readonly string[];
  /** Who manages it; only an organization admin reads them. */
  readonly manager_keys: readonly string[];
  readonly is_own: boolean;
  readonly is_managed: boolean;
};

function record(row: unknown): Record<string, unknown> {
  return typeof row === "object" && row !== null ? row as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function texts(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function organization(input: { readonly organization_id: string }) {
  return requiredText(input.organization_id, "Organization id is required.", 120);
}

export function normalizeTeamServerGroup(row: unknown): TeamServerGroup {
  const source = record(row);
  return {
    group_id: text(source.group_id),
    name: text(source.name),
    member_keys: texts(source.member_keys),
    manager_keys: texts(source.manager_keys),
    is_own: source.is_own === true,
    is_managed: source.is_managed === true,
  };
}

export async function fetchTeamGroups(input: { readonly organization_id: string }, client?: TeamClient | null): Promise<TeamResult<readonly TeamServerGroup[]>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callRows(auth.data.client, "get_organization_groups", { input_organization_id: organizationId.value }, normalizeTeamServerGroup);
}

export async function createTeamGroup(input: { readonly organization_id: string; readonly name: string }, client?: TeamClient | null): Promise<TeamResult<{ readonly group_id: string; readonly name: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const name = requiredText(input.name.trim(), "Team name is required.", 80);
  if (!name.ok) return fail("invalid_input", name.error);
  return callFirstRow(auth.data.client, "create_organization_group", { input_organization_id: organizationId.value, input_name: name.value }, (row) => {
    const source = record(row);
    return { group_id: text(source.group_id), name: text(source.name) };
  });
}

export async function renameTeamGroup(input: { readonly group_id: string; readonly name: string }, client?: TeamClient | null): Promise<TeamResult<{ readonly group_id: string; readonly name: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const name = requiredText(input.name.trim(), "Team name is required.", 80);
  if (!name.ok) return fail("invalid_input", name.error);
  return callFirstRow(auth.data.client, "rename_organization_group", { input_group_id: input.group_id, input_name: name.value }, (row) => {
    const source = record(row);
    return { group_id: text(source.group_id), name: text(source.name) };
  });
}

/** Deletes a team; its people move to another team, or to none. */
export async function deleteTeamGroup(input: { readonly group_id: string; readonly move_to: string | null }, client?: TeamClient | null): Promise<TeamResult<{ readonly moved_count: number } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  return callFirstRow(auth.data.client, "delete_organization_group", { input_group_id: input.group_id, input_move_to: input.move_to }, (row) => {
    const moved = record(row).moved_count;
    return { moved_count: typeof moved === "number" ? moved : 0 };
  });
}

export async function setTeamMemberGroup(input: { readonly organization_id: string; readonly member_key: string; readonly group_id: string | null }, client?: TeamClient | null): Promise<TeamResult<{ readonly member_key: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "set_organization_member_group", {
    input_organization_id: organizationId.value,
    input_member_key: input.member_key,
    input_group_id: input.group_id,
  }, (row) => ({ member_key: text(record(row).member_key) }));
}

/** The teams a manager manages; none puts them back over the whole organization. */
export async function setTeamManagerGroups(input: { readonly organization_id: string; readonly member_key: string; readonly group_ids: readonly string[] }, client?: TeamClient | null): Promise<TeamResult<{ readonly member_key: string } | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "set_organization_manager_groups", {
    input_organization_id: organizationId.value,
    input_member_key: input.member_key,
    input_group_ids: [...input.group_ids],
  }, (row) => ({ member_key: text(record(row).member_key) }));
}

/** Whether members may keep a Your Day block from this team; on unless an organization admin turned it off. */
export async function fetchTeamBlockExclusion(input: { readonly organization_id: string }, client?: TeamClient | null): Promise<TeamResult<boolean | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  return callFirstRow(auth.data.client, "get_organization_block_exclusion", { input_organization_id: organizationId.value }, (row) => record(row).members_may_exclude !== false);
}

export async function setTeamBlockExclusion(input: { readonly organization_id: string; readonly allowed: boolean }, client?: TeamClient | null): Promise<TeamResult<boolean | null>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;
  const organizationId = organization(input);
  if (!organizationId.ok) return fail("invalid_input", organizationId.error);
  const result = await callFirstRow(auth.data.client, "set_organization_block_exclusion", {
    input_organization_id: organizationId.value,
    input_members_may_exclude: input.allowed,
  }, (row) => record(row).members_may_exclude !== false);
  if (result.success && typeof window !== "undefined") window.dispatchEvent(new Event("drifty:team-exclusion-policy-changed"));
  return result;
}
