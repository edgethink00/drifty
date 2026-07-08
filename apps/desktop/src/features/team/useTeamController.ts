import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import type { AuthState } from "../auth/AuthContext";
import { buildTeamFocusAggregate, getTeamFocusWindow, type TeamFocusAggregate } from "./teamAggregate";
import { DEFAULT_TEAM_PERIOD, fetchOwnTeams, fetchTeamFocusSummary, fetchTeamLiveStatus, isTeamErrorMessage, messageFromTeamError, publishTeamFocusTotal, stopTeamFocusSharing, type OwnTeam, type TeamFocusSummaryRow, type TeamLiveStatusRow, type TeamPeriod, type TeamResult } from "./teamService";
import { useTeamInviteActions } from "./useTeamInviteActions";

type TeamInviteActions = ReturnType<typeof useTeamInviteActions>;

export type UseTeamControllerInput = {
  readonly activeTab: string; readonly hasRequiredAccountAuth: boolean; readonly isEffectiveAuthRequired: boolean;
  readonly isSupabaseConfigured: boolean; readonly showAiClassificationImpact: boolean; readonly startOfDayMinutes: number;
  readonly currentDay?: string | null; readonly timezone?: string | null;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
};

export type UseTeamControllerResult = {
  readonly activeTeamPeriod: TeamPeriod; readonly liveRows: readonly TeamLiveStatusRow[]; readonly localAggregate: TeamFocusAggregate | null; readonly rows: readonly TeamFocusSummaryRow[];
  readonly selectedTeam: OwnTeam | null; readonly teamActionError: string | null; readonly teamActionLoading: boolean;
  readonly teamError: string | null; readonly teamLoading: boolean; readonly teamStatusMessage: string | null;
  readonly teamStatusTone: "error" | "neutral"; readonly teams: readonly OwnTeam[]; readonly invites: TeamInviteActions["invites"];
  readonly handlePublishTeamFocus: () => Promise<void>; readonly handleStopTeamFocusSharing: () => Promise<void>; readonly refreshTeamData: () => Promise<void>;
  readonly handleCreateTeam: TeamInviteActions["handleCreateTeam"]; readonly handleAcceptInvite: TeamInviteActions["handleAcceptInvite"];
  readonly handleCreateInvite: TeamInviteActions["handleCreateInvite"]; readonly handleRevokeInvite: TeamInviteActions["handleRevokeInvite"];
  readonly selectTeam: (organizationId: string) => void;
  readonly setActiveTeamPeriod: Dispatch<SetStateAction<TeamPeriod>>;
};

