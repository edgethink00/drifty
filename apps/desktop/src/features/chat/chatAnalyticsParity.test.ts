import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activitySecondsWithinInterval, activityTimeBounds, aggregateDeviceElapsedTime,
  buildPersonalProjectSliceProjection, isExcludedSegment, isFailedForegroundCaptureSegment,
  type ActivitySegment, type ProjectAssignmentRecord, type ProjectWindowAssignmentRecord,
} from "@drifty/domain";
import { joinProductivityRuns, longestProductivityRun } from "../../lib/productivityRuns";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const from = "2026-11-02T00:00:00+09:00";
const to = "2026-11-03T00:00:00+09:00";
const start = Date.parse(from);
const end = Date.parse(to);
const projects = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

function record(id: string, clock: string, minutes: number, deviceId?: string, seconds = minutes * 60): ActivitySegment {
  const at = new Date("2026-11-02T" + clock + ":00+09:00");
  return {
    id, startedAt: at.toISOString(), endedAt: new Date(at.getTime() + minutes * 60_000).toISOString(),
    durationSeconds: seconds, appName: "Editor " + id, deviceId, platform: "macos", source: "accessibility",
    classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 },
  } as ActivitySegment;
}

function window(id: string, fromClock: string, toClock: string, segmentId: string, projectId: string | null): ProjectWindowAssignmentRecord {
  return { windowId: id, windowStartedAt: "2026-11-02T" + fromClock + ":00+09:00", windowEndedAt: "2026-11-02T" + toClock + ":00+09:00",
    durationSeconds: 1800, segmentOverlaps: [{ segmentId, durationSeconds: 1800 }], projectId,
    teamProjectId: null, source: "ai", confidence: 1, stale: false } as ProjectWindowAssignmentRecord;
}

const cases: Array<{ name: string; records: ActivitySegment[]; windows?: ProjectWindowAssignmentRecord[]; assignments?: ProjectAssignmentRecord[] }> = [
  { name: "local samples and short focus gaps", records: [record("1", "09:00", 30), record("2", "09:34", 30)] },
  { name: "two simultaneous devices", records: [record("1", "09:00", 60), record("2", "09:00", 60, "pc")] },
  { name: "three devices with different sampling density", records: [record("1", "09:00", 60, undefined, 1800), record("2", "09:00", 60, "pc"), record("3", "09:15", 30, "other", 600)] },
  { name: "a different device on another day does not rescale local-only overlaps", records: [record("1", "09:00", 60), record("2", "09:00", 60), { ...record("3", "09:00", 60, "pc"), startedAt: "2026-11-01T00:00:00+09:00", endedAt: "2026-11-01T01:00:00+09:00" }] },
  { name: "point samples extend forward", records: [record("1", "09:00", 0, undefined, 4), record("2", "09:00", 0, "pc", 4)] },
  { name: "a sampled window and its unassigned remainder", records: [record("1", "09:00", 60, undefined, 1800)], windows: [window("w", "09:15", "09:45", "1", "a")] },
  { name: "overlapping windows count each interval once", records: [record("1", "09:00", 60)], windows: [window("w1", "09:00", "09:40", "1", "a"), window("w2", "09:20", "10:00", "1", "b")] },
  { name: "manual project overrides a stored window", records: [record("1", "09:00", 60)], windows: [window("w", "09:15", "09:45", "1", "a")], assignments: [{ segmentId: "1", projectId: "b", source: "manual", confidence: 1 }] as ProjectAssignmentRecord[] },
  { name: "a manual clear overrides a stored window", records: [record("1", "09:00", 60)], windows: [window("w", "09:15", "09:45", "1", "a")], assignments: [{ segmentId: "1", projectId: null, source: "manual", confidence: 1 }] as ProjectAssignmentRecord[] },
  { name: "stale assignment evidence is not used", records: [record("1", "09:00", 60)], windows: [{ ...window("w", "09:15", "09:45", "1", "a"), stale: true }] },
];

describe("Chat summary parity with the application's existing time rules", () => {
  it.each(cases)("$name", ({ records, windows = [], assignments = [] }) => {
    const source = `import json,sys\nfrom datetime import timezone,timedelta\nfrom app.cli.analytics import summarize,timestamp\nf=json.load(sys.stdin)\nz=timezone(timedelta(hours=9))\nprint(json.dumps(summarize(f['records'],timestamp(f['from'],z),timestamp(f['to'],z),z,f['projects'],f['assignments'],f['windows'])))`;
    const process = spawnSync("python3", ["-c", source], {
      cwd: root, env: { ...globalThis.process.env, PYTHONPATH: root + "/services/tracker-python" },
      input: JSON.stringify({ records, windows, assignments, projects, from, to }), encoding: "utf8", timeout: 10_000,
    });
    expect(process.status, process.stderr).toBe(0);
    const actual = JSON.parse(process.stdout);
    const projected = aggregateDeviceElapsedTime(records).filter((item) => !isExcludedSegment(item) && !isFailedForegroundCaptureSegment(item));
    const seconds = (item: ActivitySegment) => activitySecondsWithinInterval(item, start, end);
    expect(actual.recordedSeconds).toBeCloseTo(projected.reduce((sum, item) => sum + seconds(item), 0), 5);

    const slices = buildPersonalProjectSliceProjection(records, windows, assignments);
    const expectedProjects = new Map<string, number>();
    let unassigned = 0;
    for (const item of slices.segments) {
      const project = slices.projectBySegmentId.get(item.id);
      if (project) expectedProjects.set(project, (expectedProjects.get(project) ?? 0) + seconds(item));
      else unassigned += seconds(item);
    }
    expect(actual.unassignedSeconds).toBeCloseTo(unassigned, 5);
    for (const project of projects) expect(actual.projects.find((item: { id: string }) => item.id === project.id)?.seconds ?? 0).toBeCloseTo(expectedProjects.get(project.id) ?? 0, 5);

    const longest = longestProductivityRun(joinProductivityRuns(projected.map((item) => {
      const bounds = activityTimeBounds(item);
      return { startMs: Math.max(start, bounds.start), endMs: Math.min(end, bounds.end), seconds: seconds(item) };
    }).filter((part) => part.seconds > 0)));
    expect(actual.longestFocus?.seconds ?? 0).toBeCloseTo(longest?.seconds ?? 0, 5);
    if (longest) expect(Date.parse(actual.longestFocus.startedAt)).toBe(longest.startMs);
  });
});
