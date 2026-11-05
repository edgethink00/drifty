import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { trackerClient } from "../../lib/api/trackerClient";
import { notifyTeamProjectMirrorChanged } from "../../lib/teamProjectMirrorEvents";
import type { AuthState } from "../auth/AuthContext";
import { createTeam, fetchOwnTeams, isTeamErrorMessage, messageFromTeamError, type OwnTeam } from "./teamService";
import { deleteFormerMemberRecords, fetchScheduledTeamDeletions, fetchTeamFormerMembers, fetchTeamManagers, fetchTeamServerPolicy, renameTeam, restoreTeam, saveTeamServerPolicy, setTeamMemberRole, transferTeamOwnership, type TeamFormerMember, type TeamScheduledDeletion, type TeamServerManager, type TeamServerPolicy } from "./teamSharingService";
import type { TeamManagerAssignment, TeamSharingPolicy, TeamSharingWindow } from "./teamSharingPolicy";
import { DEFAULT_TEAM_RECORDING_SCHEDULE, type TeamTrackingPolicy } from "./teamSharingScope";
import { canInviteToTeam, isTeamAdmin, isTeamOwner, type TeamGroup } from "./teamTypes";
import { useTeamInviteActions } from "./useTeamInviteActions";
import { useTeamMemberActions } from "./useTeamMemberActions";

type TeamInviteActions = ReturnType<typeof useTeamInviteActions>;
type TeamMemberActions = ReturnType<typeof useTeamMemberActions>;

export type UseTeamControllerInput = {
  readonly activeTab: string; readonly hasRequiredAccountAuth: boolean; readonly isEffectiveAuthRequired: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
};

