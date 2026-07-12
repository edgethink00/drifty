import { useCallback, useMemo, useRef, useState } from "react";

import { shiftIsoDate } from "@drifty/domain";

import { logicalTodayIsoDate } from "../../lib/formatting";
import { getTeamFocusWindow } from "./teamAggregate";
import type {
  OwnTeam,
  TeamInvite,
  TeamPeriod,
  TeamProject,
  TeamProjectMemberRow,
  TeamProjectMixRow,
} from "./teamTypes";
import type { UseTeamControllerResult } from "./useTeamController";
import type {
  CreateTeamProjectFields,
  TeamProjectsWindow,
  UseTeamProjectsResult,
} from "./useTeamProjects";
import type { UpdateTeamProjectInput } from "./teamTypes";

/**
 * QA-only mock for the Team surface: lets the new design be exercised end to end
 * (dashboards, table, modals, local create/edit/archive, invite regen, share/stop)
 * without a Supabase account. Dev-server-only by construction — the flag requires
 * `import.meta.env.DEV`, so production and release builds can never enable it.
 * Launch with `VITE_TEAM_QA_MOCK=1 npm run tauri:dev`.
 */
export function isTeamQaMockEnabled(): boolean {
  return Boolean(import.meta.env.DEV) && import.meta.env.VITE_TEAM_QA_MOCK === "1";
}

const MOCK_ORG_ID = "qa-org-deep-work-crew";

const MOCK_TEAM: OwnTeam = {
  organization_id: MOCK_ORG_ID,
  organization_name: "Deep Work Crew",
  member_display_name: "Minseok Park",
  role_label: "Owner",
  member_count: 6,
  updated_at: "2026-07-10T09:00:00.000Z",
};

function makeInvite(code: string): TeamInvite {
  return {
    invite_id: `qa-invite-${code}`,
    organization_id: MOCK_ORG_ID,
    organization_name: MOCK_TEAM.organization_name,
    invite_code: code,
    invite_url: `https://drifty.so/team-invite?code=${code}`,
    role_label: "Member",
    status: "pending",
    expires_at: "2026-07-18T00:00:00.000Z",
    created_at: "2026-07-10T09:00:00.000Z",
    updated_at: "2026-07-10T09:00:00.000Z",
  };
}

function randomInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const segment = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `DRFT-${segment()}-${segment()}`;
}


// Hours per member for a newly created project over a 14-day baseline (scaled
// to the window). Presets rotate by creation order so each project gets a
// distinct mix and the dashboards fill up as QA creates projects.
const ALLOC_PRESETS: readonly Readonly<Record<string, number>>[] = [
  { "Minseok Park": 16.2, "Aria Chen": 12.8, "Devin Ross": 14.5 },
  { "Minseok Park": 3.4, "Aria Chen": 6.2, "Yuki Tanaka": 9.6 },
  { "Minseok Park": 1.1, "Yuki Tanaka": 4.8, "Priya Nair": 8.2 },
  { "Devin Ross": 2.4, "Priya Nair": 5.1 },
];

// Pre-seeded shared projects so the dashboards/table are populated the moment
// the mock loads; QA can still create/edit/archive on top of these.
function seedProject(
  id: string,
  name: string,
  description: string,
  color: string,
  status: "active" | "archived",
  anchors: TeamProject["anchors"],
): TeamProject {
  return {
    id,
    organization_id: MOCK_ORG_ID,
    name,
    description,
    color,
    status,
    anchors,
    can_manage: true,
    created_at: "2026-06-20T09:00:00.000Z",
    updated_at: "2026-07-10T09:00:00.000Z",
  };
}

const SEED_PROJECTS: readonly TeamProject[] = [
  seedProject(
    "qa-seed-drifty",
    "Drifty",
    "The Drifty desktop app — Tauri shell, tracker, dashboards, and releases.",
    "#6366f1",
    "active",
    [
      { kind: "app", value: "Visual Studio Code" },
      { kind: "domain", value: "github.com" },
      { kind: "keyword", value: "drifty" },
    ],
  ),
  seedProject(
    "qa-seed-acme",
    "Client — Acme",
    "Acme dashboard contract: Figma mockups, the Next.js repo, and weekly demo prep.",
    "#f59e0b",
    "active",
    [
      { kind: "domain", value: "acme.com" },
      { kind: "app", value: "Figma" },
    ],
  ),
  seedProject(
    "qa-seed-korean",
    "Korean study",
    "Korean listening practice and Anki reviews, weekday mornings.",
    "#10b981",
    "active",
    [{ kind: "app", value: "Anki" }],
  ),
  seedProject(
    "qa-seed-blog",
    "Blog relaunch",
    "Astro rewrite of the personal blog.",
    "#ec4899",
    "archived",
    [],
  ),
];

