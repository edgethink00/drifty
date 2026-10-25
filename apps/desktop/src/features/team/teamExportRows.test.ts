import { describe, expect, it } from "vitest";

import { teamExportCsv, teamExportRowsFromDataset, teamExportRowsFromTotals } from "./teamExportRows";
import type { TeamFocusDataset } from "./teamFocusModel";

const member = (key: string, name: string, group: string | null) => ({ member_key: key, display_name: name, role_label: "", membership_role: "member" as const, group_id: group, is_self: false, weekly_goal_seconds: null });
const focus = (key: string, day: string, seconds: number) => ({ member_key: key, activity_date: day, focus_seconds: seconds, tracked_seconds: seconds, deep_block_count: 0, deep_block_seconds: 0, longest_block_seconds: 0, longest_block_start_minute: null, blocks: null });
const dataset: TeamFocusDataset = {
  members: [member("a", "Ana", "sales"), member("b", "Ben", "sales"), member("c", "Cho", "eng")],
  groups: [
    { id: "sales", organization_id: "o", parent_group_id: null, name: "Sales", lead_display_name: null, member_count: 2 },
    { id: "eng", organization_id: "o", parent_group_id: null, name: "Engineering", lead_display_name: null, member_count: 1 },
  ],
  projectDays: [
    { member_key: "a", organization_project_id: "p1", activity_date: "2026-10-20", seconds: 3600 },
    { member_key: "b", organization_project_id: "p1", activity_date: "2026-10-20", seconds: 1800 },
    { member_key: "c", organization_project_id: null, activity_date: "2026-10-20", seconds: 900 },
    { member_key: "a", organization_project_id: "p1", activity_date: "2026-10-10", seconds: 7200 },
  ],
  focusDays: [focus("a", "2026-10-20", 2400)],
  presence: [],
};
const names = { projectName: (id: string | null) => (id === "p1" ? "Proposal prep" : "Unassigned"), focusLabel: "Focus time" };
const window = { start_date: "2026-10-19", end_date: "2026-10-21" };

describe("teamExportRows", () => {
  it("writes a row per day, person and project where people are shared, with focus only where it is", () => {
    const rows = teamExportRowsFromDataset(dataset, { ...names, window, groupId: null, scopeName: "Brightline", cut: { people: true, personFocus: true, teamFocus: true, teams: [] } });
    expect(rows.map((row) => [row.team, row.person, row.project, row.seconds])).toEqual([
      ["Engineering", "Cho", "Unassigned", 900],
      ["Sales", "Ana", "Proposal prep", 3600],
      ["Sales", "Ana", "Focus time", 2400],
      ["Sales", "Ben", "Proposal prep", 1800],
    ]);
    const noFocus = teamExportRowsFromDataset(dataset, { ...names, window, groupId: null, scopeName: "Brightline", cut: { people: true, personFocus: false, teamFocus: false, teams: [] } });
    expect(noFocus.some((row) => row.project === "Focus time")).toBe(false);
  });

  it("sums each team the seat sees where people are not shared, and leaves out the teams it does not", () => {
    const rows = teamExportRowsFromDataset(dataset, { ...names, window, groupId: null, scopeName: "Brightline", cut: { people: false, personFocus: false, teamFocus: false, teams: [{ id: "sales", name: "Sales" }] } });
    expect(rows).toEqual([{ date: "2026-10-20", team: "Sales", person: null, project: "Proposal prep", seconds: 5400, order: 0 }]);
    expect(teamExportCsv(rows, { date: "Date", team: "Team", person: "Person", project: "Project", hours: "Hours" }).split("\r\n")).toEqual([
      "Date,Team,Project,Hours",
      "2026-10-20,Sales,Proposal prep,1.5",
    ]);
  });

  it("takes the server's people rows where it sent them and its team rows only where it did not", () => {
    const base = { organization_project_id: "p1", member_key: null, member_display_name: null, is_self: false, activity_date: "2026-10-20", seconds: 3600 };
    const teamOnly = teamExportRowsFromTotals([{ ...base, row_kind: "team_project" }, { ...base, row_kind: "team_focus", organization_project_id: null, seconds: 1200 }], { ...names, scopeName: "Sales" });
    expect(teamOnly.map((row) => [row.person, row.project, row.seconds])).toEqual([[null, "Proposal prep", 3600], [null, "Focus time", 1200]]);
    const withPeople = teamExportRowsFromTotals([
      { ...base, row_kind: "team_project", seconds: 5400 },
      { ...base, row_kind: "member_project", member_key: "k", member_display_name: "Ana" },
    ], { ...names, scopeName: "Sales" });
    expect(withPeople).toEqual([{ date: "2026-10-20", team: "Sales", person: "Ana", project: "Proposal prep", seconds: 3600, order: 0 }]);
  });
});
