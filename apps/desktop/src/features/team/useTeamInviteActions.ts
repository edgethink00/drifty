import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  acceptTeamInvite,
  cancelTeamEmailInvite,
  createTeam,
  createTeamInvite,
  fetchOwnEmailInvites,
  fetchTeamEmailInvites,
  fetchTeamInvites,
  isTeamErrorMessage,
  messageFromTeamError,
  revokeTeamInvite,
  sendTeamEmailInvites,
  setTeamMemberInvites,
  setTeamSharingScope,
  setTeamTrackingPolicy,
  type AcceptTeamInviteInput,
  type CancelTeamEmailInviteInput,
  type CreateTeamInput,
  type CreateTeamInviteInput,
  type OwnEmailInvite,
  type RevokeTeamInviteInput,
  type SendTeamEmailInvitesInput,
  type SetTeamMemberInvitesInput,
  type SetTeamSharingScopeInput,
  type SetTeamTrackingPolicyInput,
  type TeamEmailInvite,
  type TeamEmailInviteResult,
  type TeamFailureReason,
  type TeamInvite,
  type TeamInviteActionResponse,
} from "./teamService";

type UseTeamInviteActionsInput = {
  readonly activeTab: string;
  readonly canUseTeamServices: boolean;
  readonly selectedTeamId: string | null;
  /** Whether the signed-in member may read and create invites for a team. */
  readonly canViewInvites: (organizationId: string) => boolean;
  readonly requireTeamActionAccess: () => boolean;
  readonly refreshTeamDataCore: (preferredTeamId?: string | null) => Promise<string | null>;
  readonly setTeamActionError: Dispatch<SetStateAction<string | null>>;
  readonly setTeamActionLoading: Dispatch<SetStateAction<boolean>>;
};

/** A send either reports each address or fails whole (no permission, no connection). */
export type TeamEmailInviteSendOutcome =
  | { readonly ok: true; readonly results: readonly TeamEmailInviteResult[] }
  | { readonly ok: false; readonly reason: TeamFailureReason; readonly error: string };

export type UseTeamInviteActionsResult = {
  readonly invites: readonly TeamInvite[];
  readonly emailInvites: readonly TeamEmailInvite[];
  /** False once the server reports it has no email invites; null until a list has been read. */
  readonly emailInvitesSupported: boolean | null;
  readonly ownEmailInvites: readonly OwnEmailInvite[];
  readonly refreshInvites: (organizationId?: string | null) => Promise<void>;
  readonly refreshOwnEmailInvites: () => Promise<void>;
  readonly handleCreateTeam: (input: CreateTeamInput) => Promise<void>;
  readonly handleAcceptInvite: (input: AcceptTeamInviteInput) => Promise<boolean>;
  readonly handleCreateInvite: (input: CreateTeamInviteInput) => Promise<void>;
  readonly handleRevokeInvite: (input: RevokeTeamInviteInput) => Promise<void>;
  readonly handleSendEmailInvites: (input: SendTeamEmailInvitesInput) => Promise<TeamEmailInviteSendOutcome>;
  readonly handleCancelEmailInvite: (input: CancelTeamEmailInviteInput) => Promise<boolean>;
  readonly handleSetMemberInvites: (input: SetTeamMemberInvitesInput) => Promise<void>;
  readonly handleSetSharingScope: (input: SetTeamSharingScopeInput) => Promise<void>;
  readonly handleSetTrackingPolicy: (input: SetTeamTrackingPolicyInput) => Promise<void>;
};

/**
 * The live invite a create response describes, in the shape the invite list
 * returns, so the dialog can show the link without reading the list again.
 * The link carries only the code, exactly as the list's link does; the create
 * response's bearer token is not put on screen. Null when the response lacks a
 * field (an older function), so the caller falls back to reading the list.
 */
