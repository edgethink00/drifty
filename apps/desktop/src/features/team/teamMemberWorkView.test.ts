import { describe, expect, it } from "vitest";

import { buildTeamMemberDetailModel, listWindowDays, type TeamMemberDayRow } from "./teamFocusModel";
import { currentMemberCalendarPage, memberCalendarHours, memberCalendarPages, memberFocusRhythm } from "./teamMemberWorkView";
import { buildTeamPreviewFixture } from "./teamPreviewScenarios";

const days = (start: string, end: string, today = end): TeamMemberDayRow[] => listWindowDays({ start_date: start, end_date: end }).map((day) => ({ day, isToday: day === today, isFuture: day > today, expected: true, focusSeconds: 0, tracked: false, blocks: [], shares: [] }));

describe("member work calendar", () => {
  it("preserves all dates in a month, groups Monday weeks, and opens on today", () => {
    const rows = days("2026-10-01", "2026-10-31", "2026-10-17");
    const pages = memberCalendarPages(rows);
    expect(pages.map((page) => page.length)).toEqual([4, 7, 7, 7, 6]);
    expect(pages.flat()).toEqual(rows);
    expect(currentMemberCalendarPage(pages)).toBe(2);
    expect(currentMemberCalendarPage(memberCalendarPages(days("2026-09-01", "2026-09-30", "2026-10-17")))).toBe(4);
    expect(memberCalendarPages([])).toEqual([]);
    expect(currentMemberCalendarPage([])).toBe(0);
  });

  it("keeps a selected rolling week together and fits early or late blocks", () => {
    const rows = days("2026-10-11", "2026-10-17");
    expect(memberCalendarPages(rows)).toEqual([rows]);
    expect(memberCalendarHours(rows)).toEqual({ start: 8, end: 19 });
    rows[0] = { ...rows[0]!, blocks: [{ start_minute: 6 * 60 + 15, end_minute: 6 * 60 + 45, project_id: "early" }, { start_minute: 23 * 60 + 20, end_minute: 24 * 60, project_id: "late" }] };
    expect(memberCalendarHours(rows)).toEqual({ start: 6, end: 24 });
  });
});

describe("member focus rhythm", () => {
  it("divides a block across hours without double-counting; lower scopes have no hourly signal", () => {
    const fixture = buildTeamPreviewFixture({ scenario: { scale: "team", scope: "focus_blocks", viewer: "owner", policy: "managed" }, today: "2026-10-17", nowMs: Date.parse("2026-10-17T05:10:00Z"), nowMinuteOfDay: 850 });
    const context = { scope: "focus_blocks" as const, policy: "managed" as const, window: { start_date: "2026-10-11", end_date: "2026-10-17" }, today: "2026-10-17", nowMs: 0, groupId: null, projects: fixture.projects, viewerRole: "owner" as const, expectedWeekdays: [1, 2, 3, 4, 5], dailyGoalSeconds: 10800, memberKey: fixture.dataset.members[0]!.member_key };
    const model = buildTeamMemberDetailModel(fixture.dataset, context)!;
    const rhythm = memberFocusRhythm(model);
    expect(rhythm.reduce((sum, seconds) => sum + seconds, 0)).toBe(model.focusSeconds);
    const oneBlock = { ...model, dayRows: [{ ...model.dayRows[0]!, blocks: [{ start_minute: 9 * 60 + 40, end_minute: 11 * 60 + 10, project_id: null }] }] };
    expect(memberFocusRhythm(oneBlock).slice(9, 12)).toEqual([20 * 60, 60 * 60, 10 * 60]);
    expect(memberFocusRhythm({ ...oneBlock, blocksVisible: false })).toEqual(Array(24).fill(0));
  });
});
