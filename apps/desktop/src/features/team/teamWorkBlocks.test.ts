import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";

import type { ActivityLabelBlock } from "../activity-labels/activityLabelBlocks";
import type { TeamFocusDataset } from "./teamFocusModel";
import type { TeamWorkBlockRow } from "./teamSharingService";
import { datasetWithWorkBlocks, teamWorkBlockEntries, teamWorkTitlesByDay, type TeamWorkShare } from "./teamWorkBlocks";

const iso = (hhmm: string) => "2026-11-05T" + hhmm + ":00+09:00";
const ms = (hhmm: string) => Date.parse(iso(hhmm));
const segment = (id: string, from: string, to: string): ActivitySegment => ({
  id, startedAt: iso(from), endedAt: iso(to), durationSeconds: (ms(to) - ms(from)) / 1000,
  appName: "Figma", siteDomain: null, siteTitle: null, platform: "macos", source: "nsworkspace",
} as ActivitySegment);
const block = (key: string, from: string, to: string, ids: string[], title: string | null, generation: ActivityLabelBlock["generation"] = "resolved"): ActivityLabelBlock => ({
  key, day: "2026-11-05", startMs: ms(from), endMs: ms(to), startMinute: 0, endMinute: 0, segmentIds: ids, recordedSeconds: 0,
  resolution: { kind: "none" }, display: title ? { title, description: "An AI summary that never leaves", origin: "user", status: "user" } : null,
  card: null, otherCards: [], generation,
} as unknown as ActivityLabelBlock);
// Seoul hours 09:00-18:00 on Thursday 2026-11-05.
const spans = [{ start: ms("09:00"), end: ms("18:00") }];
const segments = [segment("a", "08:30", "09:30"), segment("b", "10:00", "11:00"), segment("c", "17:50", "18:10"), segment("d", "12:00", "12:00")];
const assignments = [{ segmentId: "a", teamProjectId: "p1", source: "ai" as const }, { segmentId: "b", teamProjectId: "p2", source: "ai" as const }];
const everything: TeamWorkShare = { titles: true, projects: true, focus: true, timed: true };

describe("teamWorkBlockEntries", () => {
  it("cuts each block to the team's hours and sends its name, project and focus, never its description", () => {
    const entries = teamWorkBlockEntries({
      blocks: [block("k1", "08:30", "09:30", ["a"], "Pricing copy"), block("k2", "10:00", "11:00", ["b"], null), block("k3", "17:50", "18:10", ["c"], "Wrap up")],
      segments, spans, assignments, windowAssignments: [], share: everything,
      focusSeconds: (parts) => parts.reduce((sum, part) => sum + part.durationSeconds, 0) * (parts[0]?.id === "b" ? 1 : 0),
    });
    expect(entries).toEqual([
      { activity_date: "2026-11-05", started_at: new Date(ms("09:00")).toISOString(), ended_at: new Date(ms("09:30")).toISOString(), seconds: 1800, project_id: "p1", title: "Pricing copy", focus: false },
      // A hidden name goes up without one.
      { activity_date: "2026-11-05", started_at: new Date(ms("10:00")).toISOString(), ended_at: new Date(ms("11:00")).toISOString(), seconds: 3600, project_id: "p2", title: null, focus: true },
      { activity_date: "2026-11-05", started_at: new Date(ms("17:50")).toISOString(), ended_at: new Date(ms("18:00")).toISOString(), seconds: 600, project_id: null, title: "Wrap up", focus: false },
    ]);
    expect(JSON.stringify(entries)).not.toContain("summary");
  });

  it("sends names by day without times, and nothing for an unnamed or unfinished block", () => {
    const entries = teamWorkBlockEntries({
      blocks: [block("k1", "08:30", "09:30", ["a"], "Pricing copy"), block("k2", "10:00", "11:00", ["b"], null), block("k3", "17:50", "18:10", ["c"], "Wrap up", "live")],
      segments, spans, assignments, windowAssignments: [], share: { titles: true, projects: false, focus: false, timed: false },
    });
    expect(entries).toEqual([{ activity_date: "2026-11-05", started_at: null, ended_at: null, seconds: 1800, project_id: null, title: "Pricing copy", focus: null }]);
  });

  it("sends nothing when the team takes neither names nor times, or the block is under a minute inside the hours", () => {
    expect(teamWorkBlockEntries({ blocks: [block("k1", "08:30", "09:30", ["a"], "x")], segments, spans, assignments, windowAssignments: [], share: { titles: false, projects: true, focus: true, timed: false } })).toEqual([]);
    expect(teamWorkBlockEntries({ blocks: [block("k4", "08:00", "09:00", ["a"], "x")], segments, spans: [{ start: ms("09:29:30".slice(0, 5)) + 30_000, end: ms("18:00") }], assignments, windowAssignments: [], share: everything })).toEqual([]);
  });
});

