import { describe, expect, it } from "vitest";

import { datasetFromTeamTotals } from "./teamFocusAdapters";
import { buildTeamOverviewModel, buildTeamMemberDetailModel } from "./teamFocusModel";
import type { TeamTotalsRow } from "./teamSharingService";

const row = (overrides: Partial<TeamTotalsRow>): TeamTotalsRow => ({
  row_kind: "member_project", organization_project_id: "p1", member_key: "k-ana", member_display_name: "Ana",
  is_self: false, activity_date: "2026-10-20", seconds: 3600, ...overrides,
});

describe("datasetFromTeamTotals", () => {
  it("keeps each person's project time and focus on its own day and leaves team-only rows out", () => {
    const dataset = datasetFromTeamTotals([
      row({}),
      row({ activity_date: "2026-10-21", seconds: 1800 }),
      row({ row_kind: "member_focus", organization_project_id: null, seconds: 2400 }),
      row({ member_key: "k-me", member_display_name: "Me", is_self: true, seconds: 600 }),
      row({ row_kind: "team_project", member_key: null, member_display_name: null, seconds: 9000 }),
    ]);
    expect(dataset.members.map((member) => [member.member_key, member.is_self])).toEqual([["k-ana", false], ["k-me", true]]);
    expect(dataset.projectDays.map((day) => [day.member_key, day.activity_date, day.seconds])).toEqual([
      ["k-ana", "2026-10-20", 3600],
      ["k-ana", "2026-10-21", 1800],
      ["k-me", "2026-10-20", 600],
    ]);
    expect(dataset.focusDays).toEqual([expect.objectContaining({ member_key: "k-ana", activity_date: "2026-10-20", focus_seconds: 2400, blocks: null })]);
    expect(dataset.teamTotals).toBeUndefined();
  });

  it("gives a seat shown only the team its pooled totals, with no per-person average", () => {
    const dataset = datasetFromTeamTotals([
      row({ member_key: "k-me", member_display_name: "Me", is_self: true, seconds: 600 }),
      row({ row_kind: "member_focus", organization_project_id: null, member_key: "k-me", member_display_name: "Me", is_self: true, seconds: 900 }),
      row({ row_kind: "team_project", member_key: null, member_display_name: null, seconds: 9000 }),
      row({ row_kind: "team_project", organization_project_id: "p2", member_key: null, member_display_name: null, activity_date: "2026-10-21", seconds: 3000 }),
      row({ row_kind: "team_project", organization_project_id: null, member_key: null, member_display_name: null, activity_date: "2026-10-21", seconds: 1200 }),
      row({ row_kind: "team_focus", organization_project_id: null, member_key: null, member_display_name: null, seconds: 14400 }),
      row({ row_kind: "team_focus", organization_project_id: null, member_key: null, member_display_name: null, activity_date: "2026-10-13", seconds: 7200 }),
    ]);
    expect(dataset.members.map((member) => member.member_key)).toEqual(["k-me"]);
    expect(dataset.teamTotals?.projectDays).toHaveLength(3);

    const context = {
      window: { start_date: "2026-10-19", end_date: "2026-10-25" },
      today: "2026-10-22",
      nowMs: Date.parse("2026-10-22T12:00:00Z"),
      groupId: null,
      projects: [{ id: "p1", name: "Q4", color: "#5b7a3d" }, { id: "p2", name: "CRM", color: "#55679e" }] as never,
      viewerRole: "member" as const,
      expectedWeekdays: [1, 2, 3, 4, 5],
      dailyGoalSeconds: 4 * 3600,
      policy: "free" as const,
    };
    const withFocus = buildTeamOverviewModel(dataset, { ...context, scope: "member_focus" });
    expect(withFocus.teamFocusSeconds).toBe(14400);
    expect(withFocus.previousTeamFocusSeconds).toBe(7200);
    expect(withFocus.focusByDay.find((point) => point.day === "2026-10-20")?.seconds).toBe(14400);
    expect(withFocus.focusByProject.map((share) => [share.projectId, share.seconds])).toEqual([["p1", 9000], ["p2", 3000], [null, 1200]]);
    expect(withFocus.avgPerMemberPerDaySeconds).toBe(0);

    // Below team focus, unassigned time is focus and stays out; the team's figure is its project time.
    const projectsOnly = buildTeamOverviewModel(dataset, { ...context, scope: "projects" });
    expect(projectsOnly.teamFocusSeconds).toBe(12000);
    expect(projectsOnly.focusByProject.map((share) => share.projectId)).toEqual(["p1", "p2"]);

    const self = buildTeamMemberDetailModel(dataset, { ...context, scope: "member_focus", memberKey: "k-me" } as never);
    expect(self?.lastWindows.every((week) => week.teamAvgSeconds === 0)).toBe(true);
  });
});
