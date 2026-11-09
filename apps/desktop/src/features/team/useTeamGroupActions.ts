import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createTeamGroup,
  deleteTeamGroup,
  fetchTeamBlockExclusion,
  fetchTeamGroups,
  renameTeamGroup,
  setTeamBlockExclusion,
  setTeamManagerGroups,
  setTeamMemberGroup,
  type TeamServerGroup,
} from "./teamGroupsService";
import type { TeamSeat } from "./teamSharingService";
import type { TeamGroup, TeamResult } from "./teamTypes";

type GroupState = {
  readonly organizationId: string;
  readonly groups: readonly TeamServerGroup[];
  readonly membersMayExclude: boolean;
};

export type TeamGroupActions = {
  /** The server keeps teams inside the organization; an older one offers none of the below. */
  readonly supported: boolean;
  readonly groups: readonly TeamGroup[];
  /** Each person's team by member key, as far as the seat reads people. */
  readonly memberGroups: ReadonlyMap<string, string>;
  readonly managerGroupIds: (memberKey: string) => readonly string[];
  readonly ownGroupId: string | null;
  /** The teams the viewer manages; empty when they manage the whole organization or none. */
  readonly managedGroupIds: readonly string[];
  readonly membersMayExclude: boolean;
  readonly reload: () => Promise<void>;
  readonly handleCreateGroup: (input: { readonly organization_id: string; readonly name: string; readonly parent_group_id: string | null }) => Promise<TeamGroup | null>;
  readonly handleRenameGroup: (input: { readonly group_id: string; readonly name: string }) => Promise<boolean>;
  readonly handleDeleteGroup: (input: { readonly group_id: string; readonly move_to: string | null }) => Promise<boolean>;
  readonly handleSetMemberGroup: (input: { readonly organization_id: string; readonly member_key: string; readonly group_id: string | null }) => Promise<boolean>;
  readonly setManagerGroups: (input: { readonly organization_id: string; readonly member_key: string; readonly group_ids: readonly string[] }) => Promise<TeamResult<unknown>>;
  readonly handleSetMembersMayExclude: (input: { readonly organization_id: string; readonly allowed: boolean }) => Promise<boolean>;
};

/**
 * Teams inside an organization on a server that stores them (owner decision
 * 2026-11-08): read for the selected organization whenever its people change,
 * and changed by an organization admin. Teams are one level deep.
 */
export function useTeamGroupActions(input: {
  readonly enabled: boolean;
  readonly organizationId: string | null;
  readonly seat: TeamSeat | null;
  /** Changes when the roster changes, so a move or a removal reads the teams again. */
  readonly reloadKey: unknown;
  readonly requireTeamActionAccess: () => boolean;
  readonly setTeamActionError: (error: string | null) => void;
  readonly setTeamActionLoading: (loading: boolean) => void;
}): TeamGroupActions {
  const { enabled, organizationId, seat, reloadKey, requireTeamActionAccess, setTeamActionError, setTeamActionLoading } = input;
  const [state, setState] = useState<GroupState | null>(null);
  const [supported, setSupported] = useState(true);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    if (!enabled || !organizationId) {
      setState(null);
      return;
    }
    const [groups, exclusion] = await Promise.all([
      fetchTeamGroups({ organization_id: organizationId }),
      fetchTeamBlockExclusion({ organization_id: organizationId }),
    ]);
    if (request !== requestRef.current) return;
    if (!groups.success) {
      if (groups.reason === "unsupported") setSupported(false);
      // A failed read keeps what the organization last showed.
      return;
    }
    setSupported(true);
    setState({ organizationId, groups: groups.data, membersMayExclude: exclusion.success ? exclusion.data !== false : true });
  }, [enabled, organizationId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey, seat]);

  const current = state && state.organizationId === organizationId ? state : null;
  const serverGroups = useMemo(() => current?.groups ?? [], [current]);
  const groups = useMemo<readonly TeamGroup[]>(() => serverGroups.map((group) => ({
    id: group.group_id,
    organization_id: organizationId ?? "",
    parent_group_id: null,
    name: group.name,
    lead_display_name: null,
    member_count: group.member_keys.length,
  })), [organizationId, serverGroups]);
  const memberGroups = useMemo(() => {
    const byMember = new Map<string, string>();
    for (const group of serverGroups) for (const key of group.member_keys) byMember.set(key, group.group_id);
    return byMember;
  }, [serverGroups]);
  const managerGroupIds = useCallback((memberKey: string) => serverGroups.filter((group) => group.manager_keys.includes(memberKey)).map((group) => group.group_id), [serverGroups]);
  const ownGroupId = serverGroups.find((group) => group.is_own)?.group_id ?? null;
  const managedGroupIds = useMemo(() => serverGroups.filter((group) => group.is_managed).map((group) => group.group_id), [serverGroups]);

  /** One admin change: refuses without account access, shows its error, and reads the teams again. */
  const run = useCallback(async <T,>(change: () => Promise<TeamResult<T>>, fallback: string): Promise<TeamResult<T> | null> => {
    if (!requireTeamActionAccess()) return null;
    setTeamActionLoading(true);
    setTeamActionError(null);
    try {
      const result = await change();
      if (!result.success) setTeamActionError(result.error || fallback);
      await load();
      return result;
    } finally {
      setTeamActionLoading(false);
    }
  }, [load, requireTeamActionAccess, setTeamActionError, setTeamActionLoading]);

  const handleCreateGroup = useCallback(async (create: { readonly organization_id: string; readonly name: string }) => {
    const result = await run(() => createTeamGroup({ organization_id: create.organization_id, name: create.name }), "Unable to make the team.");
    if (!result?.success || !result.data) return null;
    return { id: result.data.group_id, organization_id: create.organization_id, parent_group_id: null, name: result.data.name, lead_display_name: null, member_count: 0 };
  }, [run]);
  const handleRenameGroup = useCallback(async (rename: { readonly group_id: string; readonly name: string }) => (
    (await run(() => renameTeamGroup(rename), "Unable to rename the team."))?.success === true
  ), [run]);
  const handleDeleteGroup = useCallback(async (remove: { readonly group_id: string; readonly move_to: string | null }) => (
    (await run(() => deleteTeamGroup(remove), "Unable to delete the team."))?.success === true
  ), [run]);
  const handleSetMemberGroup = useCallback(async (move: { readonly organization_id: string; readonly member_key: string; readonly group_id: string | null }) => (
    (await run(() => setTeamMemberGroup(move), "Unable to move this person."))?.success === true
  ), [run]);
  const handleSetMembersMayExclude = useCallback(async (change: { readonly organization_id: string; readonly allowed: boolean }) => (
    (await run(() => setTeamBlockExclusion(change), "Unable to change this setting."))?.success === true
  ), [run]);

  return {
    supported: supported && current !== null,
    groups,
    memberGroups,
    managerGroupIds,
    ownGroupId,
    managedGroupIds,
    membersMayExclude: current?.membersMayExclude ?? true,
    reload: load,
    handleCreateGroup,
    handleRenameGroup,
    handleDeleteGroup,
    handleSetMemberGroup,
    setManagerGroups: setTeamManagerGroups,
    handleSetMembersMayExclude,
  };
}
