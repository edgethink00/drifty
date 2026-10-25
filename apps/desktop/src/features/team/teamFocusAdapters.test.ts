import { describe, expect, it } from "vitest";

import { datasetFromTeamTotals } from "./teamFocusAdapters";
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
  });
});
