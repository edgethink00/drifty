import { describe, expect, it } from "vitest";

import {
  buildTeamMemberDetailModel,
  buildTeamOverviewModel,
  groupSubtreeIds,
  membersInContainer,
  presenceVisible,
  type TeamFocusDataset,
  type TeamOverviewContext,
} from "./teamFocusModel";
import type { TeamDirectoryMember, TeamGroup, TeamMemberFocusDay, TeamProject } from "./teamTypes";

const TODAY = "2026-10-16"; // a Friday
const WINDOW = { start_date: "2026-10-10", end_date: "2026-10-16" };

function member(key: string, name: string, groupId: string | null = null, extra: Partial<TeamDirectoryMember> = {}): TeamDirectoryMember {
  return { member_key: key, display_name: name, role_label: "Engineer", membership_role: "member", group_id: groupId, is_self: false, weekly_goal_seconds: null, ...extra };
}

function focusDay(memberKey: string, day: string, focusHours: number, extra: Partial<TeamMemberFocusDay> = {}): TeamMemberFocusDay {
  return {
    member_key: memberKey,
    activity_date: day,
    focus_seconds: focusHours * 3600,
    tracked_seconds: focusHours * 3600 * 1.5,
    deep_block_count: 2,
    deep_block_seconds: 2 * 30 * 60,
    longest_block_seconds: 45 * 60,
    longest_block_start_minute: 9 * 60 + 30,
    blocks: [{ start_minute: 9 * 60, end_minute: 9 * 60 + 45, project_id: "p1" }, { start_minute: 14 * 60, end_minute: 14 * 60 + 30, project_id: null }],
    ...extra,
  };
}

const PROJECTS: readonly TeamProject[] = [
  { id: "p1", organization_id: "org", name: "Campaign", description: "", color: "#111", status: "active", anchors: [], can_manage: true, created_at: "", updated_at: "" },
  { id: "p2", organization_id: "org", name: "Reports", description: "", color: "#222", status: "active", anchors: [], can_manage: true, created_at: "", updated_at: "" },
];

function context(overrides: Partial<TeamOverviewContext> = {}): TeamOverviewContext {
  return {
    scope: "member_focus",
    policy: "free",
    window: WINDOW,
    today: TODAY,
    nowMs: Date.parse("2026-10-16T05:10:00.000Z"),
    groupId: null,
    projects: PROJECTS,
    viewerRole: "owner",
    expectedWeekdays: [1, 2, 3, 4, 5],
    dailyGoalSeconds: 3 * 3600,
    ...overrides,
  };
}