describe("work blocks on the team's pages", () => {
  const dataset: TeamFocusDataset = {
    members: [{ member_key: "k-ana", display_name: "Ana", role_label: "", membership_role: "member", group_id: null, is_self: false, weekly_goal_seconds: null }],
    groups: [],
    focusDays: [{ member_key: "k-ana", activity_date: "2026-11-05", focus_seconds: 3600, tracked_seconds: 3600, deep_block_count: 1, deep_block_seconds: 3600, longest_block_seconds: 3600, longest_block_start_minute: 600, blocks: null }],
    projectDays: [],
    presence: [],
  };
  const row = (member: string, day: string, start: string | null, end: string | null, seconds: number, title: string | null, project: string | null = "p1"): TeamWorkBlockRow => ({
    member_key: member, member_display_name: member.slice(2), is_self: false, activity_date: day,
    started_at: start ? day + "T" + start + ":00+09:00" : null, ended_at: end ? day + "T" + end + ":00+09:00" : null,
    seconds, organization_project_id: project, title, is_focus: start ? true : null,
  });

  it("draws timed blocks on each person's days from the clock on that day", () => {
    const merged = datasetWithWorkBlocks(dataset, [
      row("k-ana", "2026-11-05", "10:00", "11:00", 3600, "Pricing copy"),
      row("k-ana", "2026-11-05", "09:00", "09:30", 1800, null),
      row("k-ben", "2026-11-04", "14:00", "15:00", 3600, null, null),
      row("k-ana", "2026-11-05", null, null, 5400, "Day only"),
    ]);
    expect(merged.focusDays.find((day) => day.member_key === "k-ana")!.blocks).toEqual([
      { start_minute: 540, end_minute: 570, project_id: "p1", title: null, focus: true },
      { start_minute: 600, end_minute: 660, project_id: "p1", title: "Pricing copy", focus: true },
    ]);
    // A day with blocks but no shared focus keeps a focus of zero.
    expect(merged.focusDays.find((day) => day.member_key === "k-ben")).toMatchObject({ focus_seconds: 0, tracked_seconds: 3600 });
    expect(merged.members.map((member) => member.member_key)).toEqual(["k-ana", "k-ben"]);
    expect(datasetWithWorkBlocks(dataset, [row("k-ana", "2026-11-05", null, null, 60, "Only by day")])).toBe(dataset);
  });

  it("lists a person's names by day, newest day first and biggest first, from names by day and on times alike", () => {
    expect(teamWorkTitlesByDay([
      row("k-ana", "2026-11-04", null, null, 600, "Notes"),
      row("k-ana", "2026-11-05", "10:00", "11:00", 3600, "Pricing copy"),
      row("k-ana", "2026-11-05", null, null, 1200, "Pricing copy", "p2"),
      row("k-ana", "2026-11-05", null, null, 4000, "Launch plan"),
      row("k-ben", "2026-11-05", null, null, 900, "Someone else"),
      row("k-ana", "2026-11-05", "12:00", "12:30", 1800, null),
    ], "k-ana")).toEqual([
      { day: "2026-11-05", items: [{ title: "Pricing copy", seconds: 4800, projectId: "p1" }, { title: "Launch plan", seconds: 4000, projectId: "p1" }] },
      { day: "2026-11-04", items: [{ title: "Notes", seconds: 600, projectId: "p1" }] },
    ]);
    expect(teamWorkTitlesByDay([row("k-ana", "2026-11-04", null, null, 600, "Notes"), row("k-ana", "2026-11-05", null, null, 60, "Kept")], "k-ana", { start_date: "2026-11-05", end_date: "2026-11-11" }).map((day) => day.day)).toEqual(["2026-11-05"]);
  });
});
