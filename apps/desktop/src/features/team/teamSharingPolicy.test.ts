import { describe, expect, it } from "vitest";

import {
  EMPTY_TEAM_SHARING_DRAFT,
  applySharingPreset,
  compareTeamSharingPolicies,
  completeTeamSharingPolicy,
  isManagerDraftComplete,
  legacyScopeForPolicy,
  matchingSharingPreset,
  policyForPreset,
  policyWithinCeiling,
  sharingPolicyAcrossTeams,
  sharingPolicyForGroup,
  teamSharingVisibility,
  teamsByFocusSharing,
  teamsWithoutSharedProjects,
  type TeamSharingPolicy,
} from "./teamSharingPolicy";
import type { TeamGroup } from "./teamTypes";

const timeline: TeamSharingPolicy = { projects: "hourly", tasks: "hourly", focus: "hourly", memberSummary: true };

const group = (id: string, parent: string | null): TeamGroup => ({ id, organization_id: "org", parent_group_id: parent, name: id, lead_display_name: null, member_count: 0 });
const groups = [group("division", null), group("growth", "division"), group("web", "division"), group("legal", null)];

describe("sharing across many teams", () => {
  it("lets a team share on its own policy, then its division's, then the organization's", () => {
    const fallback = policyForPreset("work_and_focus", true);
    const division = policyForPreset("work_log", true);
    const own = policyForPreset("project_totals", false);
    const policies = { division, growth: own };
    expect(sharingPolicyForGroup(fallback, policies, groups, "growth")).toBe(own);
    expect(sharingPolicyForGroup(fallback, policies, groups, "web")).toBe(division);
    expect(sharingPolicyForGroup(fallback, policies, groups, "legal")).toBe(fallback);
    expect(sharingPolicyForGroup(fallback, null, groups, null)).toBe(fallback);
  });

  it("adds teams together on project totals only and leaves out a team that keeps its project time", () => {
    const fallback = policyForPreset("full_timeline", false);
    const across = sharingPolicyAcrossTeams(fallback);
    expect(across).toEqual({ projects: "team", tasks: "off", focus: "off", memberSummary: false });
    expect(teamSharingVisibility(across).personal).toBe(false);
    const closed: TeamSharingPolicy = { projects: "off", tasks: "off", focus: "team", memberSummary: true };
    // A division is not a team: only the teams people sit in are listed, and a division's own policy reaches its teams.
    expect(teamsWithoutSharedProjects(fallback, { legal: closed }, groups)).toEqual(["legal"]);
    expect(teamsWithoutSharedProjects(fallback, { division: closed }, groups)).toEqual(["growth", "web"]);
  });

  it("keeps a manager's choice under a ceiling and splits teams by whether they share focus", () => {
    const ceiling = policyForPreset("work_and_focus", false);
    expect(policyWithinCeiling(policyForPreset("work_log", false), ceiling)).toBe(true);
    expect(policyWithinCeiling(policyForPreset("full_timeline", false), ceiling)).toBe(false);
    expect(policyWithinCeiling({ ...policyForPreset("project_totals", true) }, ceiling)).toBe(false);
    const fallback = policyForPreset("work_and_focus", true);
    expect(teamsByFocusSharing(fallback, { web: policyForPreset("work_log", true) }, groups, ["growth", "web", "legal"]))
      .toEqual({ sharing: ["growth", "legal"], withheld: ["web"] });
  });
});

describe("team sharing policy", () => {
  it("starts with nothing chosen and completes only once every item and the summary are set", () => {
    expect(completeTeamSharingPolicy(EMPTY_TEAM_SHARING_DRAFT)).toBeNull();
    const preset = applySharingPreset(EMPTY_TEAM_SHARING_DRAFT, "work_log");
    // A combination sets the three items but leaves the team-summary choice to the admin.
    expect(preset.memberSummary).toBeNull();
    expect(completeTeamSharingPolicy(preset)).toBeNull();
    expect(completeTeamSharingPolicy({ ...preset, memberSummary: false })).toEqual({ projects: "member_daily", tasks: "member_daily", focus: "off", memberSummary: false });
    expect(matchingSharingPreset(preset)).toBe("work_log");
    expect(matchingSharingPreset({ ...preset, focus: "team" })).toBeNull();
  });

  it("never lets a linked item show more than its own level", () => {
    // Work titles by time while projects are shared only as team totals and focus stays private.
    const visibility = teamSharingVisibility({ projects: "team", tasks: "hourly", focus: "off", memberSummary: true });
    expect(visibility).toMatchObject({ teamProjects: true, memberProjects: false, timelineTasks: true, timelineProjects: false, timelineFocus: false, memberFocus: false });
    // Focus per person per day says nothing about when in the day.
    expect(teamSharingVisibility({ projects: "off", tasks: "off", focus: "member_daily", memberSummary: false })).toMatchObject({ memberFocus: true, timeline: false, teamProjects: false });
  });

  it("separates what widens from what narrows, including the team summary", () => {
    const change = compareTeamSharingPolicies(
      { projects: "team", tasks: "off", focus: "hourly", memberSummary: true },
      { projects: "member_daily", tasks: "off", focus: "member_daily", memberSummary: false },
    );
    expect(change).toEqual({ widened: ["projects"], narrowed: ["focus", "memberSummary"] });
    expect(compareTeamSharingPolicies(timeline, timeline)).toEqual({ widened: [], narrowed: [] });
  });

  it("keeps the dashboards' single scope in step with the focus item", () => {
    expect(legacyScopeForPolicy({ ...timeline, focus: "off" })).toBe("projects");
    expect(legacyScopeForPolicy({ ...timeline, focus: "team" })).toBe("team_focus");
    expect(legacyScopeForPolicy({ ...timeline, focus: "member_daily" })).toBe("member_focus");
    expect(legacyScopeForPolicy(timeline)).toBe("focus_blocks");
  });

  it("asks a manager for a person, their teams and a grant", () => {
    expect(isManagerDraftComplete({ member_key: "m1", group_ids: [], access: null }, false)).toBe(false);
    expect(isManagerDraftComplete({ member_key: "m1", group_ids: [], access: "summary" }, false)).toBe(true);
    expect(isManagerDraftComplete({ member_key: "m1", group_ids: [], access: "detail" }, true)).toBe(false);
    expect(isManagerDraftComplete({ member_key: "m1", group_ids: ["g1"], access: "detail" }, true)).toBe(true);
  });
});
