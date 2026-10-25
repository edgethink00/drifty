import { describe, expect, it } from "vitest";

import { previewViewerAssignment } from "./teamPreview";
import { scopeDatasetToGroups } from "./teamFocusModel";
import { buildTeamPreviewFixture, type TeamPreviewScenario } from "./teamPreviewScenarios";

const CLOCK = { today: "2026-10-16", nowMinuteOfDay: 14 * 60 + 10, nowMs: Date.parse("2026-10-16T05:10:00.000Z") };
const fixtureFor = (scenario: Partial<TeamPreviewScenario>) => buildTeamPreviewFixture({
  scenario: { scale: "enterprise", scope: "member_focus", viewer: "manager", policy: "managed", ...scenario },
  ...CLOCK,
});

describe("what a seat may see", () => {
  it("gives a manager one team, three teams apart, or their division", () => {
    const fixture = fixtureFor({});
    const self = fixture.dataset.members.find((member) => member.is_self)!;
    const home = fixture.dataset.groups.find((group) => group.id === self.group_id)!;

    expect(previewViewerAssignment(fixture)).toEqual(expect.objectContaining({ member_key: self.member_key, group_ids: [home.id], access: "detail" }));
    expect(previewViewerAssignment(fixtureFor({ managerReach: "division", managerAccess: "summary" }))).toEqual(expect.objectContaining({ group_ids: [home.parent_group_id], access: "summary" }));
    const several = previewViewerAssignment(fixtureFor({ managerReach: "several" }))!;
    expect(several.group_ids).toHaveLength(3);
    const parents = new Set(several.group_ids.map((id) => fixture.dataset.groups.find((group) => group.id === id)?.parent_group_id));
    expect(parents.size).toBeGreaterThan(1);
  });

  it("manages a team without groups whole, and gives owners and members no assignment", () => {
    expect(previewViewerAssignment(fixtureFor({ scale: "team" }))).toEqual(expect.objectContaining({ group_ids: [] }));
    expect(previewViewerAssignment(fixtureFor({ viewer: "owner" }))).toBeNull();
    expect(previewViewerAssignment(fixtureFor({ viewer: "member" }))).toBeNull();
  });

  it("keeps only the assigned teams' people and records, with those teams on top", () => {
    const fixture = fixtureFor({ managerReach: "several" });
    const ids = previewViewerAssignment(fixture)!.group_ids;
    const scoped = scopeDatasetToGroups(fixture.dataset, ids);

    expect(scoped.groups.filter((group) => group.parent_group_id === null).map((group) => group.id).sort()).toEqual([...ids].sort());
    expect(scoped.members.length).toBeGreaterThan(0);
    expect(scoped.members.every((member) => member.group_id !== null && ids.includes(member.group_id))).toBe(true);
    const keys = new Set(scoped.members.map((member) => member.member_key));
    expect(scoped.focusDays.every((row) => keys.has(row.member_key))).toBe(true);
    expect(scoped.projectDays.every((row) => keys.has(row.member_key))).toBe(true);
    // Nobody outside the three teams survives, including the organization's admins.
    expect(scoped.members.some((member) => member.membership_role === "owner")).toBe(false);
  });

  it("keeps a division's teams under it and leaves a dataset without groups untouched", () => {
    const fixture = fixtureFor({ managerReach: "division" });
    const division = previewViewerAssignment(fixture)!.group_ids[0]!;
    const scoped = scopeDatasetToGroups(fixture.dataset, [division]);
    expect(scoped.groups.find((group) => group.id === division)?.parent_group_id).toBeNull();
    expect(scoped.groups.filter((group) => group.parent_group_id === division).length).toBeGreaterThan(1);

    const flat = fixtureFor({ scale: "team" });
    expect(scopeDatasetToGroups(flat.dataset, ["anything"])).toBe(flat.dataset);
    expect(scopeDatasetToGroups(fixture.dataset, null)).toBe(fixture.dataset);
  });
});
