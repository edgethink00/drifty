import { useCallback, useMemo, useRef, useState } from "react";

import { shiftIsoDate } from "@drifty/domain";

import { logicalTodayIsoDate } from "../../lib/formatting";
import { getTeamFocusWindow } from "./teamAggregate";
import type {
  OwnTeam,
  TeamInvite,
  TeamMember,
  TeamPeriod,
  TeamProject,
  TeamProjectMemberRow,
  TeamProjectMixRow,
} from "./teamTypes";
import { canInviteToTeam, isTeamOwner } from "./teamTypes";
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
  membership_role: "owner",
  members_can_invite: true,
};

const MOCK_MEMBER_ORG_ID = "qa-org-seoul-studio";

const MOCK_MEMBER_TEAM: OwnTeam = {
  organization_id: MOCK_MEMBER_ORG_ID,
  organization_name: "Seoul Product Studio",
  member_display_name: "Minseok Park",
  role_label: "Member",
  member_count: 3,
  updated_at: "2026-07-10T09:00:00.000Z",
  membership_role: "member",
  // The owner keeps invites to themself here, so QA sees the member view
  // without an invite button.
  members_can_invite: false,
};

// A member team that allows member invites and has no live link yet, so QA
// can mint one as a member.
const MOCK_INVITING_MEMBER_TEAM: OwnTeam = {
  organization_id: "qa-org-drifty-core",
  organization_name: "드리프티 코어팀",
  member_display_name: "Minseok Park",
  role_label: "Member",
  member_count: 4,
  updated_at: "2026-07-10T09:00:00.000Z",
  membership_role: "member",
  members_can_invite: true,
};

function mockMember(key: string, name: string, role: "owner" | "member", joinedAt: string, isSelf = false): TeamMember {
  return {
    member_key: key,
    display_name: name,
    role_label: role === "owner" ? "Owner" : "Member",
    membership_role: role,
    joined_at: joinedAt,
    is_self: isSelf,
  };
}

const MOCK_SELF_OWNER = mockMember("qa-member-self", "Minseok Park", "owner", "2026-06-02T09:00:00.000Z", true);

// The owner team's roster: names as shared with the team, plus one member who
// has not shared yet and so shows the email-derived name.
const MOCK_OWNER_ROSTER: readonly TeamMember[] = [
  MOCK_SELF_OWNER,
  mockMember("qa-member-aria", "Aria Chen", "member", "2026-06-03T09:00:00.000Z"),
  mockMember("qa-member-devin", "Devin Ross", "member", "2026-06-04T09:00:00.000Z"),
  mockMember("qa-member-yuki", "Yuki Tanaka", "member", "2026-06-05T09:00:00.000Z"),
  mockMember("qa-member-priya", "Priya Nair", "member", "2026-06-09T09:00:00.000Z"),
  mockMember("qa-member-sam", "sam.ortiz", "member", "2026-07-01T09:00:00.000Z"),
];

function makeInvite(code: string, team: OwnTeam = MOCK_TEAM): TeamInvite {
  return {
    invite_id: `qa-invite-${code}`,
    organization_id: team.organization_id,
    organization_name: team.organization_name,
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
  organizationId: string,
  id: string,
  name: string,
  description: string,
  color: string,
  status: "active" | "archived",
  anchors: TeamProject["anchors"],
): TeamProject {
  return {
    id,
    organization_id: organizationId,
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
    MOCK_ORG_ID,
    "qa-seed-drifty",
    "Drifty",
    "The Drifty desktop app — Tauri shell, tracker, dashboards, and releases.",
    "#5366a3",
    "active",
    [
      { kind: "app", value: "Visual Studio Code" },
      { kind: "domain", value: "github.com" },
      { kind: "keyword", value: "drifty" },
    ],
  ),
  seedProject(
    MOCK_ORG_ID,
    "qa-seed-acme",
    "Client — Acme",
    "Acme dashboard contract: Figma mockups, the Next.js repo, and weekly demo prep.",
    "#a1792f",
    "active",
    [
      { kind: "domain", value: "acme.com" },
      { kind: "app", value: "Figma" },
    ],
  ),
  seedProject(
    MOCK_ORG_ID,
    "qa-seed-korean",
    "Korean study",
    "Korean listening practice and Anki reviews, weekday mornings.",
    "#2f7f78",
    "active",
    [{ kind: "app", value: "Anki" }],
  ),
  seedProject(
    MOCK_ORG_ID,
    "qa-seed-blog",
    "Blog relaunch",
    "Astro rewrite of the personal blog.",
    "#9b5b91",
    "archived",
    [],
  ),
];

const SEED_HOURS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "qa-seed-drifty": { "Minseok Park": 16.2, "Aria Chen": 12.8, "Devin Ross": 14.5, "Yuki Tanaka": 6.4 },
  "qa-seed-acme": { "Minseok Park": 3.4, "Aria Chen": 6.2, "Yuki Tanaka": 9.6, "Priya Nair": 2.2 },
  "qa-seed-korean": { "Minseok Park": 1.1, "Priya Nair": 4.8 },
};

