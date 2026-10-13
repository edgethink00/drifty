import { describe, expect, it } from "vitest";
import type { ActivitySegment, ProjectWindowAssignmentRecord } from "@drifty/domain";
import { buildWeekProjectView, WEEK_NO_PROJECT_KEY } from "./weekProjectView";
import { buildWeekBreakdownHoverRows } from "./weekBreakdownHover";

function record(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return { id: "raw", startedAt: "2024-01-03T09:00:00", endedAt: "2024-01-03T09:09:00", durationSeconds: 540,
    appName: "Code", platform: "macos", source: "nsworkspace",
    classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 }, ...overrides };
}
function window(start: string, end: string, projectId: string | null): ProjectWindowAssignmentRecord {
  return { windowId: start, teamProjectId: null, windowStartedAt: `2024-01-03T${start}:00`, windowEndedAt: `2024-01-03T${end}:00`,
    durationSeconds: 180, projectId, source: "ai", segmentOverlaps: [{ segmentId: "raw", durationSeconds: 180 }] };
}
const base = {
  segments: [record()], assignments: [], windowAssignments: [],
  projects: [{ id: "a", name: "Build", color: "#123456" }, { id: "b", name: "Research", color: "#abcdef" }],
  classificationOptions: { includeAiClassifications: false }, startDay: "2024-01-01", endDay: "2024-01-07",
  startOfDayMinutes: 0, noProjectLabel: "No project", unavailableProjectLabel: "Unavailable project",
};

describe("Week project time allocation", () => {
  it("keeps A/B/A window boundaries and source ids while every summary uses the same seconds", () => {
    const view = buildWeekProjectView({ ...base, windowAssignments: [window("09:00", "09:03", "a"), window("09:03", "09:06", "b"), window("09:06", "09:09", "a")] });
    const events = view.calendarEvents.get("2024-01-03")!;
    expect(events.map(event => [event.projectId, event.topMinutes, event.durationMinutes])).toEqual([["a", 540, 3], ["b", 543, 3], ["a", 546, 3]]);
    expect(events.every(event => event.segmentIds.length === 1 && event.segmentIds[0] === "raw" && event.sessionCount === 1)).toBe(true);
    expect(events.every(event => event.identities.every(identity => identity.sourceSegmentIds?.[0] === "raw"))).toBe(true);
    expect(events.map(event => event.lane)).toEqual([0, 1, 2]);
    expect(view.ringEntries.map(entry => [entry.key, entry.totalSeconds])).toEqual([["a", 360], ["b", 180]]);
    expect(view.slicesByDay.get("2024-01-03")!.map(item => [item.key, item.seconds])).toEqual([["a", 360], ["b", 180]]);
    const hover = buildWeekBreakdownHoverRows({ ...base, segments: view.segments, projectBySegmentId: view.projectBySegmentId, mode: "project", key: "a", day: "2024-01-03" });
    expect(hover[0].totalSeconds).toBe(360);
    expect(view.totalSeconds).toBe(540);
  });

  it("keeps manual unassignment, residual time, missing metadata and stale windows explainable", () => {
    const view = buildWeekProjectView({ ...base,
      segments: [record(), record({ id: "missing", startedAt: "2024-01-03T10:00:00", endedAt: "2024-01-03T10:03:00", durationSeconds: 180 })],
      assignments: [{ segmentId: "raw", projectId: null, source: "manual" }, { segmentId: "missing", projectId: "archived", source: "ai" }],
      windowAssignments: [window("09:00", "09:03", "a"), { ...window("09:03", "09:06", "b"), stale: true }],
    });
    expect(view.ringEntries.map(item => [item.key, item.label, item.totalSeconds])).toEqual([["archived", "Unavailable project", 180], [WEEK_NO_PROJECT_KEY, "No project", 540]]);
    expect(view.calendarEvents.get("2024-01-03")!.map(event => event.projectId)).toEqual([null, "archived"]);
  });

  it("clips sparse sampled time at the logical day boundary and excludes activity outside the week", () => {
    const view = buildWeekProjectView({ ...base, startDay: "2024-01-02", endDay: "2024-01-02", startOfDayMinutes: 240,
      segments: [record({ startedAt: "2024-01-03T03:30:00", endedAt: "2024-01-03T04:30:00", durationSeconds: 600 }), record({ id: "outside" })],
      assignments: [{ segmentId: "raw", projectId: "a", source: "manual" }],
    });
    expect(view.totalSeconds).toBe(300);
    expect(view.ringEntries[0].totalSeconds).toBe(300);
    expect(view.slicesByDay.get("2024-01-02")![0].seconds).toBe(300);
    const hover = buildWeekBreakdownHoverRows({ ...base, segments: view.segments, projectBySegmentId: view.projectBySegmentId, startDay: "2024-01-02", endDay: "2024-01-02", startOfDayMinutes: 240, mode: "project", key: "a" });
    expect(hover[0].totalSeconds).toBe(300);
  });

  it("counts overlapping devices once before splitting their project shares", () => {
    const view = buildWeekProjectView({ ...base, segments: [record({ deviceId: "local" }), record({ id: "remote", deviceId: "remote" })],
      assignments: [{ segmentId: "raw", projectId: "a", source: "manual" }, { segmentId: "remote", projectId: "b", source: "manual" }],
    });
    expect(view.totalSeconds).toBe(540);
    expect(view.ringEntries.map(entry => entry.totalSeconds)).toEqual([270, 270]);
    expect(view.calendarEvents.get("2024-01-03")!.every(event => event.laneCount === 2)).toBe(true);
  });
});
