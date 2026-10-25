import { describe, expect, it, vi } from "vitest";

import { buildTeamOverviewModel } from "./teamFocusModel";
import { TEAM_MEMBER_HISTORY_POSITION_KEY, readTeamMemberHistoryPosition, writeTeamMemberHistoryPosition, buildTeamPreviewFixture, isTeamPreviewOrganizationId, parseTeamPreviewScenario, teamPreviewScenarioKey } from "./teamPreviewScenarios";
import { DEFAULT_TEAM_SHARING_SCOPE, parseTeamSharingScope, scopeIncludes, scopeSharesFocusBlocks, scopeSharesMemberFocus, scopeSharesTeamFocus } from "./teamSharingScope";

const CLOCK = { today: "2026-10-16", nowMinuteOfDay: 14 * 60 + 10, nowMs: Date.parse("2026-10-16T05:10:00.000Z") };

describe("team sharing scopes", () => {
  it("orders the scopes so a wider one includes every narrower one", () => {
    expect(DEFAULT_TEAM_SHARING_SCOPE).toBe("member_focus");
    expect(scopeIncludes("focus_blocks", "projects")).toBe(true);
    expect(scopeIncludes("projects", "team_focus")).toBe(false);
    expect(scopeSharesTeamFocus("team_focus")).toBe(true);
    expect(scopeSharesMemberFocus("team_focus")).toBe(false);
    expect(scopeSharesFocusBlocks("member_focus")).toBe(false);
    expect(scopeSharesFocusBlocks("focus_blocks")).toBe(true);
    expect(scopeSharesTeamFocus(null)).toBe(false);
    expect(parseTeamSharingScope("apps")).toBeNull();
    expect(parseTeamSharingScope("projects")).toBe("projects");
  });
});

describe("team preview scenarios", () => {
  it("parses only complete scenarios and keys them stably", () => {
    expect(parseTeamPreviewScenario({ scale: "team", scope: "projects", viewer: "owner", policy: "free" })).toEqual({ scale: "team", scope: "projects", viewer: "owner", policy: "free" });
    expect(parseTeamPreviewScenario({ scale: "huge", scope: "projects", viewer: "owner", policy: "free" })).toBeNull();
    expect(parseTeamPreviewScenario("team")).toBeNull();
    expect(teamPreviewScenarioKey({ scale: "company", scope: "member_focus", viewer: "manager", policy: "managed" })).toBe("company/member_focus/manager/managed");
    // The former group-lead seat opens as a manager; sharing and the manager's grant ride along.
    expect(parseTeamPreviewScenario({ scale: "company", scope: "projects", viewer: "lead", policy: "free", sharing: "work_log", memberSummary: false, managerAccess: "summary", managerReach: "several" }))
      .toEqual({ scale: "company", scope: "projects", viewer: "manager", policy: "free", sharing: "work_log", memberSummary: false, managerAccess: "summary", managerReach: "several" });
    expect(parseTeamPreviewScenario({ scale: "team", scope: "projects", viewer: "owner", policy: "free", sharing: "everything", managerReach: "all" }))
      .toEqual({ scale: "team", scope: "projects", viewer: "owner", policy: "free" });
    expect(isTeamPreviewOrganizationId("qa-preview-team")).toBe(true);
    expect(isTeamPreviewOrganizationId("3f9d1815-c301-805d-a5f8-edc875b77de6")).toBe(false);
  });

  it("builds the same fixture for the same scenario and day, with the viewer first", () => {
    // Given
    const scenario = { scale: "team", scope: "member_focus", viewer: "owner", policy: "managed" } as const;

    // When
    const first = buildTeamPreviewFixture({ scenario, ...CLOCK });
    const second = buildTeamPreviewFixture({ scenario, ...CLOCK });

    // Then
    expect(second.dataset.focusDays).toEqual(first.dataset.focusDays);
    expect(first.dataset.members).toHaveLength(8);
    expect(first.dataset.members[0]).toEqual(expect.objectContaining({ is_self: true, membership_role: "owner" }));
    expect(first.team).toEqual(expect.objectContaining({ organization_name: "Sales Team", member_count: 8, sharing_scope: "member_focus", tracking_policy: "managed", group_count: 0 }));
    expect(first.team.recording_schedule?.days).toEqual([1, 2, 3, 4, 5]);
    expect(first.projects.filter((project) => project.status === "active")).toHaveLength(4);
    expect(first.roster).toHaveLength(8);
  });

  it("scales to groups and nested divisions and seats a manager viewer in their own group", () => {
    // Given
    const company = buildTeamPreviewFixture({ scenario: { scale: "company", scope: "member_focus", viewer: "manager", policy: "free" }, ...CLOCK });
    const enterprise = buildTeamPreviewFixture({ scenario: { scale: "enterprise", scope: "focus_blocks", viewer: "owner", policy: "managed" }, ...CLOCK });

    // Then
    expect(company.dataset.groups).toHaveLength(7);
    expect(company.dataset.members[0]).toEqual(expect.objectContaining({ is_self: true, membership_role: "lead", group_id: "qa-group-sales" }));
    expect(company.team.viewer_group_id).toBe("qa-group-sales");
    expect(company.dataset.groups.find((group) => group.id === "qa-group-sales")?.lead_display_name).toBe(company.dataset.members[0]!.display_name);
    expect(company.team.tracking_policy).toBe("free");
    expect(company.team.recording_schedule).toBeNull();

    expect(enterprise.dataset.groups.filter((group) => group.parent_group_id === null)).toHaveLength(4);
    expect(enterprise.dataset.groups.filter((group) => group.parent_group_id !== null)).toHaveLength(14);
    expect(company.dataset.members).toHaveLength(100);
    expect(enterprise.dataset.members).toHaveLength(500);
    const platform = enterprise.dataset.groups.find((group) => group.id === "qa-div-platform")!;
    const platformTeams = enterprise.dataset.groups.filter((group) => group.parent_group_id === platform.id);
    expect(platform.member_count).toBe(platformTeams.reduce((sum, group) => sum + group.member_count, 0));
    // Two teams in each organization start on their own sharing, so mixed policies preview at once.
    expect(company.groupSharing).toEqual({ "qa-group-engineering": "work_log", "qa-group-legal": "project_totals" });
    expect(Object.keys(enterprise.groupSharing)).toHaveLength(2);
  });

  it("previews a team of three, exactly at the line for totals", () => {
    const trio = buildTeamPreviewFixture({ scenario: { scale: "trio", scope: "member_focus", viewer: "member", policy: "managed" }, ...CLOCK });
    expect(trio.dataset.members).toHaveLength(3);
    expect(trio.dataset.groups).toHaveLength(0);
    expect(trio.groupSharing).toEqual({});
    expect(trio.team.member_count).toBe(3);
  });

  it("keeps every block inside the workday and today partial, and the overview reads the fixture", () => {
    // Given
    const fixture = buildTeamPreviewFixture({ scenario: { scale: "team", scope: "focus_blocks", viewer: "owner", policy: "managed" }, ...CLOCK });

    // When
    const model = buildTeamOverviewModel(fixture.dataset, {
      scope: "focus_blocks",
      policy: "managed",
      window: { start_date: "2026-10-10", end_date: "2026-10-16" },
      today: CLOCK.today,
      nowMs: CLOCK.nowMs,
      groupId: null,
      projects: fixture.projects,
      viewerRole: "owner",
      expectedWeekdays: fixture.expectedWeekdays,
      dailyGoalSeconds: 3 * 3600,
    });

    // Then
    for (const day of fixture.dataset.focusDays) {
      for (const block of day.blocks ?? []) {
        expect(block.start_minute).toBeGreaterThanOrEqual(9 * 60);
        expect(block.end_minute).toBeLessThanOrEqual(day.activity_date === CLOCK.today ? CLOCK.nowMinuteOfDay : 18 * 60 + 30);
        expect(block.end_minute).toBeGreaterThan(block.start_minute);
      }
      expect(day.focus_seconds).toBe((day.blocks ?? []).reduce((sum, block) => sum + (block.end_minute - block.start_minute) * 60, 0));
    }
    expect(model.memberCards).toHaveLength(8);
    expect(model.teamFocusSeconds).toBeGreaterThan(0);
    expect(model.trackingNow?.total).toBe(8);
    expect(model.focusByDay.find((point) => point.isToday)?.seconds).toBeGreaterThan(0);
  });
});