function dataset(overrides: Partial<TeamFocusDataset> = {}): TeamFocusDataset {
  return {
    // Three people, the fewest a total shows for.
    members: [member("a", "Ada"), member("b", "Ben"), member("c", "Cy")],
    groups: [],
    focusDays: [
      focusDay("a", "2026-10-12", 4),
      focusDay("a", "2026-10-13", 3),
      focusDay("b", "2026-10-12", 2),
      focusDay("c", "2026-10-14", 3),
      // The previous window, for deltas.
      focusDay("a", "2026-10-05", 2),
      focusDay("b", "2026-10-06", 2),
    ],
    projectDays: [
      { member_key: "a", organization_project_id: "p1", activity_date: "2026-10-12", seconds: 3 * 3600 },
      { member_key: "a", organization_project_id: "p2", activity_date: "2026-10-12", seconds: 3600 },
      { member_key: "a", organization_project_id: null, activity_date: "2026-10-13", seconds: 3 * 3600 },
      { member_key: "b", organization_project_id: "p2", activity_date: "2026-10-12", seconds: 2 * 3600 },
      { member_key: "c", organization_project_id: "p2", activity_date: "2026-10-14", seconds: 2 * 3600 },
    ],
    presence: [
      { member_key: "a", tracking: true, last_seen_at: "2026-10-16T05:08:00.000Z" },
      { member_key: "b", tracking: true, last_seen_at: "2026-10-16T03:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("buildTeamOverviewModel", () => {
  it("sums the team's focus, compares it with the previous window and averages per sharing member per expected day", () => {
    // Given
    const model = buildTeamOverviewModel(dataset(), context());

    // Then
    expect(model.teamFocusSeconds).toBe(12 * 3600);
    expect(model.previousTeamFocusSeconds).toBe(4 * 3600);
    expect(model.deltaPct).toBe(200);
    // Mon–Fri up to today: Oct 12, 13, 14, 15, 16 → 5 expected days, 3 sharing members.
    expect(model.elapsedExpectedDays).toBe(5);
    expect(model.sharingMemberCount).toBe(3);
    expect(model.avgPerMemberPerDaySeconds).toBeCloseTo((12 * 3600) / 3 / 5);
    expect(model.goalPct).toBe(27);
    expect(model.deepBlockCount).toBe(8);
    expect(model.avgDeepBlockSeconds).toBe(30 * 60);
  });

  it("ranks project time with unassigned last and keeps every member's card at every scope", () => {
    // Given
    const model = buildTeamOverviewModel(dataset(), context());

    // Then
    expect(model.focusByProject.map((share) => [share.name, share.seconds])).toEqual([
      ["Reports", 5 * 3600],
      ["Campaign", 3 * 3600],
      [null, 3 * 3600],
    ]);
    expect(model.memberCards.map((card) => card.member.display_name)).toEqual(["Ada", "Ben", "Cy"]);
    const ada = model.memberCards[0]!;
    expect(ada.focusSeconds).toBe(7 * 3600);
    expect(ada.deltaPct).toBe(250);
    expect(ada.topProject?.name).toBe("Campaign");
    expect(ada.moreProjects).toBe(2);
    expect(ada.trackedDays).toBe(2);
    expect(ada.sparse).toBe(true);
  });

  it("hides every per-member number below the member_focus scope", () => {
    // Given
    const teamFocus = buildTeamOverviewModel(dataset(), context({ scope: "team_focus" }));
    const projectsOnly = buildTeamOverviewModel(dataset(), context({ scope: "projects" }));

    // Then
    expect(teamFocus.teamFocusVisible).toBe(true);
    expect(teamFocus.memberFocusVisible).toBe(false);
    expect(teamFocus.teamFocusSeconds).toBe(12 * 3600);
    expect(teamFocus.memberCards.every((card) => card.focusSeconds === 0 && card.deltaPct === null && card.deepBlockCount === 0)).toBe(true);
    expect(teamFocus.memberCards[0]!.projects.map((share) => share.name)).toEqual(["Campaign", "Reports"]);

    expect(projectsOnly.teamFocusVisible).toBe(false);
    // Without focus sharing, the headline is the team-project total.
    expect(projectsOnly.teamFocusSeconds).toBe(8 * 3600);
    expect(projectsOnly.deepBlockCount).toBe(0);
    expect(projectsOnly.focusByDay.find((point) => point.day === "2026-10-12")?.seconds).toBe(6 * 3600);
  });

  it("shares unassigned time only where the scope shares that focus: pooled from team_focus, per person from member_focus", () => {
    // Given
    const projectsOnly = buildTeamOverviewModel(dataset(), context({ scope: "projects" }));
    const teamFocus = buildTeamOverviewModel(dataset(), context({ scope: "team_focus" }));
    const memberFocus = buildTeamOverviewModel(dataset(), context({ scope: "member_focus" }));
    const detailAt = (scope: TeamOverviewContext["scope"]) => buildTeamMemberDetailModel(dataset(), { ...context({ scope }), memberKey: "a" });

    // Then
    expect(projectsOnly.focusByProject.some((share) => share.projectId === null)).toBe(false);
    expect(projectsOnly.focusByDayProject.every((day) => day.shares.every((share) => share.projectId !== null))).toBe(true);
    expect(teamFocus.focusByProject.find((share) => share.projectId === null)?.seconds).toBe(3 * 3600);
    expect(teamFocus.memberCards.every((card) => card.projects.every((share) => share.projectId !== null))).toBe(true);
    expect(memberFocus.memberCards[0]!.projects.find((share) => share.projectId === null)?.seconds).toBe(3 * 3600);

    expect(detailAt("projects")?.projects.some((share) => share.projectId === null)).toBe(false);
    expect(detailAt("team_focus")?.dayRows.every((row) => row.shares.every((share) => share.projectId !== null))).toBe(true);
    expect(detailAt("team_focus")?.lastWindows.every((point) => point.shares.every((share) => share.projectId !== null))).toBe(true);
    expect(detailAt("member_focus")?.projects.find((share) => share.projectId === null)?.seconds).toBe(3 * 3600);
  });

  it("shows tracking presence only under a managed policy to leads and admins, and only while fresh", () => {
    // Given
    const free = buildTeamOverviewModel(dataset(), context({ policy: "free" }));
    const managedOwner = buildTeamOverviewModel(dataset(), context({ policy: "managed", viewerRole: "owner" }));
    const managedMember = buildTeamOverviewModel(dataset(), context({ policy: "managed", viewerRole: "member" }));

    // Then
    expect(free.trackingNow).toBeNull();
    expect(free.memberCards[0]!.tracking).toBeNull();
    expect(managedOwner.trackingNow).toEqual(expect.objectContaining({ count: 1, total: 3 }));
    expect(managedOwner.memberCards.map((card) => card.tracking)).toEqual([true, false, false]);
    expect(managedMember.trackingNow).toBeNull();
    expect(presenceVisible("managed", "lead")).toBe(true);
    expect(presenceVisible("free", "owner")).toBe(false);
  });

  it("rolls groups up as cards and lists only ungrouped members at that level", () => {
    // Given
    const groups: TeamGroup[] = [
      { id: "div", organization_id: "org", parent_group_id: null, name: "Division", lead_display_name: null, member_count: 2 },
      { id: "team", organization_id: "org", parent_group_id: "div", name: "Team", lead_display_name: "Ben", member_count: 1 },
    ];
    const data = dataset({ members: [member("a", "Ada", "team"), member("b", "Ben", "div"), member("c", "Cy", null, { membership_role: "owner" })], groups });

    // When
    const top = buildTeamOverviewModel(data, context());
    const division = buildTeamOverviewModel(data, context({ groupId: "div" }));
    const flat = buildTeamOverviewModel(data, context({ flattenGroups: true }));

    // Then
    expect(groupSubtreeIds(groups, "div")).toEqual(new Set(["div", "team"]));
    expect(membersInContainer(data.members, groups, "div").map((candidate) => candidate.member_key)).toEqual(["a", "b"]);
    expect(top.groupCards.map((card) => [card.group.name, card.memberCount, card.childGroupCount])).toEqual([["Division", 2, 1]]);
    expect(top.memberCards.map((card) => card.member.member_key)).toEqual(["c"]);
    expect(division.memberCount).toBe(2);
    expect(division.groupCards.map((card) => card.group.name)).toEqual(["Team"]);
    expect(division.memberCards.map((card) => card.member.member_key)).toEqual(["b"]);
    expect(flat.groupCards).toEqual([]);
    expect(flat.memberCards.map((card) => card.member.member_key)).toEqual(["a", "b", "c"]);
  });

  it("gives team cards their projects and no focus total, and shows totals at any team size", () => {
    // Given: a team of three and a team of two, seen by the organization admin.
    const groups: TeamGroup[] = [
      { id: "big", organization_id: "org", parent_group_id: null, name: "Big", lead_display_name: null, member_count: 3 },
      { id: "small", organization_id: "org", parent_group_id: null, name: "Small", lead_display_name: null, member_count: 2 },
    ];
    const data = dataset({
      members: [member("a", "Ada", "big"), member("b", "Ben", "big"), member("c", "Cy", "big"), member("d", "Dee", "small"), member("e", "Eve", "small")],
      groups,
      focusDays: ["a", "b", "c", "d", "e"].map((key) => focusDay(key, "2026-10-12", 2)),
      projectDays: [
        { member_key: "a", organization_project_id: "p1", activity_date: "2026-10-12", seconds: 3 * 3600 },
        { member_key: "b", organization_project_id: "p2", activity_date: "2026-10-12", seconds: 3600 },
        { member_key: "c", organization_project_id: "p1", activity_date: "2026-10-12", seconds: 2 * 3600 },
        { member_key: "c", organization_project_id: null, activity_date: "2026-10-12", seconds: 3600 },
        { member_key: "d", organization_project_id: "p1", activity_date: "2026-10-12", seconds: 3600 },
        { member_key: "e", organization_project_id: "p2", activity_date: "2026-10-12", seconds: 3600 },
      ],
    });

    // When
    const top = buildTeamOverviewModel(data, context({ scope: "focus_blocks", viewerRole: "owner" }));
    const small = buildTeamOverviewModel(data, context({ scope: "focus_blocks", viewerRole: "owner", groupId: "small" }));
    const smallMember = buildTeamMemberDetailModel(data, { ...context({ scope: "focus_blocks", groupId: "small" }), memberKey: "d" });
    const bigMember = buildTeamMemberDetailModel(data, { ...context({ scope: "focus_blocks", groupId: "big" }), memberKey: "a" });

    // Then
    const [bigCard, smallCard] = top.groupCards;
    expect(bigCard).not.toHaveProperty("focusSeconds");
    // Team projects only: unassigned time is not a project.
    expect(bigCard!.projectSeconds).toBe(6 * 3600);
    expect(bigCard!.projectShares.map((share) => [share.name, share.seconds])).toEqual([["Campaign", 5 * 3600], ["Reports", 3600]]);
    // A team of two shows its totals too (owner decision 2026-10-22): the team's sharing decides, not a head count.
    expect(smallCard).toEqual(expect.objectContaining({ sharingMemberCount: 2, projectSeconds: 2 * 3600 }));
    expect(smallCard!.projectShares.map((share) => [share.name, share.seconds])).toEqual([["Campaign", 3600], ["Reports", 3600]]);

    // Opened on its own, the small team shows its totals and its people.
    expect(small.teamFocusSeconds).toBe(4 * 3600);
    expect(small.focusByProject.length).toBeGreaterThan(0);
    expect(small.focusByDay.some((point) => point.seconds > 0)).toBe(true);
    expect(small.memberCards.map((card) => card.member.member_key)).toEqual(["d", "e"]);
    expect(smallMember?.lastWindows[smallMember.lastWindows.length - 1]?.teamAvgSeconds).toBe(2 * 3600);
    expect(bigMember?.lastWindows[bigMember.lastWindows.length - 1]?.teamAvgSeconds).toBe(2 * 3600);
  });
});

describe("buildTeamMemberDetailModel", () => {
  it("builds one member's window with blocks only at the focus_blocks scope", () => {
    // Given
    const data = dataset({ members: [member("a", "Ada", null, { weekly_goal_seconds: 6 * 3600 }), member("b", "Ben"), member("c", "Cy")] });

    // When
    const withBlocks = buildTeamMemberDetailModel(data, { ...context({ scope: "focus_blocks" }), memberKey: "a" });
    const memberFocus = buildTeamMemberDetailModel(data, { ...context({ scope: "member_focus" }), memberKey: "a" });
    const projectsOnly = buildTeamMemberDetailModel(data, { ...context({ scope: "projects" }), memberKey: "a" });
    const missing = buildTeamMemberDetailModel(data, { ...context(), memberKey: "zzz" });

    // Then
    expect(missing).toBeNull();
    expect(withBlocks?.focusSeconds).toBe(7 * 3600);
    expect(withBlocks?.deltaPct).toBe(250);
    expect(withBlocks?.mainProject?.name).toBe("Campaign");
    expect(withBlocks?.mainProjectPct).toBe(43);
    expect(withBlocks?.longestBlockSeconds).toBe(45 * 60);
    expect(withBlocks?.blocksVisible).toBe(true);
    expect(withBlocks?.dayRows.find((row) => row.day === "2026-10-12")?.blocks?.length).toBe(2);
    expect(withBlocks?.dayRows.find((row) => row.day === "2026-10-10")?.expected).toBe(false);
    expect(withBlocks?.focusVisible).toBe(true);
    expect(withBlocks?.lastWindows).toHaveLength(4);
    expect(withBlocks?.lastWindows[3]).toEqual(expect.objectContaining({ isCurrent: true, memberSeconds: 7 * 3600, teamAvgSeconds: 4 * 3600 }));

    expect(memberFocus?.blocksVisible).toBe(false);
    expect(memberFocus?.focusVisible).toBe(true);
    expect(memberFocus?.longestBlockStartMinute).toBeNull();
    expect(withBlocks?.longestBlockStartMinute).toBe(9 * 60 + 30);
    expect(memberFocus?.dayRows.every((row) => row.blocks === null)).toBe(true);

    expect(projectsOnly?.focusVisible).toBe(false);
    expect(projectsOnly?.lastWindows.every((point) => point.teamAvgSeconds === 0)).toBe(true);
    expect(projectsOnly?.dayRows.every((row) => !row.tracked)).toBe(true);
    expect(projectsOnly?.dayRows.every((row) => row.focusSeconds === 0 && row.blocks === null)).toBe(true);
  });
});

