import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(), teamAssignments: vi.fn(), windowAssignments: vi.fn(),
  membership: vi.fn(), publishFocus: vi.fn(), publishProjects: vi.fn(),
}));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: {
  getTimeline: mocks.timeline, getTeamProjectAssignments: mocks.teamAssignments, getProjectWindowAssignments: mocks.windowAssignments,
} }));
vi.mock("./teamSharingService", () => ({ fetchTeamMembershipStart: mocks.membership, publishTeamFocusDays: mocks.publishFocus }));
vi.mock("./teamService", () => ({ publishTeamProjectTotals: mocks.publishProjects }));

import { shareOwnTeamTime, teamAutoShareWindow, type TeamAutoShareTarget } from "./teamAutoShare";

const ok = <T>(data: T) => ({ success: true as const, error: null, data });
const segment = (id: string, start: string, end: string): ActivitySegment => ({
  id, startedAt: start, endedAt: end, durationSeconds: (Date.parse(end) - Date.parse(start)) / 1000,
  appName: "Figma", siteDomain: null, siteTitle: null, platform: "macos", source: "nsworkspace",
} as ActivitySegment);
// Seoul office hours, Monday to Friday 09:00-18:00; 2026-11-05 is a Thursday.
const target: TeamAutoShareTarget = {
  organizationId: "org-1",
  displayName: "Alex",
  policy: { projects: "hourly", tasks: "off", focus: "member_daily", memberSummary: true },
  schedule: { days: [1, 2, 3, 4, 5], start_minute: 9 * 60, end_minute: 18 * 60, timezone: "Asia/Seoul" },
};
const now = Date.parse("2026-11-05T10:00:00Z"); // 19:00 in Seoul
const options = { startOfDayMinutes: 0, focusClassification: null, nowMs: now };
const timeline = [
  segment("before-join", "2026-11-02T01:00:00Z", "2026-11-02T02:00:00Z"), // Monday 10:00-11:00 Seoul, before joining
  segment("morning", "2026-11-04T00:30:00Z", "2026-11-04T01:30:00Z"), // Wednesday 09:30-10:30 Seoul
  segment("crossing-close", "2026-11-04T08:30:00Z", "2026-11-04T09:30:00Z"), // 17:30-18:30 Seoul, half inside
  segment("night", "2026-11-04T13:00:00Z", "2026-11-04T14:00:00Z"), // 22:00 Seoul, outside the hours
];
const assigned = timeline.map((row) => ({ segmentId: row.id, teamProjectId: "project-a", source: "ai" }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  mocks.membership.mockResolvedValue(ok("2026-11-03T00:00:00Z"));
  mocks.timeline.mockResolvedValue(timeline);
  mocks.teamAssignments.mockResolvedValue(assigned);
  mocks.windowAssignments.mockResolvedValue([]);
  mocks.publishFocus.mockResolvedValue(ok({ published_row_count: 1 }));
  mocks.publishProjects.mockResolvedValue(ok({ published_row_count: 1 }));
});

describe("teamAutoShareWindow", () => {
  it("covers the last two weeks and never the days before joining", () => {
    expect(teamAutoShareWindow("2026-11-20", "2026-10-01")).toEqual({ start_date: "2026-11-07", end_date: "2026-11-20" });
    expect(teamAutoShareWindow("2026-11-05", "2026-11-03")).toEqual({ start_date: "2026-11-03", end_date: "2026-11-05" });
    expect(teamAutoShareWindow("2026-11-05", "2026-11-06")).toBeNull();
  });
});

describe("shareOwnTeamTime", () => {
  it("sends project time from inside the team's hours and after joining, as day totals only", async () => {
    const result = await shareOwnTeamTime(target, options);
    expect(result).toEqual({ status: "shared", projectDays: 1, focusDays: 0 });
    expect(mocks.publishProjects).toHaveBeenCalledWith({
      organization_id: "org-1",
      display_name: "Alex",
      window_start_date: "2026-11-03",
      window_end_date: "2026-11-05",
      // 09:30-10:30 whole, 17:30-18:00 of the crossing record; the night and pre-join hours stay home.
      entries: [{ project_id: "project-a", activity_date: "2026-11-04", seconds: 5400 }],
    });
    // Focus is not sent without the person's own classification.
    expect(mocks.publishFocus).not.toHaveBeenCalled();
  });

  it("sends focus with the window as a whole while the team shares it, and nothing the team keeps private", async () => {
    await shareOwnTeamTime({ ...target, policy: { ...target.policy, projects: "off" } }, { ...options, focusClassification: { includeAiClassifications: false } });
    expect(mocks.publishProjects).not.toHaveBeenCalled();
    expect(mocks.publishFocus).toHaveBeenCalledWith(expect.objectContaining({ organization_id: "org-1", window_start_date: "2026-11-03", window_end_date: "2026-11-05" }));
    const sent = mocks.publishFocus.mock.calls[0]![0] as { entries: { activity_date: string; seconds: number }[] };
    expect(sent.entries.every((entry) => entry.activity_date === "2026-11-04" && entry.seconds <= 5400)).toBe(true);
  });

  it("sends nothing, and reads nothing, when the team shares neither item or has no hours", async () => {
    expect(await shareOwnTeamTime({ ...target, policy: { ...target.policy, projects: "off", focus: "off" } }, options)).toEqual({ status: "nothing" });
    expect(await shareOwnTeamTime({ ...target, schedule: null }, options)).toEqual({ status: "nothing" });
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it("never publishes an empty set, which would wipe days already shared", async () => {
    mocks.timeline.mockResolvedValue([timeline[3]]);
    expect(await shareOwnTeamTime(target, options)).toEqual({ status: "nothing" });
    expect(mocks.publishProjects).not.toHaveBeenCalled();
  });

  it("reads no records when it cannot tell when this person joined", async () => {
    mocks.membership.mockResolvedValue({ success: false, error: "Unable to read when you joined this team.", reason: "remote_error" });
    expect(await shareOwnTeamTime(target, options)).toEqual({ status: "failed", error: "Unable to read when you joined this team." });
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it("reports a refused publish", async () => {
    mocks.publishProjects.mockResolvedValue({ success: false, error: "This team does not share project time.", reason: "forbidden" });
    expect(await shareOwnTeamTime(target, options)).toEqual({ status: "failed", error: "This team does not share project time." });
  });
});