it("keeps review tab graph choices independent and lets a Dev change replace the current tab override", () => {
  const storage = (initial?: string) => {
    const values = new Map<string, string>(initial ? [[TEAM_MEMBER_HISTORY_POSITION_KEY, initial]] : []);
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  };
  const localStorage = storage("below");
  const first = { localStorage, sessionStorage: storage("above") };
  const second = { localStorage, sessionStorage: storage("below") };
  try {
    vi.stubGlobal("window", { localStorage: storage(), sessionStorage: storage() });
    expect(readTeamMemberHistoryPosition()).toBe("below");
    vi.stubGlobal("window", first);
    expect(readTeamMemberHistoryPosition()).toBe("above");
    vi.stubGlobal("window", second);
    expect(readTeamMemberHistoryPosition()).toBe("below");
    vi.stubGlobal("window", first);
    expect(readTeamMemberHistoryPosition()).toBe("above");
    writeTeamMemberHistoryPosition("below");
    expect(first.sessionStorage.getItem(TEAM_MEMBER_HISTORY_POSITION_KEY)).toBeNull();
    expect(readTeamMemberHistoryPosition()).toBe("below");
    expect(localStorage.getItem(TEAM_MEMBER_HISTORY_POSITION_KEY)).toBeNull();
    writeTeamMemberHistoryPosition("above");
    expect(readTeamMemberHistoryPosition()).toBe("above");
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("a team made a moment ago", () => {
  it("previews only its maker, with no projects and nothing shared", () => {
    const fixture = buildTeamPreviewFixture({ scenario: { scale: "fresh", scope: "member_focus", viewer: "owner", policy: "free" }, ...CLOCK });
    expect(fixture.dataset.members.map((member) => member.is_self)).toEqual([true]);
    expect(fixture.team.member_count).toBe(1);
    expect(fixture.projects).toEqual([]);
    expect(fixture.dataset.focusDays).toEqual([]);
    expect(fixture.dataset.projectDays).toEqual([]);
  });
});