const MEMBER_TEAM_SEED_PROJECTS: readonly TeamProject[] = [
  seedProject(
    MOCK_MEMBER_ORG_ID,
    "qa-seed-studio-research",
    "User research",
    "Interview synthesis and the usability study backlog.",
    "#2f7f78",
    "active",
    [{ kind: "app", value: "Dovetail" }],
  ),
  seedProject(
    MOCK_MEMBER_ORG_ID,
    "qa-seed-studio-design",
    "Design system",
    "Component library and Figma tokens.",
    "#a1792f",
    "active",
    [{ kind: "app", value: "Figma" }],
  ),
];

const MEMBER_TEAM_SEED_HOURS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "qa-seed-studio-research": { "Minseok Park": 4.2, "Hana Lee": 11.5 },
  "qa-seed-studio-design": { "Hana Lee": 3.1, "Joon Kim": 13.4 },
};

type ProjectHours = Readonly<Record<string, Readonly<Record<string, number>>>>;

const SEEDED_PROJECTS_BY_TEAM: Readonly<Record<string, readonly TeamProject[]>> = {
  [MOCK_ORG_ID]: SEED_PROJECTS,
  [MOCK_MEMBER_ORG_ID]: MEMBER_TEAM_SEED_PROJECTS,
};

const SEEDED_HOURS_BY_TEAM: Readonly<Record<string, ProjectHours>> = {
  [MOCK_ORG_ID]: SEED_HOURS,
  [MOCK_MEMBER_ORG_ID]: MEMBER_TEAM_SEED_HOURS,
};

const DAY_WEIGHTS = [1, 1.08, 0.92, 1.05, 0.72, 0.16, 0.08, 0.98, 1.12, 0.9, 1.02, 0.78, 0.2, 0.12] as const;

export function useTeamQaMockController(): UseTeamControllerResult {
  const [teams, setTeams] = useState<readonly OwnTeam[]>([MOCK_TEAM, MOCK_MEMBER_TEAM, MOCK_INVITING_MEMBER_TEAM]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(MOCK_ORG_ID);
  const [invitesByTeam, setInvitesByTeam] = useState<Readonly<Record<string, readonly TeamInvite[]>>>({
    [MOCK_ORG_ID]: [makeInvite("DRFT-K4M2-9QXZ")],
    [MOCK_MEMBER_ORG_ID]: [makeInvite("DRFT-SEOU-7PRD", MOCK_MEMBER_TEAM)],
  });
  const [rosterByTeam, setRosterByTeam] = useState<Readonly<Record<string, readonly TeamMember[]>>>({
    [MOCK_ORG_ID]: MOCK_OWNER_ROSTER,
  });
  const nextTeamIdRef = useRef(1);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.organization_id === selectedTeamId) ?? teams[0] ?? null,
    [selectedTeamId, teams],
  );
  // Only the owner reads the roster, as on the server.
  const members = useMemo(
    () => (selectedTeam && isTeamOwner(selectedTeam) ? rosterByTeam[selectedTeam.organization_id] ?? [MOCK_SELF_OWNER] : []),
    [rosterByTeam, selectedTeam],
  );
  // Members without invite permission cannot read invites, as on the server.
  const invites = useMemo(
    () => (selectedTeam && canInviteToTeam(selectedTeam) ? invitesByTeam[selectedTeam.organization_id] ?? [] : []),
    [invitesByTeam, selectedTeam],
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
      { ...MOCK_TEAM, organization_id: id, organization_name: "Joined Crew", role_label: "Member", member_count: 3, membership_role: "member" },
    ]);
    setSelectedTeamId(id);
  }, []);

  const handleCreateInvite = useCallback(async (input: { readonly organization_id: string }) => {
    const team = teams.find((candidate) => candidate.organization_id === input.organization_id) ?? MOCK_TEAM;
    setInvitesByTeam((current) => ({ ...current, [team.organization_id]: [makeInvite(randomInviteCode(), team)] }));
  }, [teams]);

  const handleRevokeInvite = useCallback(async (input: { readonly invite_id: string }) => {
    setInvitesByTeam((current) => Object.fromEntries(
      Object.entries(current).map(([teamId, teamInvites]) => [teamId, teamInvites.filter((invite) => invite.invite_id !== input.invite_id)]),
    ));
  }, []);

  const handleSetMemberInvites = useCallback(async (input: { readonly organization_id: string; readonly enabled: boolean }) => {
    setTeams((current) => current.map((team) => (
      team.organization_id === input.organization_id ? { ...team, members_can_invite: input.enabled } : team
    )));
  }, []);

  const handleRemoveMember = useCallback(async (input: { readonly organization_id: string; readonly member_key: string }) => {
    setRosterByTeam((current) => ({
      ...current,
      [input.organization_id]: (current[input.organization_id] ?? [MOCK_SELF_OWNER]).filter((member) => member.member_key !== input.member_key),
    }));
    setTeams((current) => current.map((team) => (
      team.organization_id === input.organization_id ? { ...team, member_count: Math.max(1, team.member_count - 1) } : team
    )));
    return true;
  }, []);

  const handleLeaveTeam = useCallback(async (input: { readonly organization_id: string }) => {
    const remaining = teams.filter((team) => team.organization_id !== input.organization_id);
    setTeams(remaining);
    setSelectedTeamId(remaining[0]?.organization_id ?? MOCK_ORG_ID);
    return true;
  }, [teams]);

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
    handleSetMemberInvites,
    members,
    refreshMembers: async () => undefined,
    handleRemoveMember,
    handleLeaveTeam,
    selectTeam: setSelectedTeamId,
  };
}