export type UseTeamControllerResult = {
  readonly selectedTeam: OwnTeam | null; readonly teamActionError: string | null; readonly teamActionLoading: boolean;
  readonly teamError: string | null; readonly teamLoading: boolean; readonly teamStatusMessage: string | null;
  readonly teamStatusTone: "error" | "neutral"; readonly teams: readonly OwnTeam[]; readonly invites: TeamInviteActions["invites"];
  /** Which team's links \`invites\` holds; a live controller provides it so the dialog waits for the list before making a link. */
  readonly invitesLoadedFor?: TeamInviteActions["invitesLoadedFor"];
  readonly refreshTeamData: () => Promise<void>;
  readonly handleCreateTeam: TeamInviteActions["handleCreateTeam"]; readonly handleAcceptInvite: TeamInviteActions["handleAcceptInvite"];
  readonly handleCreateInvite: TeamInviteActions["handleCreateInvite"]; readonly handleRevokeInvite: TeamInviteActions["handleRevokeInvite"];
  readonly handleSetMemberInvites: TeamInviteActions["handleSetMemberInvites"];
  readonly handleSetSharingScope: TeamInviteActions["handleSetSharingScope"];
  readonly handleSetTrackingPolicy: TeamInviteActions["handleSetTrackingPolicy"];
  /**
   * Email invites (owner decision 2026-10-29). Only a controller whose server
   * stores them provides the list and actions; without them the invite dialog
   * keeps the link and code.
   */
  readonly emailInvites?: TeamInviteActions["emailInvites"];
  readonly handleSendEmailInvites?: TeamInviteActions["handleSendEmailInvites"];
  readonly handleCancelEmailInvite?: TeamInviteActions["handleCancelEmailInvite"];
  /** Open email invites addressed to the signed-in account. */
  readonly ownEmailInvites?: TeamInviteActions["ownEmailInvites"];
  readonly members: TeamMemberActions["members"]; readonly refreshMembers: TeamMemberActions["refreshMembers"];
  readonly handleRemoveMember: TeamMemberActions["handleRemoveMember"]; readonly handleLeaveTeam: TeamMemberActions["handleLeaveTeam"];
  readonly handleDeleteTeam: TeamMemberActions["handleDeleteTeam"];
  readonly selectTeam: (organizationId: string) => void;
  /**
   * Per-item sharing, team hours and manager assignments. Only a controller
   * whose server stores them provides these; without them the surface keeps
   * the single-scope settings.
   */
  readonly managers?: readonly TeamManagerAssignment[];
  /** The viewer's own manager assignment, when they manage teams: which teams and how far they see. */
  readonly viewerAssignment?: TeamManagerAssignment | null;
  readonly handleCreateTeamWithPolicy?: (input: TeamCreateWithPolicyInput) => Promise<boolean>;
  readonly handleSetSharingPolicy?: (input: { readonly organization_id: string; readonly policy: TeamSharingPolicy }) => Promise<void>;
  /** One team's own policy, or null to put it back on the organization's default. */
  readonly handleSetGroupSharingPolicy?: (input: { readonly organization_id: string; readonly group_id: string; readonly policy: TeamSharingPolicy | null; readonly by?: "manager" }) => Promise<void>;
  readonly handleSetSharingWindow?: (input: { readonly organization_id: string; readonly window: TeamSharingWindow; readonly tracking_policy: TeamTrackingPolicy }) => Promise<void>;
  readonly handleSetManagers?: (input: { readonly organization_id: string; readonly managers: readonly TeamManagerAssignment[] }) => Promise<void>;
  /** A new team in the organization, made while assigning a manager; resolves to it, or null when it was not made. */
  readonly handleCreateGroup?: (input: { readonly organization_id: string; readonly name: string; readonly parent_group_id: string | null }) => Promise<TeamGroup | null>;
  /** Teams made through handleCreateGroup that the dashboards' data does not carry yet. */
  readonly createdGroups?: readonly TeamGroup[];
  /** A new display name for the team or organization (Settings › General); resolves to whether it was saved. */
  readonly handleRenameTeam?: (input: { readonly organization_id: string; readonly name: string }) => Promise<boolean>;
  /** Makes someone an organization admin or takes it back; only the owner may. */
  readonly handleSetMemberRole?: (input: { readonly organization_id: string; readonly member_key: string; readonly role: "admin" | "member" }) => Promise<boolean>;
  /** The owner hands the team to one of its organization admins and stays one. */
  readonly handleTransferOwnership?: (input: { readonly organization_id: string; readonly member_key: string }) => Promise<boolean>;
  /** The viewer's own teams being deleted, each kept for its owner to restore until its purge date. */
  readonly scheduledDeletions?: readonly TeamScheduledDeletion[];
  /** People who left the selected team with records still in it (2026-10-25), for the seats that see people. */
  readonly formerMembers?: readonly TeamFormerMember[];
  /** An organization admin deletes what a former member shared; resolves to whether it went through. */
  readonly handleDeleteFormerRecords?: (input: { readonly organization_id: string; readonly member_key: string }) => Promise<boolean>;
  /** Preview only: people whose shared records were deleted, left out of the preview's data. */
  readonly purgedMemberKeys?: readonly string[];
  readonly handleRestoreTeam?: (organizationId: string) => Promise<boolean>;
  /** Organization structure in the preview (Settings › Teams): rename, move under a division, or delete a team. */
  readonly handleRenameGroup?: (input: { readonly group_id: string; readonly name: string }) => Promise<boolean>;
  readonly handleMoveGroup?: (input: { readonly group_id: string; readonly parent_group_id: string | null }) => Promise<boolean>;
  /** Deletes a team; its people move to another team, or to none. */
  readonly handleDeleteGroup?: (input: { readonly group_id: string; readonly move_to: string | null }) => Promise<boolean>;
  /** What the preview changed about its teams, for the dashboards' data to follow. */
  readonly groupEdits?: TeamGroupEdits;
};

/** Renamed, moved and deleted teams, applied over the organization's data (see applyTeamGroupEdits). */
export type TeamGroupEdits = {
  readonly names: Readonly<Record<string, string>>;
  readonly parents: Readonly<Record<string, string | null>>;
  /** A deleted team and where its people went (null: no team). */
  readonly deleted: Readonly<Record<string, string | null>>;
};

export type TeamCreateWithPolicyInput = {
  readonly organizationName: string;
  readonly policy: TeamSharingPolicy;
  readonly window: TeamSharingWindow;
  readonly trackingPolicy: TeamTrackingPolicy;
};

