import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "./activity";
import { filterSegmentsByDevice } from "./activity";
import { aggregateDeviceElapsedTime, activitySecondsWithinInterval, clipDeviceElapsedTimeSegment } from "./deviceElapsedTime";
import { buildAppUsageSummaries, buildCategoryDurations, buildDailyTotals, buildFlowBlocks, buildFlowBlocksForIntervals, buildProductivityDurations, buildRollingFocusSeconds, logicalDayStartMs, totalDurationSeconds } from "./aggregation";
import { buildPersonalProjectSliceProjection } from "./projectWindowAssignments";
import { capturedActivityDurationSeconds } from "./capturedActivityDuration";

function segment(id: string, startMinute: number, durationMinutes: number, deviceId?: string, productivity: "focus" | "drift" = "focus"): ActivitySegment {
  const start = new Date("2026-10-04T09:00:00").getTime() + startMinute * 60_000;
  return { id, startedAt: new Date(start).toISOString(), endedAt: new Date(start + durationMinutes * 60_000).toISOString(), durationSeconds: durationMinutes * 60,
    appName: id, platform: deviceId ? "windows" : "macos", source: "manual", deviceId,
    classification: { category: productivity === "focus" ? "workspace" : "entertainment", productivity, source: "manual", confidence: 1 } };
}
const sum = (values: readonly { durationSeconds: number }[]) => values.reduce((total, value) => total + value.durationSeconds, 0);

describe("single-device logical-window display totals", () => {
  const boundary = Date.parse("2026-10-14T04:00:00Z");
  const day = 86_400_000;

  it.each(["macos", "windows"] as const)("splits the captured %s crossing without changing stored evidence", platform => {
    const record = { ...segment("crossing", 0, 1), platform,
      startedAt: "2026-10-14T03:55:28.189788Z", endedAt: "2026-10-14T04:04:03.314428Z", durationSeconds: 515 };
    const original = JSON.stringify(record);
    const previous = clipDeviceElapsedTimeSegment(record, { start: boundary - day, end: boundary });
    const current = clipDeviceElapsedTimeSegment(record, { start: boundary, end: boundary + day });
    // JavaScript Date parses these captured timestamps at millisecond precision.
    expect(current.durationSeconds).toBeCloseTo(515 * 243.314 / 515.125, 6);
    expect(previous.durationSeconds + current.durationSeconds).toBeCloseTo(515, 10);
    expect(totalDurationSeconds([current])).toBeCloseTo(current.durationSeconds, 10);
    expect(buildAppUsageSummaries([current])[0].totalSeconds).toBeCloseTo(current.durationSeconds, 10);
    expect(buildCategoryDurations([current])[0].totalSeconds).toBeCloseTo(current.durationSeconds, 10);
    expect(capturedActivityDurationSeconds(current)).toBe(515);
    expect(current).toMatchObject({ id: record.id, startedAt: record.startedAt, endedAt: record.endedAt, classification: record.classification });
    expect(JSON.stringify(record)).toBe(original);
    expect(clipDeviceElapsedTimeSegment(current, { start: boundary, end: boundary + day }).durationSeconds).toBeCloseTo(current.durationSeconds, 10);
  });

  it("allocates sparse samples without filling their observed gaps", () => {
    const record = { ...segment("sparse", 0, 1), startedAt: "2026-10-14T03:50:00Z", endedAt: "2026-10-14T04:10:00Z", durationSeconds: 60 };
    const previous = clipDeviceElapsedTimeSegment(record, { start: boundary - day, end: boundary });
    const current = clipDeviceElapsedTimeSegment(record, { start: boundary, end: boundary + day });
    expect([previous.durationSeconds, current.durationSeconds]).toEqual([30, 30]);
    expect(activitySecondsWithinInterval(current, boundary, boundary + 600_000)).toBe(30);
  });

  it("preserves and splits a positive first point sample across the boundary", () => {
    const record = { ...segment("point", 0, 1), startedAt: "2026-10-14T03:59:58Z", endedAt: "2026-10-14T03:59:58Z", durationSeconds: 5 };
    expect(clipDeviceElapsedTimeSegment(record, { start: boundary - day, end: boundary }).durationSeconds).toBe(2);
    expect(clipDeviceElapsedTimeSegment(record, { start: boundary, end: boundary + day }).durationSeconds).toBe(3);
    expect(record.durationSeconds).toBe(5);
  });

  it("keeps whole-window and unbounded original records intact, and clips outside records to zero", () => {
    const record = { ...segment("whole", 0, 1), startedAt: "2026-10-14T04:01:00Z", endedAt: "2026-10-14T04:02:00Z", durationSeconds: 55 };
    expect(clipDeviceElapsedTimeSegment(record)).toBe(record);
    expect(clipDeviceElapsedTimeSegment(record, { start: boundary, end: boundary + day })).toBe(record);
    expect(clipDeviceElapsedTimeSegment(record, { start: boundary - day, end: boundary }).durationSeconds).toBe(0);
  });
});

