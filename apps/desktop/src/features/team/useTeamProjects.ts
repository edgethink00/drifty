import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logicalDayIsoDateForDate, shiftIsoDate, type ProjectAnchor, type TeamProjectInput } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import { notifyTeamProjectMirrorChanged } from "../../lib/teamProjectMirrorEvents";
import { readCategoryProductivityPreferences, readDeletedCategoryCutoffs } from "../settings/categoryCustomizationStore";
import { getTeamFocusWindow } from "./teamAggregate";
import { teamActivitySince } from "./teamActivitySince";
import { teamFocusDayTotals, type TeamFocusClassification } from "./teamFocusPublish";
import { aggregateTeamProjectDayTotals } from "./teamProjectTime";
import { sharedFocusNote, sharedProjectTimeNote } from "./teamPublishNote";
import { fetchTeamMembershipStart, fetchTeamTotals, publishTeamFocusDays, type TeamTotalsRow } from "./teamSharingService";
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
  TeamPeriod,
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
  /** Dashboard range granularity; defaults to the weekly focus window. */
  readonly period?: TeamPeriod;
  /** How many whole windows back from the latest one (0 = latest). */
  readonly windowOffset?: number;
  /**
   * What the team's stored sharing lets a member send: project time only while
   * the team shares it, focus only while it shares focus. Absent on a server
   * that predates stored sharing, where project time is sent as before.
   */
  readonly sharing?: { readonly projects: boolean; readonly focus: boolean } | null;
  /** How the member's own charts classify activity; focus is sent only with it. */
  readonly focusClassification?: TeamFocusClassification | null;
};

export type CreateTeamProjectFields = Omit<CreateTeamProjectInput, "organization_id">;