/**
 * A team that has not saved a policy keeps what the beta shared: each person's
 * project time by day, no work titles or focus, and members see the team.
 */
export const BETA_EQUIVALENT_POLICY: TeamSharingPolicy = { projects: "member_daily", tasks: "off", focus: "off", memberSummary: true };

/** Not a real team: asking for its policy tells a server that stores sharing (it refuses) from one that does not (no such call). */
const PROBE_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000";

function managerAssignment(manager: TeamServerManager): TeamManagerAssignment {
  return {
    member_key: manager.member_key,
    display_name: manager.display_name,
    group_ids: [],
    access: manager.manager_access === "detail" ? "detail" : "summary",
    sharing: manager.manager_may_narrow ? "narrow" : "view",
  };
}

export function useTeamController(input: UseTeamControllerInput): UseTeamControllerResult {
  const { activeTab, hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, user, onAuthRequired } = input;
  const [teams, setTeams] = useState<OwnTeam[]>([]);
  /** Whether the server stores teams' sharing; until it does, the beta's settings stay. */
  const [serverSharing, setServerSharing] = useState(false);
  const serverSharingRef = useRef(false);
  /** The viewer's own deleted teams, kept for them to restore (a server that stores sharing). */
  const [scheduledDeletions, setScheduledDeletions] = useState<readonly TeamScheduledDeletion[]>([]);
  /** Each team's stored sharing and the viewer's seat in it, as the server reported them. */
  const [serverPolicies, setServerPolicies] = useState<ReadonlyMap<string, TeamServerPolicy>>(() => new Map());
  const serverPoliciesRef = useRef<ReadonlyMap<string, TeamServerPolicy>>(new Map());
  /** People who left the selected team with records still in it. */
  const [formerState, setFormerState] = useState<{ readonly organizationId: string; readonly former: readonly TeamFormerMember[] } | null>(null);
  /** The selected team's managers, read only for its organization admins. */
  const [managerState, setManagerState] = useState<{ readonly organizationId: string; readonly managers: readonly TeamManagerAssignment[] } | null>(null);
  const managerStateRef = useRef(managerState);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamHasResolvedOnce, setTeamHasResolvedOnce] = useState(false);
  const [teamHasLoadedOnce, setTeamHasLoadedOnce] = useState(false);
  const [teamRefreshing, setTeamRefreshing] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamActionLoading, setTeamActionLoading] = useState(false);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const refreshRequestRef = useRef(0); const hasResolvedOnceRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const selectedTeamIdRef = useRef<string | null>(null);
  // Read synchronously by the invite refresh that follows a team refresh,
  // before React has committed the new team list.
  const teamsRef = useRef<readonly OwnTeam[]>([]);
  const userId = user?.id ?? null;
  const teamAccessKey = JSON.stringify([isSupabaseConfigured, hasRequiredAccountAuth, userId]);
  const currentTeamAccessKeyRef = useRef(teamAccessKey);
  const currentUserIdRef = useRef(userId);
  const previousTeamAccessKeyRef = useRef(teamAccessKey);

  useLayoutEffect(() => {
    if (currentTeamAccessKeyRef.current === teamAccessKey) return;
    currentTeamAccessKeyRef.current = teamAccessKey;
    currentUserIdRef.current = userId;
    refreshRequestRef.current += 1;
  }, [teamAccessKey, userId]);

  const canUseTeamServices = isSupabaseConfigured && Boolean(user) && hasRequiredAccountAuth;
  const authRequiredMessage = isEffectiveAuthRequired
    ? "Sign in with a full drifty.so account before using Teams."
    : "Use a full drifty.so account before using Teams.";
  const selectedTeam = useMemo(() => teams.find((team) => team.organization_id === selectedTeamId) ?? null, [selectedTeamId, teams]);

  const clearTeamState = useCallback(() => {
    setTeams([]); teamsRef.current = []; setSelectedTeamId(null);
    selectedTeamIdRef.current = null;
    setServerSharing(false);
    serverPoliciesRef.current = new Map(); setServerPolicies(new Map());
    managerStateRef.current = null; setManagerState(null);
    setTeamRefreshing(false); setTeamError(null);
    hasResolvedOnceRef.current = false;
    hasLoadedOnceRef.current = false;
    setTeamHasResolvedOnce(false); setTeamHasLoadedOnce(false);
  }, []);

  const refreshTeamDataCore = useCallback(async (preferredTeamId = selectedTeamIdRef.current): Promise<string | null> => {
    const requestId = ++refreshRequestRef.current;
    const initiatingTeamAccessKey = teamAccessKey;
    const initiatingUserId = userId;
    const isCurrentRequest = () => (
      refreshRequestRef.current === requestId
      && currentTeamAccessKeyRef.current === initiatingTeamAccessKey
      && currentUserIdRef.current === initiatingUserId
    );
    const shouldPreserveState = hasLoadedOnceRef.current;

    if (!canUseTeamServices) {
      clearTeamState(); return null;
    }
    if (activeTab !== "team") return null;

    setTeamRefreshing(true);
    setTeamError(null);

    try {
      const teamsResult = await fetchOwnTeams();
      if (!isCurrentRequest()) return null;

      if (!teamsResult.success) {
        if (!shouldPreserveState) {
          setTeams([]); teamsRef.current = []; setSelectedTeamId(null);
          selectedTeamIdRef.current = null;
        }
        hasResolvedOnceRef.current = true;
        setTeamHasResolvedOnce(true);
        setTeamError(teamsResult.error ?? "Unable to load teams");
        return null;
      }

      const nextTeams = [...(teamsResult.data ?? [])];
      // A server that stores sharing (docs/teams-server-sharing.md) reports each team's policy; an older one leaves the beta's settings.
      const policies = await Promise.all(nextTeams.map((team) => fetchTeamServerPolicy({ organization_id: team.organization_id })));
      if (!isCurrentRequest()) return null;
      let stored = policies.some((result) => result.success && result.data !== null);
      if (nextTeams.length === 0) {
        // Without a team there is nothing to ask about, so ask about none: the refusal says the server stores sharing, and the first team is made with it.
        const probe = await fetchTeamServerPolicy({ organization_id: PROBE_ORGANIZATION_ID });
        if (!isCurrentRequest()) return null;
        stored = !probe.success && probe.reason === "forbidden";
      }
      setServerSharing(stored);
      serverSharingRef.current = stored;
      if (stored) {
        const scheduled = await fetchScheduledTeamDeletions();
        if (!isCurrentRequest()) return null;
        setScheduledDeletions(scheduled.success ? scheduled.data : []);
      }
      const nextPolicies = new Map<string, TeamServerPolicy>();
      if (stored) {
        for (const [index, result] of policies.entries()) {
          if (!result.success || !result.data) continue;
          const server = result.data;
          nextPolicies.set(nextTeams[index]!.organization_id, server);
          nextTeams[index] = {
            ...nextTeams[index]!,
            sharing_policy: server.policy ?? BETA_EQUIVALENT_POLICY,
            sharing_window: server.schedule ? { days: server.schedule.days, start_minute: server.schedule.start_minute, end_minute: server.schedule.end_minute, timezone: server.schedule.timezone } : DEFAULT_TEAM_RECORDING_SCHEDULE,
            tracking_policy: server.tracking_policy,
          };
        }
      }
      serverPoliciesRef.current = nextPolicies;
      setServerPolicies(nextPolicies);
      const nextSelectedTeamId = chooseSelectedTeamId(nextTeams, preferredTeamId);
      // The organization admin edits managers; nobody else reads who they are.
      let nextManagers: { readonly organizationId: string; readonly managers: readonly TeamManagerAssignment[] } | null = null;
      if (nextSelectedTeamId && nextPolicies.get(nextSelectedTeamId)?.seat === "admin") {
        const managersResult = await fetchTeamManagers({ organization_id: nextSelectedTeamId });
        if (!isCurrentRequest()) return null;
        if (managersResult.success) nextManagers = { organizationId: nextSelectedTeamId, managers: managersResult.data.map(managerAssignment) };
      }
      managerStateRef.current = nextManagers;
      setManagerState(nextManagers);

      setTeams(nextTeams);
      teamsRef.current = nextTeams;
      void pruneDepartedTeamMirrors(nextTeams);
      setSelectedTeamId(nextSelectedTeamId);
      selectedTeamIdRef.current = nextSelectedTeamId;
      hasResolvedOnceRef.current = true;
      hasLoadedOnceRef.current = true;
      setTeamHasResolvedOnce(true);
      setTeamHasLoadedOnce(true);
      setTeamError(null);
      return nextSelectedTeamId;
    } catch (error) {
      if (!isCurrentRequest()) return null;
      if (!shouldPreserveState) {
        setTeams([]); teamsRef.current = []; setSelectedTeamId(null);
        selectedTeamIdRef.current = null;
      }
      hasResolvedOnceRef.current = true;
      setTeamHasResolvedOnce(true);
      if (error instanceof Error || isTeamErrorMessage(error)) { setTeamError(messageFromTeamError(error, "Unable to load teams")); return null; }
      throw error;
    } finally {
      if (isCurrentRequest()) setTeamRefreshing(false);
    }
  }, [activeTab, canUseTeamServices, clearTeamState, teamAccessKey, userId]);

  const requireTeamActionAccess = useCallback(() => {
    if (!isSupabaseConfigured) {
      setTeamActionError("Supabase is not configured.");
      return false;
    }
    if (!user || !hasRequiredAccountAuth) {
      onAuthRequired();
      setTeamActionError(authRequiredMessage);
      return false;
    }
    if (activeTab !== "team") {
      setTeamActionError("Open Teams before changing sharing.");
      return false;
    }
    return true;
  }, [activeTab, authRequiredMessage, hasRequiredAccountAuth, isSupabaseConfigured, onAuthRequired, user]);

  const canViewInvites = useCallback((organizationId: string) => (
    canInviteToTeam(teamsRef.current.find((team) => team.organization_id === organizationId))
  ), []);

  const {
    invites, invitesLoadedFor, emailInvites, emailInvitesSupported, ownEmailInvites, refreshInvites, refreshOwnEmailInvites,
    handleCreateTeam, handleAcceptInvite, handleCreateInvite, handleRevokeInvite, handleSendEmailInvites, handleCancelEmailInvite,
    handleSetMemberInvites, handleSetSharingScope, handleSetTrackingPolicy,
  } = useTeamInviteActions({ activeTab, canUseTeamServices, selectedTeamId, canViewInvites, requireTeamActionAccess, refreshTeamDataCore, setTeamActionError, setTeamActionLoading });

  // Members are read by the owner, and by every organization admin on a server that stores sharing.
  const isOwnerOf = useCallback((organizationId: string) => {
    const team = teamsRef.current.find((candidate) => candidate.organization_id === organizationId);
    return serverSharingRef.current ? isTeamAdmin(team) : isTeamOwner(team);
  }, []);

  const { members, refreshMembers, handleRemoveMember, handleLeaveTeam, handleDeleteTeam } = useTeamMemberActions({ activeTab, canUseTeamServices, selectedTeamId, isOwnerOf, requireTeamActionAccess, refreshTeamDataCore, refreshInvites, setTeamActionError, setTeamActionLoading });

  const refreshTeamData = useCallback(async (preferredTeamId = selectedTeamIdRef.current) => {
    const refreshedTeamId = await refreshTeamDataCore(preferredTeamId);
    await Promise.all([refreshInvites(refreshedTeamId), refreshOwnEmailInvites()]);
  }, [refreshInvites, refreshOwnEmailInvites, refreshTeamDataCore]);

  useEffect(() => {
    const accessChanged = previousTeamAccessKeyRef.current !== teamAccessKey;
    if (accessChanged) {
      previousTeamAccessKeyRef.current = teamAccessKey;
      clearTeamState();
      void refreshInvites(null);
    }

    if (!isSupabaseConfigured || !user || !hasRequiredAccountAuth) {
      if (!accessChanged) clearTeamState();
      void refreshInvites(null);
      return;
    }

    if (activeTab === "team") void refreshTeamData();
  }, [activeTab, clearTeamState, hasRequiredAccountAuth, isSupabaseConfigured, refreshInvites, refreshTeamData, teamAccessKey, user]);

  const selectTeam = useCallback((organizationId: string) => {
    selectedTeamIdRef.current = organizationId;
    setSelectedTeamId(organizationId);
    if (activeTab === "team") void refreshTeamData(organizationId);
  }, [activeTab, refreshTeamData]);

  /** Saves a team's sharing on the server, keeping whatever the change leaves alone (the server keeps omitted hours). */
  const saveServerSharing = useCallback(async (organizationId: string, change: {
    readonly policy?: TeamSharingPolicy;
    readonly window?: TeamSharingWindow;
    readonly tracking_policy?: TeamTrackingPolicy;
  }): Promise<boolean> => {
    if (!requireTeamActionAccess()) return false;
    const team = teamsRef.current.find((candidate) => candidate.organization_id === organizationId);
    const stored = serverPoliciesRef.current.get(organizationId);
    setTeamActionLoading(true);
    setTeamActionError(null);
    try {
      const result = await saveTeamServerPolicy({
        organization_id: organizationId,
        policy: change.policy ?? team?.sharing_policy ?? BETA_EQUIVALENT_POLICY,
        ...(change.tracking_policy ? { tracking_policy: change.tracking_policy } : {}),
        ...(change.window ? { schedule: { ...change.window, clock: stored?.schedule?.clock ?? "team" } } : {}),
      });
      if (!result.success) {
        setTeamActionError(result.error || "Unable to save the team's sharing.");
        return false;
      }
      await refreshTeamData(organizationId);
      return true;
    } finally {
      setTeamActionLoading(false);
    }
  }, [refreshTeamData, requireTeamActionAccess]);

  const handleSetSharingPolicy = useCallback(async (input: { readonly organization_id: string; readonly policy: TeamSharingPolicy }) => {
    await saveServerSharing(input.organization_id, { policy: input.policy });
  }, [saveServerSharing]);

  const handleSetSharingWindow = useCallback(async (input: { readonly organization_id: string; readonly window: TeamSharingWindow; readonly tracking_policy: TeamTrackingPolicy }) => {
    await saveServerSharing(input.organization_id, { window: input.window, tracking_policy: input.tracking_policy });
  }, [saveServerSharing]);

  const handleRenameTeam = useCallback(async (input: { readonly organization_id: string; readonly name: string }): Promise<boolean> => {
    if (!requireTeamActionAccess()) return false;
    setTeamActionLoading(true);
    setTeamActionError(null);
    try {
      const result = await renameTeam(input);
      if (!result.success) {
        setTeamActionError(result.error || "Unable to rename the team.");
        return false;
      }
      await refreshTeamData(input.organization_id);
      return true;
    } finally {
      setTeamActionLoading(false);
    }
  }, [refreshTeamData, requireTeamActionAccess]);

  /** One server call, then the team and its members read again; resolves to whether it went through. */
  const runTeamChange = useCallback(async (organizationId: string, call: () => Promise<{ readonly success: boolean; readonly error?: string | null }>, failure: string): Promise<boolean> => {
    if (!requireTeamActionAccess()) return false;
    setTeamActionLoading(true);
    setTeamActionError(null);
    try {
      const result = await call();
      if (!result.success) {
        setTeamActionError(result.error || failure);
        return false;
      }
      await refreshTeamData(organizationId);
      await refreshMembers(organizationId);
      return true;
    } finally {
      setTeamActionLoading(false);
    }
  }, [refreshMembers, refreshTeamData, requireTeamActionAccess]);

  const handleSetMemberRole = useCallback((input: { readonly organization_id: string; readonly member_key: string; readonly role: "admin" | "member" }) => (
    runTeamChange(input.organization_id, () => setTeamMemberRole(input), "Unable to change the role.")
  ), [runTeamChange]);

  const handleTransferOwnership = useCallback((input: { readonly organization_id: string; readonly member_key: string }) => (
    runTeamChange(input.organization_id, () => transferTeamOwnership(input), "Unable to hand the team over.")
  ), [runTeamChange]);

  // Who left with records still in the team, read again whenever the roster changes; seats that may not read it get none.
  useEffect(() => {
    if (!serverSharing || !selectedTeamId) return;
    let current = true;
    void fetchTeamFormerMembers({ organization_id: selectedTeamId }).then((result) => {
      if (current) setFormerState({ organizationId: selectedTeamId, former: result.success ? result.data : [] });
    });
    return () => { current = false; };
  }, [members, selectedTeamId, serverSharing]);
  const formerMembers = formerState && formerState.organizationId === selectedTeamId ? formerState.former : [];
  const handleDeleteFormerRecords = useCallback(async (input: { readonly organization_id: string; readonly member_key: string }) => {
    const done = await runTeamChange(input.organization_id, () => deleteFormerMemberRecords(input), "Unable to delete the records.");
    if (done) setFormerState((state) => (state ? { ...state, former: state.former.filter((person) => person.member_key !== input.member_key) } : state));
    return done;
  }, [runTeamChange]);

  const handleRestoreTeam = useCallback((organizationId: string) => (
    runTeamChange(organizationId, () => restoreTeam({ organization_id: organizationId }), "Unable to restore the team.")
  ), [runTeamChange]);

  /** A new team with its sharing chosen up front; the team stays made even if its sharing could not be saved, and says so. */
  const handleCreateTeamWithPolicy = useCallback(async (input: TeamCreateWithPolicyInput): Promise<boolean> => {
    if (!requireTeamActionAccess()) return false;
    setTeamActionLoading(true);
    setTeamActionError(null);
    try {
      const created = await createTeam({ organizationName: input.organizationName });
      if (!created.success || !created.data) {
        setTeamActionError((!created.success && created.error) || "Unable to create team.");
        return false;
      }
      const organizationId = created.data.organization_id;
      const saved = await saveTeamServerPolicy({
        organization_id: organizationId,
        policy: input.policy,
        tracking_policy: input.trackingPolicy,
        schedule: { ...input.window, clock: "team" },
      });
      await refreshTeamData(organizationId);
      if (!saved.success) setTeamActionError("The team was made, but its sharing was not saved. Set it in Settings before inviting anyone.");
      return true;
    } finally {
      setTeamActionLoading(false);
    }
  }, [refreshTeamData, requireTeamActionAccess]);

  /** Makes, changes and unmakes managers by what changed against the server's list. */
  const handleSetManagers = useCallback(async (input: { readonly organization_id: string; readonly managers: readonly TeamManagerAssignment[] }) => {
    if (!requireTeamActionAccess()) return;
    const current = managerStateRef.current;
    const previous = current && current.organizationId === input.organization_id ? current.managers : [];
    const kept = new Set(input.managers.map((manager) => manager.member_key));
    const changes = [
      ...previous.filter((manager) => !kept.has(manager.member_key)).map((manager) => ({ member_key: manager.member_key, role: "member" as const })),
      ...input.managers
        .filter((manager) => {
          const before = previous.find((candidate) => candidate.member_key === manager.member_key);
          return !before || before.access !== manager.access || (before.sharing ?? "view") !== (manager.sharing ?? "view");
        })
        .map((manager) => ({
          member_key: manager.member_key,
          role: "manager" as const,
          manager_access: manager.access === "detail" ? "detail" as const : "totals" as const,
          manager_may_narrow: manager.sharing === "narrow",
        })),
    ];
    if (changes.length === 0) return;
    setTeamActionLoading(true);
    setTeamActionError(null);
    try {
      for (const change of changes) {
        const result = await setTeamMemberRole({ organization_id: input.organization_id, ...change });
        if (!result.success) {
          setTeamActionError(result.error || "Unable to change a manager.");
          break;
        }
      }
      await refreshTeamData(input.organization_id);
    } finally {
      setTeamActionLoading(false);
    }
  }, [refreshTeamData, requireTeamActionAccess]);

  // A manager's seat comes from the server: the whole team (no divisions yet), with people only when granted.
  const viewerAssignment = useMemo<TeamManagerAssignment | null>(() => {
    const server = selectedTeam ? serverPolicies.get(selectedTeam.organization_id) : undefined;
    if (!selectedTeam || !server || server.seat !== "manager") return null;
    return {
      member_key: "self",
      display_name: selectedTeam.member_display_name,
      group_ids: [],
      access: server.manager_access === "detail" ? "detail" : "summary",
      sharing: server.manager_may_narrow ? "narrow" : "view",
    };
  }, [selectedTeam, serverPolicies]);
  const managers = managerState && managerState.organizationId === selectedTeamId ? managerState.managers : [];

  // Enter the loading screen on the first render, before the fetch effect.
  // A successful empty list is already resolved and can refresh in place.
  const teamBlockingLoading = canUseTeamServices && activeTab === "team"
    && (!teamHasResolvedOnce || (teamRefreshing && !teamHasLoadedOnce));
  const teamBlockingError = teamHasLoadedOnce ? null : teamError;
  const teamRefreshStatus = teamRefreshing && teamHasResolvedOnce ? "Refreshing teams" : null;
  const teamBackgroundError = teamHasLoadedOnce ? teamError : null;
  const teamStatusMessage = teamBackgroundError ?? teamRefreshStatus;
  const teamStatusTone = teamBackgroundError ? "error" : "neutral";

  return {
    selectedTeam, teamActionError, teamActionLoading, teamError: teamBlockingError,
    teamLoading: teamBlockingLoading, teamStatusMessage, teamStatusTone, teams, invites, invitesLoadedFor, handleCreateTeam, handleAcceptInvite, handleCreateInvite, handleRevokeInvite, handleSetMemberInvites,
    handleSetSharingScope, handleSetTrackingPolicy,
    members, refreshMembers, handleRemoveMember, handleLeaveTeam, handleDeleteTeam,
    refreshTeamData, selectTeam,
    ownEmailInvites,
    // A server without email invites keeps the dialog's link and code.
    ...(emailInvitesSupported !== false ? { emailInvites, handleSendEmailInvites, handleCancelEmailInvite } : {}),
    // Only a server that stores sharing gets the per-item editor, hours, managers and the create flow with sharing.
    ...(serverSharing ? { managers, viewerAssignment, handleCreateTeamWithPolicy, handleSetSharingPolicy, handleSetSharingWindow, handleSetManagers, handleRenameTeam, handleSetMemberRole, handleTransferOwnership, scheduledDeletions, handleRestoreTeam, formerMembers, handleDeleteFormerRecords } : {}),
  };
}

// A successful team list is authoritative: a team that left it (the member left
// or was removed) must stop shaping local project classification, so its local
// project mirror is cleared. A failed load never prunes.
async function pruneDepartedTeamMirrors(teams: readonly OwnTeam[]): Promise<void> {
  const currentTeamIds = new Set(teams.map((team) => team.organization_id));
  let pruned = 0;
  try {
    const localProjects = await trackerClient.getTeamProjects();
    const departedTeamIds = new Set(
      localProjects.map((project) => project.organizationId).filter((organizationId) => organizationId && !currentTeamIds.has(organizationId)),
    );
    for (const organizationId of departedTeamIds) {
      await trackerClient.upsertTeamProjects(organizationId, []);
      pruned += 1;
    }
  } catch {
    // Best effort: the next successful load tries again.
  } finally {
    // Project analysis counts team projects too, so tell it the mirror shrank.
    if (pruned > 0) notifyTeamProjectMirrorChanged();
  }
}

function chooseSelectedTeamId(teams: readonly OwnTeam[], preferredTeamId: string | null): string | null {
  if (preferredTeamId && teams.some((team) => team.organization_id === preferredTeamId)) return preferredTeamId;
  return teams[0]?.organization_id ?? null;
}
