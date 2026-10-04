import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AuthState } from "../auth/AuthContext";
import { fetchOwnTeams, isTeamErrorMessage, messageFromTeamError, type OwnTeam } from "./teamService";
import { canInviteToTeam } from "./teamTypes";
import { useTeamInviteActions } from "./useTeamInviteActions";

type TeamInviteActions = ReturnType<typeof useTeamInviteActions>;

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
  readonly refreshTeamData: () => Promise<void>;
  readonly handleCreateTeam: TeamInviteActions["handleCreateTeam"]; readonly handleAcceptInvite: TeamInviteActions["handleAcceptInvite"];
  readonly handleCreateInvite: TeamInviteActions["handleCreateInvite"]; readonly handleRevokeInvite: TeamInviteActions["handleRevokeInvite"];
  readonly handleSetMemberInvites: TeamInviteActions["handleSetMemberInvites"];
  readonly selectTeam: (organizationId: string) => void;
};

export function useTeamController(input: UseTeamControllerInput): UseTeamControllerResult {
  const { activeTab, hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, user, onAuthRequired } = input;
  const [teams, setTeams] = useState<OwnTeam[]>([]);
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
      const nextSelectedTeamId = chooseSelectedTeamId(nextTeams, preferredTeamId);

      setTeams(nextTeams);
      teamsRef.current = nextTeams;
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

  const { invites, refreshInvites, handleCreateTeam, handleAcceptInvite, handleCreateInvite, handleRevokeInvite, handleSetMemberInvites } = useTeamInviteActions({ activeTab, canUseTeamServices, selectedTeamId, canViewInvites, requireTeamActionAccess, refreshTeamDataCore, setTeamActionError, setTeamActionLoading });

  const refreshTeamData = useCallback(async (preferredTeamId = selectedTeamIdRef.current) => {
    const refreshedTeamId = await refreshTeamDataCore(preferredTeamId);
    await refreshInvites(refreshedTeamId);
  }, [refreshInvites, refreshTeamDataCore]);

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

  const teamBlockingLoading = teamRefreshing && !teamHasResolvedOnce;
  const teamBlockingError = teamHasLoadedOnce ? null : teamError;
  const teamRefreshStatus = teamRefreshing && teamHasResolvedOnce ? "Refreshing teams" : null;
  const teamBackgroundError = teamHasLoadedOnce ? teamError : null;
  const teamStatusMessage = teamBackgroundError ?? teamRefreshStatus;
  const teamStatusTone = teamBackgroundError ? "error" : "neutral";

  return {
    selectedTeam, teamActionError, teamActionLoading, teamError: teamBlockingError,
    teamLoading: teamBlockingLoading, teamStatusMessage, teamStatusTone, teams, invites, handleCreateTeam, handleAcceptInvite, handleCreateInvite, handleRevokeInvite, handleSetMemberInvites,
    refreshTeamData, selectTeam,
  };
}

function chooseSelectedTeamId(teams: readonly OwnTeam[], preferredTeamId: string | null): string | null {
  if (preferredTeamId && teams.some((team) => team.organization_id === preferredTeamId)) return preferredTeamId;
  return teams[0]?.organization_id ?? null;
}