export function inviteFromCreateResponse(response: TeamInviteActionResponse | undefined, organizationId: string, nowIso = new Date().toISOString()): TeamInvite | null {
  if (!response?.inviteId || !response.inviteCode || !response.expiresAt) return null;
  return {
    invite_id: response.inviteId,
    organization_id: response.organizationId ?? organizationId,
    organization_name: response.organizationName ?? "",
    invite_code: response.inviteCode,
    invite_url: "/team-invite?code=" + encodeURIComponent(response.inviteCode),
    role_label: response.roleLabel ?? "Member",
    status: "pending",
    expires_at: response.expiresAt,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export function useTeamInviteActions({
  activeTab,
  canUseTeamServices,
  selectedTeamId,
  canViewInvites,
  requireTeamActionAccess,
  refreshTeamDataCore,
  setTeamActionError,
  setTeamActionLoading,
}: UseTeamInviteActionsInput): UseTeamInviteActionsResult {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [emailInvites, setEmailInvites] = useState<readonly TeamEmailInvite[]>([]);
  const [emailInvitesSupported, setEmailInvitesSupported] = useState<boolean | null>(null);
  const [ownEmailInvites, setOwnEmailInvites] = useState<readonly OwnEmailInvite[]>([]);
  const selectedTeamIdRef = useRef<string | null>(selectedTeamId);

  useEffect(() => {
    selectedTeamIdRef.current = selectedTeamId;
  }, [selectedTeamId]);

  /** The team's email invites. A server without them says so once, and the dialog keeps the link only. */
  const refreshEmailInvites = useCallback(async (organizationId: string) => {
    const result = await fetchTeamEmailInvites({ organization_id: organizationId });
    if (!result.success) {
      setEmailInvites([]);
      if (result.reason === "unsupported") setEmailInvitesSupported(false);
      return;
    }
    setEmailInvitesSupported(true);
    setEmailInvites(result.data);
  }, []);

  const refreshInvites = useCallback(async (organizationId?: string | null) => {
    const targetOrganizationId = organizationId === undefined ? selectedTeamIdRef.current : organizationId;
    // Members without invite permission cannot read invites; asking would only
    // surface a permission error in the team modals.
    if (!canUseTeamServices || activeTab !== "team" || !targetOrganizationId || !canViewInvites(targetOrganizationId)) {
      setInvites([]);
      setEmailInvites([]);
      return;
    }

    const [result] = await Promise.all([
      fetchTeamInvites({ organization_id: targetOrganizationId }),
      refreshEmailInvites(targetOrganizationId),
    ]);
    if (!result.success) {
      setInvites([]);
      setTeamActionError(result.error ?? "Unable to load team invites.");
      return;
    }
    setInvites([...(result.data ?? [])]);
  }, [activeTab, canUseTeamServices, canViewInvites, refreshEmailInvites, setTeamActionError]);

  /** Email invites addressed to the signed-in account, offered on the Team page without the mailed link. */
  const refreshOwnEmailInvites = useCallback(async () => {
    if (!canUseTeamServices || activeTab !== "team") {
      setOwnEmailInvites([]);
      return;
    }
    const result = await fetchOwnEmailInvites();
    setOwnEmailInvites(result.success ? result.data : []);
  }, [activeTab, canUseTeamServices]);

  const runTeamAction = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setTeamActionLoading(true);
    setTeamActionError(null);

    try {
      if (!requireTeamActionAccess()) return;
      return await action();
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
    const accepted = await runTeamAction(async () => {
      const result = await acceptTeamInvite(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to join team.");
        return false;
      }

      const organizationId = result.data.organizationId ?? null;
      const refreshedTeamId = await refreshTeamDataCore(organizationId);
      await refreshInvites(refreshedTeamId);
      void refreshOwnEmailInvites();
      return true;
    });
    return accepted === true;
  }, [refreshInvites, refreshOwnEmailInvites, refreshTeamDataCore, runTeamAction, setTeamActionError]);

  const handleCreateInvite = useCallback(async (input: CreateTeamInviteInput) => {
    await runTeamAction(async () => {
      const result = await createTeamInvite(input);
      if (!result.success) {
        // A member is refused when a link is already live; show that link with the message.
        await refreshInvites(input.organization_id);
        setTeamActionError(result.error ?? "Unable to create invite.");
        return;
      }
      // One round trip: the create response already holds the new link, so the
      // dialog shows it at once instead of waiting for a second read of the list.
      const created = inviteFromCreateResponse(result.data, input.organization_id);
      if (created) {
        setInvites((current) => [created, ...current.filter((invite) => invite.invite_id !== created.invite_id)]);
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

  // The dialog shows its own progress and outcome, so a send leaves the page's
  // shared loading flag and error banner alone.
  const handleSendEmailInvites = useCallback(async (input: SendTeamEmailInvitesInput): Promise<TeamEmailInviteSendOutcome> => {
    if (!requireTeamActionAccess()) return { ok: false, reason: "not_authenticated", error: "" };
    const result = await sendTeamEmailInvites(input);
    if (!result.success) return { ok: false, reason: result.reason, error: result.error };
    void refreshEmailInvites(input.organization_id);
    return { ok: true, results: result.data };
  }, [refreshEmailInvites, requireTeamActionAccess]);

  const handleCancelEmailInvite = useCallback(async (input: CancelTeamEmailInviteInput) => {
    if (!requireTeamActionAccess()) return false;
    let removed: TeamEmailInvite | undefined;
    setEmailInvites((current) => {
      removed = current.find((invite) => invite.invite_id === input.invite_id);
      return current.filter((invite) => invite.invite_id !== input.invite_id);
    });
    const result = await cancelTeamEmailInvite(input);
    if (result.success) return true;
    const restored = removed;
    if (restored) setEmailInvites((current) => [restored, ...current]);
    setTeamActionError(result.error || "Unable to cancel the invite.");
    return false;
  }, [requireTeamActionAccess, setTeamActionError]);

  const handleSetMemberInvites = useCallback(async (input: SetTeamMemberInvitesInput) => {
    await runTeamAction(async () => {
      const result = await setTeamMemberInvites(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to change who can invite.");
        return;
      }
      const refreshedTeamId = await refreshTeamDataCore(input.organization_id);
      await refreshInvites(refreshedTeamId);
    });
  }, [refreshInvites, refreshTeamDataCore, runTeamAction, setTeamActionError]);

  const handleSetSharingScope = useCallback(async (input: SetTeamSharingScopeInput) => {
    await runTeamAction(async () => {
      const result = await setTeamSharingScope(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to change what the team shares.");
        return;
      }
      await refreshTeamDataCore(input.organization_id);
    });
  }, [refreshTeamDataCore, runTeamAction, setTeamActionError]);

  const handleSetTrackingPolicy = useCallback(async (input: SetTeamTrackingPolicyInput) => {
    await runTeamAction(async () => {
      const result = await setTeamTrackingPolicy(input);
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to change the tracking policy.");
        return;
      }
      await refreshTeamDataCore(input.organization_id);
    });
  }, [refreshTeamDataCore, runTeamAction, setTeamActionError]);

  return {
    invites,
    emailInvites,
    emailInvitesSupported,
    ownEmailInvites,
    refreshInvites,
    refreshOwnEmailInvites,
    handleCreateTeam,
    handleAcceptInvite,
    handleCreateInvite,
    handleRevokeInvite,
    handleSendEmailInvites,
    handleCancelEmailInvite,
    handleSetMemberInvites,
    handleSetSharingScope,
    handleSetTrackingPolicy,
  };
}