export type UseTeamQaMockProjectsInput = {
  readonly organizationId: string | null;
  readonly period: TeamPeriod;
  readonly windowOffset: number;
  readonly startOfDayMinutes: number;
};

export function useTeamQaMockProjects(input: UseTeamQaMockProjectsInput): UseTeamProjectsResult {
  const { organizationId, period, windowOffset, startOfDayMinutes } = input;
  const teamId = organizationId ?? MOCK_ORG_ID;
  // Each team keeps its own projects and hours, so switching teams shows that
  // team's data. The two seeded teams render immediately; a created or joined
  // team starts empty. Created projects pick up a rotating allocation preset.
  const [projectsByTeam, setProjectsByTeam] = useState<Readonly<Record<string, readonly TeamProject[]>>>(SEEDED_PROJECTS_BY_TEAM);
  const [hoursByTeam, setHoursByTeam] = useState<Readonly<Record<string, ProjectHours>>>(SEEDED_HOURS_BY_TEAM);
  const [stoppedTeams, setStoppedTeams] = useState<ReadonlySet<string>>(() => new Set());
  const projects = useMemo(() => projectsByTeam[teamId] ?? [], [projectsByTeam, teamId]);
  const hoursByProject = useMemo(() => hoursByTeam[teamId] ?? {}, [hoursByTeam, teamId]);
  const sharing = !stoppedTeams.has(teamId);
  const setProjects = useCallback((update: (current: readonly TeamProject[]) => readonly TeamProject[]) => {
    setProjectsByTeam((current) => ({ ...current, [teamId]: update(current[teamId] ?? []) }));
  }, [teamId]);
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
          organization_id: teamId,
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
          organization_id: teamId,
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
  }, [hoursByProject, projects, sharing, teamId, window.end_date, window.start_date]);

  const createProject = useCallback(async (fields: CreateTeamProjectFields) => {
    const creationIndex = nextProjectIdRef.current++;
    const id = `qa-created-${creationIndex}`;
    setProjects((current) => [
      ...current,
      {
        id,
        organization_id: teamId,
        name: fields.name,
        description: fields.description ?? "",
        color: fields.color || "#5366a3",
        status: "active" as const,
        anchors: fields.anchors ?? [],
        can_manage: true,
        created_at: "2026-07-11T09:00:00.000Z",
        updated_at: "2026-07-11T09:00:00.000Z",
      },
    ]);
    setHoursByTeam((current) => ({
      ...current,
      [teamId]: { ...(current[teamId] ?? {}), [id]: ALLOC_PRESETS[(creationIndex - 1) % ALLOC_PRESETS.length]! },
    }));
    return true;
  }, [setProjects, teamId]);

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
  }, [setProjects]);

  const archiveProject = useCallback(async (projectId: string, archived: boolean) => {
    setProjects((current) => current.map((project) => (
      project.id === projectId ? { ...project, status: archived ? "archived" as const : "active" as const } : project
    )));
    return true;
  }, [setProjects]);

  const publishMyTime = useCallback(async () => {
    setPublishing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setPublishing(false);
    setStoppedTeams((current) => {
      const next = new Set(current);
      next.delete(teamId);
      return next;
    });
    setPublishNote("Shared 20h 42m across 3 projects for this window.");
  }, [teamId]);

  const stopSharing = useCallback(async () => {
    setStoppedTeams((current) => new Set(current).add(teamId));
    setPublishNote("Stopped sharing — your published totals were removed from this team.");
  }, [teamId]);

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
