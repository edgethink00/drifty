import { expect, it } from "vitest";
import type { ActivitySegment } from "./activity";
import { buildProjectPassAnalysisWindows } from "./projectPassWindow";
import { buildPersonalProjectSliceProjection, buildTeamProjectSliceProjection } from "./projectWindowAssignments";
import { aggregateDeviceElapsedTime, activitySecondsWithinInterval } from "./deviceElapsedTime";
import type { ProjectWindowAssignmentRecord } from "./commands";

const start = "2026-04-06T09:00:00.000Z";
const end = "2026-04-06T09:06:00.000Z";
const source: ActivitySegment = { id: "s", startedAt: start, endedAt: end, durationSeconds: 60, appName: "Code", platform: "macos", source: "accessibility" };
const sum = (segments: readonly {durationSeconds: number}[]) => segments.reduce((n, s) => n + s.durationSeconds, 0);
function window(minute: number, seconds = 180): ProjectWindowAssignmentRecord {
  return { windowId: "w" + minute, windowStartedAt: new Date(Date.parse(start) + minute * 60000).toISOString(), windowEndedAt: new Date(Date.parse(start) + (minute + 3) * 60000).toISOString(),
    durationSeconds: seconds, segmentOverlaps: [{ segmentId: source.id, durationSeconds: seconds }], projectId: "p" + minute, teamProjectId: "t" + minute, source: "ai" };
}

it("allocates sparse recorded time across fixed windows without growing it to wall time", () => {
  const windows = buildProjectPassAnalysisWindows([source]);
  expect(windows.map(w => w.durationSeconds)).toEqual([30, 30]);
  expect(windows.map(w => w.segmentOverlaps[0].durationSeconds)).toEqual([30, 30]);
});
it("clips a sparse source by recorded density at a query boundary", () => {
  expect(sum(buildProjectPassAnalysisWindows([source], { range: { start: "2026-04-06T09:01:00Z", end: "2026-04-06T09:04:00Z" } }))).toBe(30);
});
it("keeps point samples, splitting at fixed cells and respecting completedThrough", () => {
  const point = { ...source, startedAt: "2026-04-06T09:02:50Z", endedAt: "2026-04-06T09:02:50Z", durationSeconds: 30 };
  expect(buildProjectPassAnalysisWindows([point]).map(w => w.durationSeconds)).toEqual([10, 20]);
  expect(sum(buildProjectPassAnalysisWindows([point], { completedThrough: "2026-04-06T09:03:00Z" }))).toBe(10);
  expect(buildProjectPassAnalysisWindows([point], { range: { start: "2026-04-06T09:04:00Z", end } })).toEqual([]);
});
it.each(["personal", "team"])("corrects already-persisted inflated %s windows using the source sample", scope => {
  const project = scope === "personal" ? buildPersonalProjectSliceProjection([source], [window(0), window(3)], []) : buildTeamProjectSliceProjection([source], [window(0), window(3)], []);
  expect(project.segments.map(s => s.durationSeconds)).toEqual([30, 30]);
  expect([...project.projectBySegmentId.values()]).toEqual(scope === "personal" ? ["p0", "p3"] : ["t0", "t3"]);
});
it("keeps source time in uncovered legacy gaps during partial reanalysis", () => {
  const project = buildPersonalProjectSliceProjection([source], [window(0)], [{segmentId: source.id, projectId: "legacy", source: "ai"}]);
  expect(project.segments.map(s => s.durationSeconds)).toEqual([30, 30]);
  expect([...project.projectBySegmentId.values()]).toEqual(["p0", "legacy"]);
});
it("clips an assigned point sample and leaves its remainder in the correct legacy interval", () => {
  const point = { ...source, startedAt: "2026-04-06T09:02:50Z", endedAt: "2026-04-06T09:02:50Z", durationSeconds: 30 };
  const project = buildPersonalProjectSliceProjection([point], [window(0)], []);
  expect(project.segments.map(s => s.durationSeconds)).toEqual([10, 20]);
  expect(project.segments[1].startedAt).toBe("2026-04-06T09:03:00.000Z");
  expect(project.segments[1].endedAt).toBe("2026-04-06T09:03:20.000Z");
});
it("never exceeds the source budget with duplicated legacy overlaps or out-of-range windows", () => {
  const project = buildPersonalProjectSliceProjection([source], [window(0), window(0), window(9)], []);
  expect(sum(project.segments)).toBe(60);
  expect(project.segments.every(s => Date.parse(s.endedAt) >= Date.parse(s.startedAt))).toBe(true);
});
it("retains fractional multi-device weights in producer and historical consumer", () => {
  const records = aggregateDeviceElapsedTime([source, { ...source, id: "remote", deviceId: "pc", platform: "windows" }]);
  expect(sum(buildProjectPassAnalysisWindows(records))).toBe(60);
  for (const record of records) {
    const windows = [window(0), window(3)].map(w => ({ ...w, segmentOverlaps: [{ segmentId: record.id, durationSeconds: 180 }] }));
    const project = buildPersonalProjectSliceProjection([record], windows, []);
    expect(project.segments.map(s => s.durationSeconds)).toEqual([15, 15]);
    expect(sum(project.segments)).toBe(30);
    expect(project.segments.reduce((n, s) => n + activitySecondsWithinInterval(s, Date.parse(start), Date.parse(end)), 0)).toBe(30);
  }
});
it("preserves dense source and manual project precedence, and rejects invalid duration", () => {
  const dense = { ...source, durationSeconds: 360 };
  const project = buildPersonalProjectSliceProjection([dense], [window(0), window(3)], [{segmentId: source.id, projectId: "manual", source: "manual"}]);
  expect(project.segments.map(s => s.durationSeconds)).toEqual([180, 180]);
  expect([...project.projectBySegmentId.values()]).toEqual(["manual", "manual"]);
  expect(buildProjectPassAnalysisWindows([{ ...source, durationSeconds: NaN }, { ...source, durationSeconds: -1 }])).toEqual([]);
});