describe("cross-device elapsed time", () => {
  it.each([[0, 30], [15, 45], [30, 60]])("counts two 30 minute sessions with offset %i as %i elapsed minutes", (offset, expected) => {
    const records = [segment("local", 0, 30), segment("remote", offset, 30, "pc")];
    const original = JSON.stringify(records);
    expect(totalDurationSeconds(records)).toBe(expected * 60);
    expect(sum(aggregateDeviceElapsedTime(records))).toBe(expected * 60);
    expect(JSON.stringify(records)).toBe(original);
    expect(totalDurationSeconds(filterSegmentsByDevice(records, "local"))).toBe(1800);
    expect(totalDurationSeconds(filterSegmentsByDevice(records, "pc"))).toBe(1800);
  });

  it("uses the union rather than the maximum device total", () => {
    expect(totalDurationSeconds([segment("a", 0, 30), segment("b", 15, 30, "pc"), segment("c", 45, 30)])).toBe(75 * 60);
  });

  it("shares simultaneous classification and app time without claiming attention", () => {
    const records = [segment("editor", 0, 30), segment("video", 0, 30, "pc", "drift")];
    expect(buildProductivityDurations(records).map(value => [value.productivity, value.totalSeconds])).toEqual([["focus", 900], ["neutral", 0], ["drift", 900]]);
    const categories = buildCategoryDurations(records);
    expect(categories.reduce((total, value) => total + value.totalSeconds, 0)).toBe(1800);
    expect(categories.find(value => value.category === "workspace")?.ratio).toBe(0.5);
    expect(buildAppUsageSummaries(records).map(value => value.totalSeconds)).toEqual([900, 900]);
    expect(buildRollingFocusSeconds(records, "2026-10-04", "2026-10-04")).toBe(900);
  });

  it("counts three devices without rounding each contribution up or down", () => {
    const records = [segment("a", 0, 1), segment("b", 0, 1, "b"), segment("c", 0, 1, "c")];
    expect(aggregateDeviceElapsedTime(records).map(value => value.durationSeconds)).toEqual([20, 20, 20]);
    expect(totalDurationSeconds(records)).toBe(60);
    const fractional = records.map(value => ({ ...value, durationSeconds: 1, endedAt: new Date(Date.parse(value.startedAt) + 1000).toISOString() }));
    expect(totalDurationSeconds(fractional)).toBeCloseTo(1, 12);
  });

  it("is stable across record order, host platform and repeated summary passes", () => {
    const records = [segment("a", 0, 30), segment("b", 15, 30, "pc", "drift")];
    const projected = aggregateDeviceElapsedTime(records);
    expect(aggregateDeviceElapsedTime(projected)).toEqual(projected);
    expect(aggregateDeviceElapsedTime(records.slice().reverse()).map(value => value.durationSeconds)).toEqual(projected.map(value => value.durationSeconds).reverse());
    expect(totalDurationSeconds(records.map(value => ({ ...value, platform: "windows" })))).toBe(2700);
    // A classified subset keeps its share of the original all-device window.
    expect(totalDurationSeconds(projected.filter(value => value.id === "a"))).toBe(1350);
  });

  it("leaves single-device sampling and overlapping original records intact", () => {
    const records = [segment("a", 0, 30), { ...segment("b", 0, 30), durationSeconds: 1805 }];
    const projected = aggregateDeviceElapsedTime(records);
    expect(projected[0]).toBe(records[0]);
    expect(projected[1]).toBe(records[1]);
    expect(totalDurationSeconds(records)).toBe(3605);
  });

  it("keeps an uncontested device's original sampling total independent of other devices elsewhere in the period", () => {
    const local = [segment("a", 0, 30), segment("a-import", 15, 30)];
    const records = [...local, segment("pc-next-day", 1440, 30, "pc")];
    expect(totalDurationSeconds(local)).toBe(3600);
    expect(totalDurationSeconds(records)).toBe(5400);
    expect(buildDailyTotals(records, "2026-10-04", "2026-10-05")).toEqual([
      { day: "2026-10-04", totalSeconds: 3600 },
      { day: "2026-10-05", totalSeconds: 1800 },
    ]);
    const point = { ...segment("point", 0, 1), endedAt: segment("point", 0, 1).startedAt };
    const nearby = { ...segment("nearby-point", 0.5, 1), endedAt: segment("nearby-point", 0.5, 1).startedAt };
    expect(totalDurationSeconds([point, nearby])).toBe(120);
    expect(totalDurationSeconds([point, nearby, records[2]])).toBe(1920);
  });

  it("splits one device's allocation between its overlapping records", () => {
    const records = [segment("a", 0, 30), segment("a-import", 0, 30), segment("b", 0, 30, "pc")];
    expect(aggregateDeviceElapsedTime(records).map(value => value.durationSeconds)).toEqual([450, 450, 900]);
  });

  it("preserves point samples and allocates overlap against their recorded duration", () => {
    const point = segment("sample", 0, 1);
    point.endedAt = point.startedAt;
    const records = [point, segment("pc", 0, 1, "pc")];
    expect(totalDurationSeconds(records)).toBe(60);
    expect(buildDailyTotals(records, "2026-10-04", "2026-10-04")[0].totalSeconds).toBe(60);
    expect(buildRollingFocusSeconds(records, "2026-10-04", "2026-10-04")).toBe(60);
    expect(point.startedAt).toBe(point.endedAt);
  });

  it("renders a live point sample alongside received history at every Flow density", () => {
    const point = { ...segment("live-point", 0, 1), endedAt: segment("live-point", 0, 1).startedAt };
    const records = [point, segment("received", 0, 1, "sender")];
    const original = JSON.stringify(records);
    const assertBlocks = (blocks: ReturnType<typeof buildFlowBlocks>) => {
      expect(sum(blocks.flatMap(block => block.composition ?? []))).toBeCloseTo(60);
      expect(blocks.flatMap(block => block.composition ?? []).flatMap(contribution => contribution.sourceSegmentIds).sort()).toEqual(["live-point", "received"]);
    };
    assertBlocks(buildFlowBlocks(records, "2026-10-04", 5));
    for (const blocks of buildFlowBlocksForIntervals(records, "2026-10-04", [1, 5, 15]).values()) {
      assertBlocks(blocks);
    }
    expect(JSON.stringify(records)).toBe(original);
  });

  it("never inflates sparse recorded duration to its whole timestamp span", () => {
    const records = [segment("a", 0, 30), segment("b", 0, 30, "pc")].map(value => ({ ...value, durationSeconds: 900 }));
    expect(totalDurationSeconds(records)).toBe(900);
  });

  it("does not let excluded or failed captures consume another device's share", () => {
    const excluded = { ...segment("excluded", 0, 30, "c"), exclusionSource: "user" as const };
    const failed = { ...segment("failed", 0, 30, "failed-pc"), appName: "Unavailable", source: "unknown" as const };
    const records = [segment("a", 0, 30), segment("b", 0, 30, "pc"), excluded, failed];
    const projected = aggregateDeviceElapsedTime(records);
    expect(projected.map(value => value.durationSeconds)).toEqual([900, 900, 0, 0]);
    expect(totalDurationSeconds(records)).toBe(1800);
  });

  it("drops malformed/nonpositive records from a multi-device summary without changing the originals", () => {
    const invalid = { ...segment("invalid", 0, 30, "c"), startedAt: "invalid" };
    const negative = { ...segment("negative", 0, 30, "d"), durationSeconds: -1 };
    expect(aggregateDeviceElapsedTime([segment("a", 0, 30), segment("b", 0, 30, "pc"), invalid, negative]).map(value => value.durationSeconds)).toEqual([900, 900, 0, 0]);
    expect(invalid.startedAt).toBe("invalid");
  });

  it("clips allocation to each logical day, including a 04:00 boundary", () => {
    const records = [segment("a", 0, 30), segment("b", 0, 30, "pc")].map(value => ({ ...value, startedAt: "2026-10-04T03:45:00", endedAt: "2026-10-04T04:15:00" }));
    expect(buildDailyTotals(records, "2026-10-03", "2026-10-04", 240)).toEqual([{ day: "2026-10-03", totalSeconds: 900 }, { day: "2026-10-04", totalSeconds: 900 }]);
    expect(buildRollingFocusSeconds(records, "2026-10-04", "2026-10-04", undefined, 240)).toBe(900);
    const start = logicalDayStartMs("2026-10-04", 240);
    expect(sum(aggregateDeviceElapsedTime(records).map(value => clipDeviceElapsedTimeSegment(value, { start, end: start + 86_400_000 })))).toBe(900);
  });

  it("allocates each hour/bucket at its actual overlap instead of scaling the entire session uniformly", () => {
    const records = aggregateDeviceElapsedTime([segment("a", 0, 30), segment("b", 15, 30, "pc")]);
    const start = Date.parse(records[0].startedAt);
    expect(activitySecondsWithinInterval(records[0], start, start + 900_000)).toBe(900);
    expect(activitySecondsWithinInterval(records[0], start + 900_000, start + 1_800_000)).toBe(450);
    const blocks = buildFlowBlocks(records, "2026-10-04", 15);
    expect(blocks.flatMap(value => value.composition ?? []).reduce((total, value) => total + value.durationSeconds, 0)).toBe(2700);
    expect(blocks.flatMap(value => value.sourceSegmentIds ?? []).sort()).toEqual(["a", "a", "b"]);
  });

  it("keeps weighted personal-project slices and unassigned gaps consistent with the elapsed total", () => {
    const records = aggregateDeviceElapsedTime([segment("a", 0, 30), segment("b", 15, 30, "pc")]);
    const start = Date.parse(records[0].startedAt);
    const projection = buildPersonalProjectSliceProjection(records, [{ windowStartedAt: records[0].startedAt, windowEndedAt: new Date(start + 900_000).toISOString(), durationSeconds: 900, projectId: "project", source: "ai", segmentOverlaps: [{ segmentId: "a", durationSeconds: 900 }] }], []);
    expect(sum(projection.segments)).toBe(2700);
    const assigned = projection.segments.filter(value => projection.projectBySegmentId.has(value.id));
    expect(sum(assigned)).toBe(900);
    expect(totalDurationSeconds(projection.segments)).toBe(2700);
  });
});
