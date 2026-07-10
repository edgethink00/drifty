import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProjectAnchor, TeamProjectInput } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import { getTeamFocusWindow } from "./teamAggregate";
import { aggregateTeamProjectDayTotals } from "./teamProjectTime";
import {
  archiveTeamProject,
  createTeamProject,
  fetchTeamProjectMemberBreakdown,
  fetchTeamProjectMix,
  fetchTeamProjects,
  isTeamErrorMessage,
  messageFromTeamError,
  publishTeamProjectTotals,
  stopTeamProjectSharing,
  updateTeamProject,
} from "./teamService";
import type {
  CreateTeamProjectInput,
  TeamProject,
  TeamProjectMemberRow,
  TeamProjectMixRow,
  UpdateTeamProjectInput,
} from "./teamTypes";

export type TeamProjectsSubView = "dashboards" | "projects";

export type TeamProjectsWindow = { readonly start_date: string; readonly end_date: string };

export type UseTeamProjectsInput = {
  readonly enabled: boolean;
  readonly organizationId: string | null;
  readonly memberDisplayName: string | null;
  readonly userEmail?: string | null;
  readonly startOfDayMinutes: number;
  readonly currentDay?: string | null;
};

export type CreateTeamProjectFields = Omit<CreateTeamProjectInput, "organization_id">;

export type UseTeamProjectsResult = {
  readonly projects: readonly TeamProject[];
  readonly mix: readonly TeamProjectMixRow[];
  readonly members: readonly TeamProjectMemberRow[];
  readonly window: TeamProjectsWindow;
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly actionLoading: boolean;
  readonly publishing: boolean;
  readonly publishNote: string | null;
  readonly refresh: () => Promise<void>;
  readonly createProject: (fields: CreateTeamProjectFields) => Promise<boolean>;
  readonly updateProject: (input: UpdateTeamProjectInput) => Promise<boolean>;
  readonly archiveProject: (projectId: string, archived: boolean) => Promise<boolean>;
  readonly publishMyTime: () => Promise<void>;
  readonly stopSharing: () => Promise<void>;
};

function fallbackMemberDisplayName(email: string | null | undefined): string {
  const [localPart] = (email ?? "").split("@");
  return localPart?.trim() || "Drifty member";
}

// Mirror the cloud shared-project definitions into the local tracker so the on-device
// AI pass can classify the member's own activity against them (union pass).
function toLocalTeamProjectInputs(projects: readonly TeamProject[]): TeamProjectInput[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    status: project.status,
    anchors: project.anchors.map((anchor): ProjectAnchor => ({ kind: anchor.kind, value: anchor.value, source: "manual" })),
  }));
}

const EMPTY_PROJECTS: readonly TeamProject[] = [];
const EMPTY_MIX: readonly TeamProjectMixRow[] = [];
const EMPTY_MEMBERS: readonly TeamProjectMemberRow[] = [];

