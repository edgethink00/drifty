import { describe, expect, it } from "vitest";

import { applyTeamGroupEdits } from "./teamGroupEdits";
import type { TeamFocusDataset } from "./teamFocusModel";
import type { TeamDirectoryMember, TeamGroup } from "./teamTypes";

const group = (id: string, parent: string | null): TeamGroup => ({ id, organization_id: "org", parent_group_id: parent, name: id, lead_display_name: null, member_count: 0 });
const person = (key: string, groupId: string | null): TeamDirectoryMember => ({ member_key: key, display_name: key, role_label: "Member", membership_role: "member", group_id: groupId, is_self: false, weekly_goal_seconds: null });
const dataset = (groups: readonly TeamGroup[], members: readonly TeamDirectoryMember[]): TeamFocusDataset => ({ groups, members, focusDays: [], projectDays: [], presence: [] });

describe("applyTeamGroupEdits", () => {
  const base = dataset(
    [group("consumer", null), group("growth", "consumer"), group("web", "consumer"), group("legal", null)],
    [person("a", "growth"), person("b", "growth"), person("c", "web"), person("d", "legal")],
  );
  const sizes = (result: TeamFocusDataset) => Object.fromEntries(result.groups.map((g) => [g.id, g.member_count]));

  it("renames and moves teams, counting each team's people with its teams' people", () => {
    const result = applyTeamGroupEdits(base, { names: { web: "Web app" }, parents: { legal: "consumer" }, deleted: {} });
    expect(result.groups.find((g) => g.id === "web")!.name).toBe("Web app");
    expect(result.groups.find((g) => g.id === "legal")!.parent_group_id).toBe("consumer");
    expect(sizes(result)).toEqual({ consumer: 4, growth: 2, web: 1, legal: 1 });
  });

  it("moves a deleted team's people where the admin chose, or to no team", () => {
    const moved = applyTeamGroupEdits(base, { names: {}, parents: {}, deleted: { growth: "web" } });
    expect(moved.groups.map((g) => g.id)).toEqual(["consumer", "web", "legal"]);
    expect(moved.members.filter((m) => m.group_id === "web").map((m) => m.member_key)).toEqual(["a", "b", "c"]);
    expect(sizes(moved)).toEqual({ consumer: 3, web: 3, legal: 1 });
    const none = applyTeamGroupEdits(base, { names: {}, parents: {}, deleted: { legal: null } });
    expect(none.members.find((m) => m.member_key === "d")!.group_id).toBeNull();
  });

  it("follows a destination that was itself deleted, and lifts a deleted division's teams to the top", () => {
    const chained = applyTeamGroupEdits(base, { names: {}, parents: {}, deleted: { legal: "growth", growth: "web" } });
    expect(chained.members.find((m) => m.member_key === "d")!.group_id).toBe("web");
    const lifted = applyTeamGroupEdits(base, { names: {}, parents: {}, deleted: { consumer: null } });
    expect(lifted.groups.filter((g) => g.id !== "legal").map((g) => [g.id, g.parent_group_id])).toEqual([["growth", null], ["web", null]]);
  });
});