export type UseTeamProjectsResult = {
  readonly projects: readonly TeamProject[];
  readonly mix: readonly TeamProjectMixRow[];
  readonly members: readonly TeamProjectMemberRow[];
  /** Per-day figures the seat may see, on a server that stores sharing; null where it does not. */
  readonly totals: readonly TeamTotalsRow[] | null;
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
  const { enabled, organizationId, memberDisplayName, userEmail, startOfDayMinutes, currentDay, period = "weekly", windowOffset = 0 } = input;
  const sharesProjects = input.sharing?.projects ?? true;
  const focusClassification = input.sharing?.focus ? input.focusClassification ?? null : null;
  const readsTotals = Boolean(input.sharing);

  const [projects, setProjects] = useState<readonly TeamProject[]>(EMPTY_PROJECTS);
  const [mix, setMix] = useState<readonly TeamProjectMixRow[]>(EMPTY_MIX);
  const [members, setMembers] = useState<readonly TeamProjectMemberRow[]>(EMPTY_MEMBERS);
  const [totals, setTotals] = useState<readonly TeamTotalsRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const requestRef = useRef(0);

  const window = useMemo<TeamProjectsWindow>(() => {
    const latestEndDay = currentDay ?? logicalTodayIsoDate(startOfDayMinutes);
    const windowDays = period === "daily" ? 1 : period === "monthly" ? 30 : 7;
    const offset = Math.max(0, Math.floor(windowOffset));
    const endDay = shiftIsoDate(latestEndDay, -offset * windowDays);
    const focusWindow = getTeamFocusWindow(period, endDay);
    if (focusWindow) {
      return { start_date: focusWindow.window_start_date, end_date: focusWindow.window_end_date };
    }
    return { start_date: endDay, end_date: endDay };
  }, [currentDay, period, startOfDayMinutes, windowOffset]);

  const active = enabled && Boolean(organizationId);
  const scopeKey = JSON.stringify([active, organizationId, userEmail ?? null, readsTotals,
    window.start_date, window.end_date, startOfDayMinutes]);
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current = { key: scopeKey };
    requestRef.current += 1;
  }
  const scope = scopeRef.current;
  const [stateScope, setStateScope] = useState(scope);
  const hasCurrentState = stateScope === scope;
  const isCurrentScope = useCallback(() => active && scopeRef.current === scope, [active, scope]);
  // Mask old data during render, then clear it before the new request settles.
  // A failed request must never leave another team's totals under this header.
  useEffect(() => {
    if (stateScope === scope) return;
    setStateScope(scope);
    setProjects(EMPTY_PROJECTS);
    setMix(EMPTY_MIX);
    setMembers(EMPTY_MEMBERS);
    setTotals(null);
    setLoading(false);
    setError(null);
    setActionError(null);
    setActionLoading(false);
    setPublishing(false);
    setPublishNote(null);
  }, [scope, stateScope]);


  const refresh = useCallback(async () => {
    if (!isCurrentScope() || !organizationId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [projectsResult, mixResult, membersResult, totalsResult] = await Promise.all([
        fetchTeamProjects({ organization_id: organizationId }),
        fetchTeamProjectMix({ organization_id: organizationId, start_date: window.start_date, end_date: window.end_date }),
        fetchTeamProjectMemberBreakdown({ organization_id: organizationId, start_date: window.start_date, end_date: window.end_date }),
        // The server cuts these to the seat; they carry days and focus, which the breakdown does not.
        readsTotals ? fetchTeamTotals({ organization_id: organizationId, start_date: window.start_date, end_date: window.end_date }) : null,
      ]);
      if (!isCurrentScope() || requestRef.current !== requestId) return;

      if (!projectsResult.success) {
        setError(projectsResult.error ?? "Unable to load team projects.");
        return;
      }
      const loadedProjects = [...(projectsResult.data ?? [])];
      setProjects(loadedProjects);
      // A partial read failure must not erase this scope's last known totals.
      // A changed scope has already reset/masked its previous owner's data.
      if (mixResult.success) setMix([...(mixResult.data ?? [])]);
      if (membersResult.success) setMembers([...(membersResult.data ?? [])]);
      if (totalsResult?.success) setTotals([...totalsResult.data]);
      setError(!mixResult.success
        ? (mixResult.error ?? "Unable to load team project totals.")
        : !membersResult.success
          ? (membersResult.error ?? "Unable to load team project members.")
          : null);
      // Keep the local mirror in sync so the next AI pass sees current team defs.
      // Only mirror a non-empty set — a bulk upsert of [] would wipe every local
      // team project + its stored assignments, so we never let a (possibly transient)
      // empty result destroy on-device data.
      if (loadedProjects.length > 0) {
        void trackerClient.upsertTeamProjects(organizationId, toLocalTeamProjectInputs(loadedProjects))
          .then(() => notifyTeamProjectMirrorChanged())
          .catch(() => undefined);
      }
    } catch (caught) {
      if (!isCurrentScope() || requestRef.current !== requestId) return;
      if (caught instanceof Error || isTeamErrorMessage(caught)) {
        setError(messageFromTeamError(caught, "Unable to load team projects."));
        return;
      }
      throw caught;
    } finally {
      if (isCurrentScope() && requestRef.current === requestId) setLoading(false);
    }
  }, [isCurrentScope, organizationId, readsTotals, window.start_date, window.end_date]);

  useEffect(() => {
    void refresh();
  }, [isCurrentScope, refresh]);

  const createProject = useCallback(async (fields: CreateTeamProjectFields): Promise<boolean> => {
    if (!isCurrentScope() || !organizationId) return false;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await createTeamProject({ organization_id: organizationId, ...fields });
      if (!isCurrentScope()) return false;
      if (!result.success) {
        setActionError(result.error ?? "Unable to create the project.");
        return false;
      }
      await refresh();
      return true;
    } finally {
      if (isCurrentScope()) setActionLoading(false);
    }
  }, [isCurrentScope, organizationId, refresh]);

  const updateProject = useCallback(async (updateInput: UpdateTeamProjectInput): Promise<boolean> => {
    if (!isCurrentScope()) return false;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await updateTeamProject(updateInput);
      if (!isCurrentScope()) return false;
      if (!result.success) {
        setActionError(result.error ?? "Unable to update the project.");
        return false;
      }
      await refresh();
      return true;
    } finally {
      if (isCurrentScope()) setActionLoading(false);
    }
  }, [isCurrentScope, refresh]);

  const archiveProject = useCallback(async (projectId: string, archived: boolean): Promise<boolean> => {
    if (!isCurrentScope()) return false;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await archiveTeamProject({ project_id: projectId, archived });
      if (!isCurrentScope()) return false;
      if (!result.success) {
        setActionError(result.error ?? "Unable to archive the project.");
        return false;
      }
      await refresh();
      return true;
    } finally {
      if (isCurrentScope()) setActionLoading(false);
    }
  }, [isCurrentScope, refresh]);

  const publishMyTime = useCallback(async () => {
    if (!isCurrentScope() || !organizationId) return;
    setPublishing(true);
    setActionError(null);
    setPublishNote(null);
    try {
      const membership = await fetchTeamMembershipStart(organizationId);
      if (!isCurrentScope()) return;
      if (!membership.success) { setActionError(membership.error); return; }
      const range = getLogicalDayRange(window.start_date, window.end_date, startOfDayMinutes);
      const joinedDay = logicalDayIsoDateForDate(new Date(membership.data), startOfDayMinutes);
      const sharedWindowStart = window.start_date < joinedDay ? joinedDay : window.start_date;
      const [timeline, assignments, windowAssignments] = await Promise.all([
        trackerClient.getTimeline(range),
        trackerClient.getTeamProjectAssignments(range),
        trackerClient.getProjectWindowAssignments(range),
      ]);
      if (!isCurrentScope()) return;
      const localActivity = teamActivitySince(timeline, membership.data);
      const entries = sharesProjects ? aggregateTeamProjectDayTotals(assignments, localActivity, startOfDayMinutes, windowAssignments) : [];
      const focusEntries = focusClassification
        ? teamFocusDayTotals(localActivity, window, focusClassification, startOfDayMinutes, {
          categoryProductivity: readCategoryProductivityPreferences(),
          deletedCategories: readDeletedCategoryCutoffs(),
        })
        : null;
      if (entries.length === 0 && !focusEntries?.length) {
        // Never publish an empty set — the RPC replaces the whole window, so an empty
        // publish would wipe a previously-shared week. Guide the user to Analyze first.
        setPublishNote("No classified team-project time yet — run Analyze on the Projects tab, then share.");
        return;
      }
      const displayName = memberDisplayName?.trim() || fallbackMemberDisplayName(userEmail);
      if (focusEntries) {
        // Focus goes with the window as a whole, so a day without focus clears what was sent for it.
        const focusResult = await publishTeamFocusDays({
          organization_id: organizationId,
          display_name: displayName,
          window_start_date: sharedWindowStart,
          window_end_date: window.end_date,
          entries: focusEntries,
        });
        if (!isCurrentScope()) return;
        if (!focusResult.success) {
          setActionError(focusResult.error ?? "Unable to share your focus.");
          return;
        }
      }
      if (entries.length > 0) {
        const result = await publishTeamProjectTotals({
          organization_id: organizationId,
          display_name: displayName,
          window_start_date: sharedWindowStart,
          window_end_date: window.end_date,
          entries,
        });
        if (!isCurrentScope()) return;
        if (!result.success) {
          setActionError(result.error ?? "Unable to share your project time.");
          return;
        }
      }
      setPublishNote(entries.length > 0 ? sharedProjectTimeNote(entries) : sharedFocusNote(focusEntries ?? []));
      await refresh();
    } catch (caught) {
      if (!isCurrentScope()) return;
      if (caught instanceof Error || isTeamErrorMessage(caught)) {
        setActionError(messageFromTeamError(caught, "Unable to share your project time."));
        return;
      }
      throw caught;
    } finally {
      if (isCurrentScope()) setPublishing(false);
    }
  }, [isCurrentScope, organizationId, window, startOfDayMinutes, memberDisplayName, userEmail, refresh, sharesProjects, focusClassification]);

  const stopSharing = useCallback(async () => {
    if (!isCurrentScope() || !organizationId) return;
    setActionLoading(true);
    setActionError(null);
    setPublishNote(null);
    try {
      const result = await stopTeamProjectSharing({ organization_id: organizationId });
      if (!isCurrentScope()) return;
      if (!result.success) {
        setActionError(result.error ?? "Unable to stop sharing.");
        return;
      }
      setPublishNote("Stopped sharing your project time.");
      await refresh();
    } finally {
      if (isCurrentScope()) setActionLoading(false);
    }
  }, [isCurrentScope, organizationId, refresh]);

  return {
    projects: hasCurrentState ? projects : EMPTY_PROJECTS,
    mix: hasCurrentState ? mix : EMPTY_MIX,
    members: hasCurrentState ? members : EMPTY_MEMBERS,
    totals: hasCurrentState ? totals : null,
    window,
    loading: hasCurrentState ? loading : active,
    error: hasCurrentState ? error : null,
    actionError: hasCurrentState ? actionError : null,
    actionLoading: hasCurrentState ? actionLoading : false,
    publishing: hasCurrentState ? publishing : false,
    publishNote: hasCurrentState ? publishNote : null,
    refresh,
    createProject,
    updateProject,
    archiveProject,
    publishMyTime,
    stopSharing,
  };
}