export function useTeamProjects(input: UseTeamProjectsInput): UseTeamProjectsResult {
  const { enabled, organizationId, memberDisplayName, userEmail, startOfDayMinutes, currentDay } = input;

  const [projects, setProjects] = useState<readonly TeamProject[]>(EMPTY_PROJECTS);
  const [mix, setMix] = useState<readonly TeamProjectMixRow[]>(EMPTY_MIX);
  const [members, setMembers] = useState<readonly TeamProjectMemberRow[]>(EMPTY_MEMBERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const requestRef = useRef(0);

  const window = useMemo<TeamProjectsWindow>(() => {
    const endDay = currentDay ?? logicalTodayIsoDate(startOfDayMinutes);
    const focusWindow = getTeamFocusWindow("weekly", endDay);
    if (focusWindow) {
      return { start_date: focusWindow.window_start_date, end_date: focusWindow.window_end_date };
    }
    return { start_date: endDay, end_date: endDay };
  }, [currentDay, startOfDayMinutes]);

  const active = enabled && Boolean(organizationId);

  const refresh = useCallback(async () => {
    if (!active || !organizationId) {
      // Bump the request id so any in-flight fetch for a previous team can't resolve
      // and repopulate the just-cleared state.
      requestRef.current += 1;
      setProjects(EMPTY_PROJECTS);
      setMix(EMPTY_MIX);
      setMembers(EMPTY_MEMBERS);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [projectsResult, mixResult, membersResult] = await Promise.all([
        fetchTeamProjects({ organization_id: organizationId }),
        fetchTeamProjectMix({ organization_id: organizationId, start_date: window.start_date, end_date: window.end_date }),
        fetchTeamProjectMemberBreakdown({ organization_id: organizationId, start_date: window.start_date, end_date: window.end_date }),
      ]);
      if (requestRef.current !== requestId) return;

      if (!projectsResult.success) {
        setError(projectsResult.error ?? "Unable to load team projects.");
        return;
      }
      const loadedProjects = [...(projectsResult.data ?? [])];
      setProjects(loadedProjects);
      setMix(mixResult.success ? [...(mixResult.data ?? [])] : EMPTY_MIX);
      setMembers(membersResult.success ? [...(membersResult.data ?? [])] : EMPTY_MEMBERS);
      setError(null);
      // Keep the local mirror in sync so the next AI pass sees current team defs.
      // Only mirror a non-empty set — a bulk upsert of [] would wipe every local
      // team project + its stored assignments, so we never let a (possibly transient)
      // empty result destroy on-device data.
      if (loadedProjects.length > 0) {
        void trackerClient.upsertTeamProjects(organizationId, toLocalTeamProjectInputs(loadedProjects)).catch(() => undefined);
      }
    } catch (caught) {
      if (requestRef.current !== requestId) return;
      if (caught instanceof Error || isTeamErrorMessage(caught)) {
        setError(messageFromTeamError(caught, "Unable to load team projects."));
        return;
      }
      throw caught;
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [active, organizationId, window.start_date, window.end_date]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = useCallback(async (fields: CreateTeamProjectFields): Promise<boolean> => {
    if (!organizationId) return false;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await createTeamProject({ organization_id: organizationId, ...fields });
      if (!result.success) {
        setActionError(result.error ?? "Unable to create the project.");
        return false;
      }
      await refresh();
      return true;
    } finally {
      setActionLoading(false);
    }
  }, [organizationId, refresh]);

  const updateProject = useCallback(async (updateInput: UpdateTeamProjectInput): Promise<boolean> => {
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await updateTeamProject(updateInput);
      if (!result.success) {
        setActionError(result.error ?? "Unable to update the project.");
        return false;
      }
      await refresh();
      return true;
    } finally {
      setActionLoading(false);
    }
  }, [refresh]);

  const archiveProject = useCallback(async (projectId: string, archived: boolean): Promise<boolean> => {
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await archiveTeamProject({ project_id: projectId, archived });
      if (!result.success) {
        setActionError(result.error ?? "Unable to archive the project.");
        return false;
      }
      await refresh();
      return true;
    } finally {
      setActionLoading(false);
    }
  }, [refresh]);

  const publishMyTime = useCallback(async () => {
    if (!organizationId) return;
    setPublishing(true);
    setActionError(null);
    setPublishNote(null);
    try {
      const range = getLogicalDayRange(window.start_date, window.end_date, startOfDayMinutes);
      const [localActivity, assignments] = await Promise.all([
        trackerClient.getTimeline(range),
        trackerClient.getTeamProjectAssignments(range),
      ]);
      const entries = aggregateTeamProjectDayTotals(assignments, localActivity, startOfDayMinutes);
      if (entries.length === 0) {
        // Never publish an empty set — the RPC replaces the whole window, so an empty
        // publish would wipe a previously-shared week. Guide the user to Analyze first.
        setPublishNote("No classified team-project time yet — run Analyze on the Projects tab, then share.");
        return;
      }
      const displayName = memberDisplayName?.trim() || fallbackMemberDisplayName(userEmail);
      const result = await publishTeamProjectTotals({
        organization_id: organizationId,
        display_name: displayName,
        window_start_date: window.start_date,
        window_end_date: window.end_date,
        entries,
      });
      if (!result.success) {
        setActionError(result.error ?? "Unable to share your project time.");
        return;
      }
      setPublishNote(entries.length === 0
        ? "No classified team-project time yet — run Analyze on the Projects tab, then share."
        : `Shared ${result.data?.published_row_count ?? entries.length} day totals.`);
      await refresh();
    } catch (caught) {
      if (caught instanceof Error || isTeamErrorMessage(caught)) {
        setActionError(messageFromTeamError(caught, "Unable to share your project time."));
        return;
      }
      throw caught;
    } finally {
      setPublishing(false);
    }
  }, [organizationId, window.start_date, window.end_date, startOfDayMinutes, memberDisplayName, userEmail, refresh]);

  const stopSharing = useCallback(async () => {
    if (!organizationId) return;
    setActionLoading(true);
    setActionError(null);
    setPublishNote(null);
    try {
      const result = await stopTeamProjectSharing({ organization_id: organizationId });
      if (!result.success) {
        setActionError(result.error ?? "Unable to stop sharing.");
        return;
      }
      setPublishNote("Stopped sharing your project time.");
      await refresh();
    } finally {
      setActionLoading(false);
    }
  }, [organizationId, refresh]);

  return {
    projects,
    mix,
    members,
    window,
    loading,
    error,
    actionError,
    actionLoading,
    publishing,
    publishNote,
    refresh,
    createProject,
    updateProject,
    archiveProject,
    publishMyTime,
    stopSharing,
  };
}
