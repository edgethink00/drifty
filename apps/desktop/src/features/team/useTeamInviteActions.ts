import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  acceptTeamInvite,
  createTeam,
  createTeamInvite,
  fetchTeamInvites,
  isTeamErrorMessage,
  messageFromTeamError,
  revokeTeamInvite,
  type AcceptTeamInviteInput,
  type CreateTeamInput,
  type CreateTeamInviteInput,
  type RevokeTeamInviteInput,
  type TeamInvite,
} from "./teamService";

type UseTeamInviteActionsInput = {
  readonly activeTab: string;
  readonly canUseTeamServices: boolean;
  readonly selectedTeamId: string | null;
  readonly requireTeamActionAccess: () => boolean;
  readonly refreshTeamDataCore: (preferredTeamId?: string | null) => Promise<string | null>;
  readonly setTeamActionError: Dispatch<SetStateAction<string | null>>;
  readonly setTeamActionLoading: Dispatch<SetStateAction<boolean>>;
};

export type UseTeamInviteActionsResult = {
  readonly invites: readonly TeamInvite[];
  readonly refreshInvites: (organizationId?: string | null) => Promise<void>;
  readonly handleCreateTeam: (input: CreateTeamInput) => Promise<void>;
  readonly handleAcceptInvite: (input: AcceptTeamInviteInput) => Promise<void>;
  readonly handleCreateInvite: (input: CreateTeamInviteInput) => Promise<void>;
  readonly handleRevokeInvite: (input: RevokeTeamInviteInput) => Promise<void>;
};

export function useTeamInviteActions({
  activeTab,
  canUseTeamServices,
  selectedTeamId,
  requireTeamActionAccess,
  refreshTeamDataCore,
  setTeamActionError,
  setTeamActionLoading,
}: UseTeamInviteActionsInput): UseTeamInviteActionsResult {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const selectedTeamIdRef = useRef<string | null>(selectedTeamId);

  useEffect(() => {
    selectedTeamIdRef.current = selectedTeamId;
  }, [selectedTeamId]);

  const refreshInvites = useCallback(async (organizationId?: string | null) => {
    const targetOrganizationId = organizationId === undefined ? selectedTeamIdRef.current : organizationId;
    if (!canUseTeamServices || activeTab !== "team" || !targetOrganizationId) {
      setInvites([]);
      return;
    }

    const result = await fetchTeamInvites({ organization_id: targetOrganizationId });
    if (!result.success) {
      setInvites([]);
      setTeamActionError(result.error ?? "Unable to load team invites.");
      return;
    }
    setInvites([...(result.data ?? [])]);
  }, [activeTab, canUseTeamServices, setTeamActionError]);

  const runTeamAction = useCallback(async (action: () => Promise<void>) => {
    setTeamActionLoading(true);
    setTeamActionError(null);

    try {
      if (!requireTeamActionAccess()) return;
      await action();
    } catch (error) {
      if (error instanceof Error || isTeamErrorMessage(error)) { setTeamActionError(messageFromTeamError(error, "Unable to complete team action.")); return; }
      throw error;
    } finally {
      setTeamActionLoading(false);
    }
  }, [requireTeamActionAccess, setTeamActionError, setTeamActionLoading]);

  const handleCreateTeam = useCallback(async (input: CreateTeamInput) => {
    await runTeamAction(async () => {
      const result = await createTeam(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to create team.");
        return;
      }

      const organizationId = result.data?.organization_id ?? null;
      const refreshedTeamId = await refreshTeamDataCore(organizationId);
      await refreshInvites(refreshedTeamId);
    });
  }, [refreshInvites, refreshTeamDataCore, runTeamAction, setTeamActionError]);

  const handleAcceptInvite = useCallback(async (input: AcceptTeamInviteInput) => {
    await runTeamAction(async () => {
      const result = await acceptTeamInvite(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to join team.");
        return;
      }

      const organizationId = result.data.organizationId ?? null;
      const refreshedTeamId = await refreshTeamDataCore(organizationId);
      await refreshInvites(refreshedTeamId);
    });
  }, [refreshInvites, refreshTeamDataCore, runTeamAction, setTeamActionError]);

  const handleCreateInvite = useCallback(async (input: CreateTeamInviteInput) => {
    await runTeamAction(async () => {
      const result = await createTeamInvite(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to create invite.");
        return;
      }
      await refreshInvites(result.data.organizationId ?? input.organization_id);
    });
  }, [refreshInvites, runTeamAction, setTeamActionError]);

  const handleRevokeInvite = useCallback(async (input: RevokeTeamInviteInput) => {
    await runTeamAction(async () => {
      const result = await revokeTeamInvite(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to revoke invite.");
        return;
      }
      await refreshInvites(result.data.organizationId ?? selectedTeamIdRef.current);
    });
  }, [refreshInvites, runTeamAction, setTeamActionError]);

  return { invites, refreshInvites, handleCreateTeam, handleAcceptInvite, handleCreateInvite, handleRevokeInvite };
}