it("keeps both fractional windows when a one-second point crosses a cell boundary", () => {
  const point = { ...source, startedAt: "2026-04-06T09:02:59.500Z", endedAt: "2026-04-06T09:02:59.500Z", durationSeconds: 1 };
  expect(buildProjectPassAnalysisWindows([point]).map(w => w.durationSeconds)).toEqual([0.5, 0.5]);
});

it("normalizes raw all-device windows and leaves already allocated input unchanged", () => {
  const raw = [source, { ...source, id: "remote", deviceId: "pc", platform: "windows" as const }];
  const windows = buildProjectPassAnalysisWindows(raw);
  expect(windows.map(w => w.durationSeconds)).toEqual([30, 30]);
  expect(windows.map(w => w.segmentOverlaps)).toEqual([
    [{ segmentId: "s", durationSeconds: 15 }, { segmentId: "remote", durationSeconds: 15 }],
    [{ segmentId: "s", durationSeconds: 15 }, { segmentId: "remote", durationSeconds: 15 }],
  ]);
  expect(buildProjectPassAnalysisWindows(aggregateDeviceElapsedTime(raw))).toEqual(windows);
  expect(raw.map(s => s.durationSeconds)).toEqual([60, 60]);
  expect(sum(buildProjectPassAnalysisWindows([raw[1]]))).toBe(60);
});
it.each(["personal", "team"])("normalizes raw %s trend input before slicing historical windows", scope => {
  const raw = [source, { ...source, id: "remote", deviceId: "pc", platform: "windows" as const }];
  const stored = [window(0), window(3)].map(w => ({
    ...w, segmentOverlaps: raw.map(s => ({ segmentId: s.id, durationSeconds: 180 })),
  }));
  const project = scope === "personal"
    ? buildPersonalProjectSliceProjection(raw, stored, [])
    : buildTeamProjectSliceProjection(raw, stored, []);
  expect(project.segments.map(s => s.durationSeconds)).toEqual([15, 15, 15, 15]);
  expect(sum(project.segments)).toBe(60);
  const derived = scope === "personal"
    ? buildPersonalProjectSliceProjection(aggregateDeviceElapsedTime(raw), stored, [])
    : buildTeamProjectSliceProjection(aggregateDeviceElapsedTime(raw), stored, []);
  expect(derived.segments).toEqual(project.segments);
  expect(raw.map(s => s.durationSeconds)).toEqual([60, 60]);
});
it("retains raw manual project choices and original per-device totals", () => {
  const raw = [source, { ...source, id: "remote", deviceId: "pc", platform: "windows" as const }];
  const manual = raw.map(s => ({ segmentId: s.id, projectId: s.id, source: "manual" as const }));
  const project = buildPersonalProjectSliceProjection(raw, [], manual);
  expect(project.segments.map(s => s.durationSeconds)).toEqual([30, 30]);
  expect([...project.projectBySegmentId.values()]).toEqual(["s", "remote"]);
  for (const segment of raw) {
    const single = buildPersonalProjectSliceProjection([segment], [], manual);
    expect(sum(single.segments)).toBe(60);
  }
});

it("chooses the correction surface from captured evidence rather than display allocation", () => {
  const raw = [
    { ...source, id: "a", endedAt: "2026-04-06T09:03:00Z", durationSeconds: 19, appName: "Code" },
    { ...source, id: "b", deviceId: "pc", platform: "windows" as const, startedAt: "2026-04-06T09:01:30Z", endedAt: "2026-04-06T09:03:00Z", durationSeconds: 20, appName: "Editor" },
  ];
  for (const records of [raw, aggregateDeviceElapsedTime(raw)]) {
    const [w] = buildProjectPassAnalysisWindows(records);
    expect(w.durationSeconds).toBeCloseTo(29.5);
    expect(w.appName).toBe("Editor");
    expect(w.correctionSegmentIds).toEqual(["b"]);
    expect(w.contributors[0].durationSeconds).toBeLessThan(w.contributors[1].durationSeconds);
  }
});
it("keeps asymmetric elapsed rates in legacy gaps across a logical-day boundary", () => {
  const raw = [ { ...source, endedAt: "2026-04-06T09:09:00Z", durationSeconds: 90 },
    { ...source, id: "remote", deviceId: "pc", endedAt: "2026-04-06T09:03:00Z", durationSeconds: 180 } ];
  const projection = buildPersonalProjectSliceProjection(raw, [window(3)], [{ segmentId: source.id, projectId: "legacy", source: "ai" }]);
  const local = projection.segments.filter(s => !s.deviceId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  expect(local.map(s => s.durationSeconds)).toEqual([expect.closeTo(180 / 7), 30, 30]);
  const boundary = Date.parse("2026-04-06T09:03:00Z");
  expect(local.reduce((n, s) => n + activitySecondsWithinInterval(s, boundary, Date.parse("2026-04-06T09:09:00Z")), 0)).toBe(60);
});