const SEED_HOURS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "qa-seed-drifty": { "Minseok Park": 16.2, "Aria Chen": 12.8, "Devin Ross": 14.5, "Yuki Tanaka": 6.4 },
  "qa-seed-acme": { "Minseok Park": 3.4, "Aria Chen": 6.2, "Yuki Tanaka": 9.6, "Priya Nair": 2.2 },
  "qa-seed-korean": { "Minseok Park": 1.1, "Priya Nair": 4.8 },
};

const DAY_WEIGHTS = [1, 1.08, 0.92, 1.05, 0.72, 0.16, 0.08, 0.98, 1.12, 0.9, 1.02, 0.78, 0.2, 0.12] as const;

export function useTeamQaMockController(): UseTeamControllerResult {
  const [teams, setTeams] = useState<readonly OwnTeam[]>([MOCK_TEAM]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(MOCK_ORG_ID);
  const [invites, setInvites] = useState<readonly TeamInvite[]>([makeInvite("DRFT-K4M2-9QXZ")]);
  const nextTeamIdRef = useRef(1);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.organization_id === selectedTeamId) ?? teams[0] ?? null,
    [selectedTeamId, teams],
  );

  const handleCreateTeam = useCallback(async (input: { readonly organizationName: string }) => {
    const id = `qa-org-created-${nextTeamIdRef.current++}`;
    setTeams((current) => [
      ...current,
      { ...MOCK_TEAM, organization_id: id, organization_name: input.organizationName, member_count: 1 },
    ]);
    setSelectedTeamId(id);
  }, []);

  const handleAcceptInvite = useCallback(async (_input: { readonly inviteKey: string }) => {
    const id = `qa-org-joined-${nextTeamIdRef.current++}`;
    setTeams((current) => [
      ...current,
      { ...MOCK_TEAM, organization_id: id, organization_name: "Joined Crew", role_label: "Member", member_count: 3 },
    ]);
    setSelectedTeamId(id);
  }, []);

  const handleCreateInvite = useCallback(async (_input: { readonly organization_id: string }) => {
    setInvites([makeInvite(randomInviteCode())]);
  }, []);

  const handleRevokeInvite = useCallback(async (input: { readonly invite_id: string }) => {
    setInvites((current) => current.filter((invite) => invite.invite_id !== input.invite_id));
  }, []);

  return {
    selectedTeam,
    teamActionError: null,
    teamActionLoading: false,
    teamError: null,
    teamLoading: false,
    teamStatusMessage: null,
    teamStatusTone: "neutral",
    teams,
    invites,
    refreshTeamData: async () => undefined,
    handleCreateTeam,
    handleAcceptInvite,
    handleCreateInvite,
    handleRevokeInvite,
    selectTeam: setSelectedTeamId,
  };
}

export type UseTeamQaMockProjectsInput = {
  readonly period: TeamPeriod;
  readonly windowOffset: number;
  readonly startOfDayMinutes: number;
};