export function useTeamController(input: UseTeamControllerInput): UseTeamControllerResult {
  const { activeTab, hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, showAiClassificationImpact, startOfDayMinutes, currentDay, timezone, user, onAuthRequired } = input;
  const [activeTeamPeriod, setActiveTeamPeriod] = useState<TeamPeriod>(DEFAULT_TEAM_PERIOD);
  const [teams, setTeams] = useState<OwnTeam[]>([]);
  const [rows, setRows] = useState<TeamFocusSummaryRow[]>([]);
  const [liveRows, setLiveRows] = useState<TeamLiveStatusRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [localAggregate, setLocalAggregate] = useState<TeamFocusAggregate | null>(null);
  const [teamHasResolvedOnce, setTeamHasResolvedOnce] = useState(false);
  const [teamHasLoadedOnce, setTeamHasLoadedOnce] = useState(false);
  const [teamRefreshing, setTeamRefreshing] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamActionLoading, setTeamActionLoading] = useState(false);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const refreshRequestRef = useRef(0); const hasResolvedOnceRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const selectedTeamIdRef = useRef<string | null>(null);

  const canUseTeamServices = isSupabaseConfigured && Boolean(user) && hasRequiredAccountAuth;
  const authRequiredMessage = isEffectiveAuthRequired
    ? "Sign in with a full drifty.so account before using Teams."
    : "Use a full drifty.so account before using Teams.";
  const resolvedTimezone = useMemo(() => timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", [timezone]);
  const selectedTeam = useMemo(() => teams.find((team) => team.organization_id === selectedTeamId) ?? null, [selectedTeamId, teams]);

  const clearTeamState = useCallback(() => {
    setTeams([]); setRows([]); setLiveRows([]); setSelectedTeamId(null);
    selectedTeamIdRef.current = null;
    setLocalAggregate(null); setTeamRefreshing(false); setTeamError(null);
    hasResolvedOnceRef.current = false;
    hasLoadedOnceRef.current = false;
    setTeamHasResolvedOnce(false); setTeamHasLoadedOnce(false);
  }, []);

  const refreshTeamDataCore = useCallback(async (preferredTeamId = selectedTeamIdRef.current): Promise<string | null> => {
    const requestId = ++refreshRequestRef.current;
    const shouldPreserveState = hasLoadedOnceRef.current;

    if (!canUseTeamServices) {
      clearTeamState(); return null;
    }
    if (activeTab !== "team") return null;

    setTeamRefreshing(true);
    setTeamError(null);

    try {
      const teamsResult = await fetchOwnTeams(activeTeamPeriod);
      if (refreshRequestRef.current !== requestId) return null;

      if (!teamsResult.success) {
        if (!shouldPreserveState) {
          setTeams([]); setRows([]); setLiveRows([]); setSelectedTeamId(null);
          selectedTeamIdRef.current = null;
        }
        hasResolvedOnceRef.current = true;
        setTeamHasResolvedOnce(true);
        setTeamError(teamsResult.error ?? "Unable to load teams");
        return null;
      }

      const nextTeams = [...(teamsResult.data ?? [])];
      const nextSelectedTeamId = chooseSelectedTeamId(nextTeams, preferredTeamId);
      let summaryResult: TeamResult<readonly TeamFocusSummaryRow[]> = { success: true, error: null, data: [] };
      let liveStatusResult: TeamResult<readonly TeamLiveStatusRow[]> = { success: true, error: null, data: [] };
      if (nextSelectedTeamId) {
        [summaryResult, liveStatusResult] = await Promise.all([
          fetchTeamFocusSummary({ organization_id: nextSelectedTeamId, period: activeTeamPeriod }),
          fetchTeamLiveStatus({ organization_id: nextSelectedTeamId, period: activeTeamPeriod }),
        ]);
      }

      if (refreshRequestRef.current !== requestId) return null;

      if (!summaryResult.success) {
        if (!shouldPreserveState) {
          setTeams(nextTeams); setRows([]); setLiveRows([]); setSelectedTeamId(nextSelectedTeamId);
          selectedTeamIdRef.current = nextSelectedTeamId;
        }
        hasResolvedOnceRef.current = true;
        setTeamHasResolvedOnce(true);
        setTeamError(summaryResult.error ?? "Unable to load team focus summary");
        return null;
      }

      if (!liveStatusResult.success) {
        if (!shouldPreserveState) {
          setTeams(nextTeams); setRows([...(summaryResult.data ?? [])]); setLiveRows([]); setSelectedTeamId(nextSelectedTeamId);
          selectedTeamIdRef.current = nextSelectedTeamId;
        }
        hasResolvedOnceRef.current = true;
        setTeamHasResolvedOnce(true);
        setTeamError(liveStatusResult.error ?? "Unable to load team live status");
        return null;
      }

      setTeams(nextTeams);
      setRows([...(summaryResult.data ?? [])]);
      setLiveRows([...(liveStatusResult.data ?? [])]);
      setSelectedTeamId(nextSelectedTeamId);
      selectedTeamIdRef.current = nextSelectedTeamId;
      hasResolvedOnceRef.current = true;
      hasLoadedOnceRef.current = true;
      setTeamHasResolvedOnce(true);
      setTeamHasLoadedOnce(true);
      setTeamError(null);
      return nextSelectedTeamId;
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return null;
      if (!shouldPreserveState) {
        setTeams([]); setRows([]); setLiveRows([]); setSelectedTeamId(null);
        selectedTeamIdRef.current = null;
      }
      hasResolvedOnceRef.current = true;
      setTeamHasResolvedOnce(true);
      if (error instanceof Error || isTeamErrorMessage(error)) { setTeamError(messageFromTeamError(error, "Unable to load teams")); return null; }
      throw error;
    } finally {
      if (refreshRequestRef.current === requestId) setTeamRefreshing(false);
    }
  }, [activeTab, activeTeamPeriod, canUseTeamServices, clearTeamState]);

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

  const { invites, refreshInvites, handleCreateTeam, handleAcceptInvite, handleCreateInvite, handleRevokeInvite } = useTeamInviteActions({ activeTab, canUseTeamServices, selectedTeamId, requireTeamActionAccess, refreshTeamDataCore, setTeamActionError, setTeamActionLoading });

  const refreshTeamData = useCallback(async (preferredTeamId = selectedTeamIdRef.current) => {
    const refreshedTeamId = await refreshTeamDataCore(preferredTeamId);
    await refreshInvites(refreshedTeamId);
  }, [refreshInvites, refreshTeamDataCore]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !hasRequiredAccountAuth) {
      clearTeamState();
      void refreshInvites(null);
      return;
    }

    if (activeTab === "team") void refreshTeamData();
  }, [activeTab, clearTeamState, hasRequiredAccountAuth, isSupabaseConfigured, refreshInvites, refreshTeamData, user]);

  const selectTeam = useCallback((organizationId: string) => {
    selectedTeamIdRef.current = organizationId;
    setSelectedTeamId(organizationId);
    if (activeTab === "team") void refreshTeamData(organizationId);
  }, [activeTab, refreshTeamData]);

  const handlePublishTeamFocus = useCallback(async () => {
    setTeamActionLoading(true);
    setTeamActionError(null);

    try {
      if (!requireTeamActionAccess()) return;
      if (!selectedTeam) {
        setTeamActionError("Select a team before sharing focus.");
        return;
      }

      const windowEndDay = currentDay ?? logicalTodayIsoDate(startOfDayMinutes);
      const window = getTeamFocusWindow(activeTeamPeriod, windowEndDay);
      if (!window) {
        setTeamActionError("Unsupported team focus period.");
        return;
      }

      const localActivity = await trackerClient.getTimeline(getLogicalDayRange(window.window_start_date, window.window_end_date, startOfDayMinutes));
      const aggregate = buildTeamFocusAggregate({
        localActivity, period: activeTeamPeriod, windowEndDay, displayName: selectedTeam.member_display_name || fallbackMemberDisplayName(user?.email),
        roleLabel: selectedTeam.role_label, timezone: resolvedTimezone, startOfDayMinutes, includeAiClassifications: showAiClassificationImpact,
      });

      if (!aggregate.success) {
        setTeamActionError(aggregate.error);
        return;
      }

      const publishResult = await publishTeamFocusTotal({
        organization_id: selectedTeam.organization_id, period: aggregate.data.period, display_name: aggregate.data.display_name, role_label: aggregate.data.role_label,
        focus_seconds: aggregate.data.focus_seconds, focus_score: aggregate.data.focus_score, window_start_date: aggregate.data.window_start_date,
        window_end_date: aggregate.data.window_end_date, timezone: aggregate.data.timezone,
      });

      if (!publishResult.success) {
        setTeamActionError(publishResult.error ?? "Unable to share team focus.");
        return;
      }

      setLocalAggregate(aggregate.data);
      setTeams((currentTeams) => currentTeams.map((team) => (
        team.organization_id === selectedTeam.organization_id
          ? { ...team, focus_share_scope: "focus_only", focus_seconds: aggregate.data.focus_seconds, focus_score: aggregate.data.focus_score,
            window_start_date: aggregate.data.window_start_date, window_end_date: aggregate.data.window_end_date, updated_at: publishResult.data?.updated_at ?? team.updated_at }
          : team
      )));
      await refreshTeamData(selectedTeam.organization_id);
    } catch (error) {
      if (error instanceof Error || isTeamErrorMessage(error)) { setTeamActionError(messageFromTeamError(error, "Unable to share team focus.")); return; }
      throw error;
    } finally {
      setTeamActionLoading(false);
    }
  }, [activeTeamPeriod, refreshTeamData, requireTeamActionAccess, resolvedTimezone, selectedTeam, showAiClassificationImpact, startOfDayMinutes, currentDay, user?.email]);

  const handleStopTeamFocusSharing = useCallback(async () => {
    setTeamActionLoading(true);
    setTeamActionError(null);

    try {
      if (!requireTeamActionAccess()) return;
      if (!selectedTeam) {
        setTeamActionError("Select a team before changing sharing.");
        return;
      }

      const result = await stopTeamFocusSharing({ organization_id: selectedTeam.organization_id });
      if (!result.success) {
        setTeamActionError(result.error ?? "Unable to stop team focus sharing.");
        return;
      }

      setLocalAggregate(null);
      setTeams((currentTeams) => currentTeams.map((team) => (
        team.organization_id === selectedTeam.organization_id
          ? { ...team, focus_share_scope: "private", focus_seconds: 0, focus_score: 0, private_rank: null, updated_at: result.data?.updated_at ?? team.updated_at }
          : team
      )));
      setRows((currentRows) => currentRows.filter((row) => row.member_display_name !== selectedTeam.member_display_name));
      await refreshTeamData(selectedTeam.organization_id);
    } catch (error) {
      if (error instanceof Error || isTeamErrorMessage(error)) { setTeamActionError(messageFromTeamError(error, "Unable to stop team focus sharing.")); return; }
      throw error;
    } finally {
      setTeamActionLoading(false);
    }
  }, [refreshTeamData, requireTeamActionAccess, selectedTeam]);

  const teamBlockingLoading = teamRefreshing && !teamHasResolvedOnce;
  const teamBlockingError = teamHasLoadedOnce ? null : teamError;
  const teamRefreshStatus = teamRefreshing && teamHasResolvedOnce ? "Refreshing teams" : null;
  const teamBackgroundError = teamHasLoadedOnce ? teamError : null;
  const teamStatusMessage = teamBackgroundError ?? teamRefreshStatus;
  const teamStatusTone = teamBackgroundError ? "error" : "neutral";

  return {
	    activeTeamPeriod, liveRows, localAggregate, rows, selectedTeam, teamActionError, teamActionLoading, teamError: teamBlockingError,
    teamLoading: teamBlockingLoading, teamStatusMessage, teamStatusTone, teams, invites, handleCreateTeam, handleAcceptInvite, handleCreateInvite, handleRevokeInvite,
    handlePublishTeamFocus, handleStopTeamFocusSharing, refreshTeamData, selectTeam, setActiveTeamPeriod,
  };
}

function chooseSelectedTeamId(teams: readonly OwnTeam[], preferredTeamId: string | null): string | null {
  if (preferredTeamId && teams.some((team) => team.organization_id === preferredTeamId)) return preferredTeamId;
  return teams[0]?.organization_id ?? null;
}

function fallbackMemberDisplayName(email: string | null | undefined): string {
  const [localPart] = (email ?? "").split("@");
  return localPart?.trim() || "Drifty member";
}
