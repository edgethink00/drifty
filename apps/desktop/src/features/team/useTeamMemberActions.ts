import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  fetchTeamMembers,
  isTeamErrorMessage,
  leaveTeam,
  messageFromTeamError,
  removeTeamMember,
  type LeaveTeamInput,
  type RemoveTeamMemberInput,
  type TeamMember,
} from "./teamService";

type UseTeamMemberActionsInput = {
  readonly activeTab: string;
  readonly canUseTeamServices: boolean;
  readonly selectedTeamId: string | null;
  /** Only the owner may read the roster; members never ask. */
  readonly isOwnerOf: (organizationId: string) => boolean;
  readonly requireTeamActionAccess: () => boolean;
  readonly refreshTeamDataCore: (preferredTeamId?: string | null) => Promise<string | null>;
  readonly refreshInvites: (organizationId?: string | null) => Promise<void>;
  readonly setTeamActionError: Dispatch<SetStateAction<string | null>>;
  readonly setTeamActionLoading: Dispatch<SetStateAction<boolean>>;
};

export type UseTeamMemberActionsResult = {
  /** The selected team's roster when the signed-in member owns it; empty otherwise. */
  readonly members: readonly TeamMember[];
  readonly refreshMembers: (organizationId?: string | null) => Promise<void>;
  readonly handleRemoveMember: (input: RemoveTeamMemberInput) => Promise<boolean>;
  readonly handleLeaveTeam: (input: LeaveTeamInput) => Promise<boolean>;
};

type Roster = { readonly organizationId: string; readonly members: readonly TeamMember[] };

export function useTeamMemberActions({
  activeTab,
  canUseTeamServices,
  selectedTeamId,
  isOwnerOf,
  requireTeamActionAccess,
  refreshTeamDataCore,
  refreshInvites,
  setTeamActionError,
  setTeamActionLoading,
}: UseTeamMemberActionsInput): UseTeamMemberActionsResult {
  const [roster, setRoster] = useState<Roster | null>(null);
  const selectedTeamIdRef = useRef<string | null>(selectedTeamId);

  useEffect(() => {
    selectedTeamIdRef.current = selectedTeamId;
  }, [selectedTeamId]);

  const refreshMembers = useCallback(async (organizationId?: string | null) => {
    const targetOrganizationId = organizationId === undefined ? selectedTeamIdRef.current : organizationId;
    if (!canUseTeamServices || activeTab !== "team" || !targetOrganizationId || !isOwnerOf(targetOrganizationId)) {
      setRoster(null);
      return;
    }
    const result = await fetchTeamMembers({ organization_id: targetOrganizationId });
    if (!result.success) {
      setRoster(null);
      setTeamActionError(result.error ?? "Unable to load team members.");
      return;
    }
    setRoster({ organizationId: targetOrganizationId, members: [...(result.data ?? [])] });
  }, [activeTab, canUseTeamServices, isOwnerOf, setTeamActionError]);

  const runMemberAction = useCallback(async (action: () => Promise<boolean>): Promise<boolean> => {
    setTeamActionLoading(true);
    setTeamActionError(null);
    try {
      if (!requireTeamActionAccess()) return false;
      return await action();
    } catch (error) {
      if (error instanceof Error || isTeamErrorMessage(error)) {
        setTeamActionError(messageFromTeamError(error, "Unable to complete team action."));
        return false;
      }
      throw error;
    } finally {
      setTeamActionLoading(false);
    }
  }, [requireTeamActionAccess, setTeamActionError, setTeamActionLoading]);

  const handleRemoveMember = useCallback((input: RemoveTeamMemberInput) => runMemberAction(async () => {
    const result = await removeTeamMember(input);
    if (!result.success) {
      setTeamActionError(result.error ?? "Unable to remove the member.");
      return false;
    }
    // The member count changes, and an invite link the member created is revoked.
    const refreshedTeamId = await refreshTeamDataCore(input.organization_id);
    await Promise.all([refreshMembers(refreshedTeamId), refreshInvites(refreshedTeamId)]);
    return true;
  }), [refreshInvites, refreshMembers, refreshTeamDataCore, runMemberAction, setTeamActionError]);

  const handleLeaveTeam = useCallback((input: LeaveTeamInput) => runMemberAction(async () => {
    const result = await leaveTeam(input);
    if (!result.success) {
      setTeamActionError(result.error ?? "Unable to leave the team.");
      return false;
    }
    setRoster(null);
    // The reload drops the departed team and prunes its local project mirror.
    const refreshedTeamId = await refreshTeamDataCore(null);
    await refreshInvites(refreshedTeamId);
    return true;
  }), [refreshInvites, refreshTeamDataCore, runMemberAction, setTeamActionError]);

  const members = roster && roster.organizationId === selectedTeamId ? roster.members : EMPTY_MEMBERS;
  return { members, refreshMembers, handleRemoveMember, handleLeaveTeam };
}

const EMPTY_MEMBERS: readonly TeamMember[] = [];