export function useTeamQaMockProjects(input: UseTeamQaMockProjectsInput): UseTeamProjectsResult {
  const { period, windowOffset, startOfDayMinutes } = input;
  // Seeded with a populated team so dashboards/table render data immediately;
  // created projects pick up a rotating allocation preset on top.
  const [projects, setProjects] = useState<readonly TeamProject[]>(SEED_PROJECTS);
  const [hoursByProject, setHoursByProject] = useState<Readonly<Record<string, Readonly<Record<string, number>>>>>(SEED_HOURS);
  const [sharing, setSharing] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const nextProjectIdRef = useRef(1);

  const window = useMemo<TeamProjectsWindow>(() => {
    const latestEndDay = logicalTodayIsoDate(startOfDayMinutes);
    const windowDays = period === "daily" ? 1 : period === "monthly" ? 30 : 7;
    const endDay = shiftIsoDate(latestEndDay, -Math.max(0, windowOffset) * windowDays);
    const focusWindow = getTeamFocusWindow(period, endDay);
    if (focusWindow) return { start_date: focusWindow.window_start_date, end_date: focusWindow.window_end_date };
    return { start_date: endDay, end_date: endDay };
  }, [period, startOfDayMinutes, windowOffset]);

  const { mix, members } = useMemo(() => {
    const dayList: string[] = [];
    for (let day = window.start_date; day <= window.end_date; day = shiftIsoDate(day, 1)) {
      dayList.push(day);
      if (dayList.length > 60) break;
    }
    const scale = dayList.length / 14;
    const projectById = new Map(projects.map((project) => [project.id, project]));

    const memberRows: TeamProjectMemberRow[] = [];
    const totalsByProject = new Map<string, number>();
    for (const [projectId, hoursByMember] of Object.entries(hoursByProject)) {
      const project = projectById.get(projectId);
      if (!project) continue;
      for (const [memberName, hours] of Object.entries(hoursByMember)) {
        if (!sharing && memberName === MOCK_TEAM.member_display_name) continue;
        const seconds = Math.round(hours * 3600 * scale);
        if (seconds <= 0) continue;
        memberRows.push({
          organization_id: MOCK_ORG_ID,
          organization_project_id: projectId,
          project_name: project.name,
          member_display_name: memberName,
          seconds,
        });
        totalsByProject.set(projectId, (totalsByProject.get(projectId) ?? 0) + seconds);
      }
    }

    const mixRows: TeamProjectMixRow[] = [];
    let projectIndex = 0;
    for (const [projectId, totalSeconds] of totalsByProject) {
      const project = projectById.get(projectId)!;
      const rotation = (projectIndex * 3) % DAY_WEIGHTS.length;
      const weights = dayList.map((_, dayIdx) => DAY_WEIGHTS[(dayIdx + rotation) % DAY_WEIGHTS.length]!);
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
      dayList.forEach((day, dayIdx) => {
        const seconds = Math.round((totalSeconds * weights[dayIdx]!) / weightSum);
        if (seconds <= 0) return;
        mixRows.push({
          organization_id: MOCK_ORG_ID,
          organization_project_id: projectId,
          project_name: project.name,
          project_color: project.color,
          project_status: project.status,
          activity_date: day,
          seconds,
        });
      });
      projectIndex += 1;
    }

    return { mix: mixRows, members: memberRows };
  }, [hoursByProject, projects, sharing, window.end_date, window.start_date]);

  const createProject = useCallback(async (fields: CreateTeamProjectFields) => {
    const creationIndex = nextProjectIdRef.current++;
    const id = `qa-created-${creationIndex}`;
    setProjects((current) => [
      ...current,
      {
        id,
        organization_id: MOCK_ORG_ID,
        name: fields.name,
        description: fields.description ?? "",
        color: fields.color || "#6366f1",
        status: "active" as const,
        anchors: fields.anchors ?? [],
        can_manage: true,
        created_at: "2026-07-11T09:00:00.000Z",
        updated_at: "2026-07-11T09:00:00.000Z",
      },
    ]);
    setHoursByProject((current) => ({
      ...current,
      [id]: ALLOC_PRESETS[(creationIndex - 1) % ALLOC_PRESETS.length]!,
    }));
    return true;
  }, []);

  const updateProject = useCallback(async (updateInput: UpdateTeamProjectInput) => {
    setProjects((current) => current.map((project) => (
      project.id === updateInput.project_id
        ? {
            ...project,
            name: updateInput.name,
            description: updateInput.description ?? "",
            color: updateInput.color || project.color,
            anchors: updateInput.anchors ?? project.anchors,
          }
        : project
    )));
    return true;
  }, []);

  const archiveProject = useCallback(async (projectId: string, archived: boolean) => {
    setProjects((current) => current.map((project) => (
      project.id === projectId ? { ...project, status: archived ? "archived" as const : "active" as const } : project
    )));
    return true;
  }, []);

  const publishMyTime = useCallback(async () => {
    setPublishing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setPublishing(false);
    setSharing(true);
    setPublishNote("Shared 20h 42m across 3 projects for this window.");
  }, []);

  const stopSharing = useCallback(async () => {
    setSharing(false);
    setPublishNote("Stopped sharing — your published totals were removed from this team.");
  }, []);

  return {
    projects,
    mix,
    members,
    window,
    loading: false,
    error: null,
    actionError: null,
    actionLoading: false,
    publishing,
    publishNote,
    refresh: async () => undefined,
    createProject,
    updateProject,
    archiveProject,
    publishMyTime,
    stopSharing,
  };
}
