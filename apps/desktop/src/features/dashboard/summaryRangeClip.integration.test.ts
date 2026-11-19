import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  aggregateDeviceElapsedTime,
  clipDeviceElapsedTimeSegment,
  logicalDayEndExclusiveMs,
  logicalDayStartMs,
  totalDurationSeconds,
  type ActivitySegment,
} from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildClassificationCorrectionRecord } from "../classification/classificationCorrection";
import { buildClassificationActivityRows } from "../classification/classificationViewData";
import { selectInsightSegments } from "../insights/insightSegments";
import { buildQuarterHourDayField } from "./dayField";
import { buildFocusDriftChart } from "./focusDriftChart";
import { buildWeekCalendarEvents, splitSegmentIntoDayOverlaps } from "./weekCalendar";

type QueryKind = "full" | "page" | "search" | "compact" | "trend" | "live";
type FixtureResult = {
  readonly python: string;
  readonly first: Record<QueryKind, ActivitySegment[]>;
  readonly second: Record<QueryKind, ActivitySegment[]>;
};

const fixturePath = fileURLToPath(new URL(
  "../../../../../services/tracker-python/tests/summary_range_clip_db_fixture.py",
  import.meta.url,
));
const python = process.platform === "darwin" ? "/usr/bin/python3" : process.env.PYTHON ?? "python3";

function runFixture(firstStartMs: number, boundaryMs: number, secondEndMs: number): FixtureResult {
  const child = spawnSync(python, [fixturePath], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    input: JSON.stringify({ firstStartMs, boundaryMs, secondEndMs }),
    timeout: 15_000,
  });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || `fixture exited ${child.status}`);
  return JSON.parse(child.stdout) as FixtureResult;
}

function classified(segment: ActivitySegment): ActivitySegment {
  return {
    ...segment,
    classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 },
  };
}

function byApp(segments: readonly ActivitySegment[], appName: string): ActivitySegment[] {
  return segments.filter((segment) => segment.appName === appName).map(classified);
}

function queryRange(start: number, endExclusive: number) {
  return { start: new Date(start).toISOString(), end: new Date(endExclusive - 1000).toISOString() };
}

function selectActualConsumer(
  segments: ActivitySegment[],
  start: number,
  end: number,
): ActivitySegment[] {
  return selectInsightSegments({
    historySegments: segments,
    selectedDaySegments: [],
    range: queryRange(start, end),
    endExclusiveMs: end,
  });
}

describe("summary range clipping from real SQLite rows", () => {
  it.each([
    ["midnight", Date.UTC(2026, 9, 4), Date.UTC(2026, 9, 5)],
    ["custom 04:00", Date.UTC(2026, 9, 4, 4), Date.UTC(2026, 9, 5, 4)],
    ["New York spring DST 23h", Date.UTC(2026, 2, 8, 5), Date.UTC(2026, 2, 9, 4)],
    ["New York fall DST 25h", Date.UTC(2026, 10, 1, 4), Date.UTC(2026, 10, 2, 5)],
  ])("loads and conserves positive samples for %s", (_label, firstStartMs, boundaryMs) => {
    const fixture = runFixture(firstStartMs, boundaryMs, boundaryMs + 26 * 60 * 60_000);
    // Compare major and minor as numbers: as one decimal, 3.14 reads below 3.9.
    const [major, minor] = fixture.python.split(".").map(Number);
    expect(major > 3 || (major === 3 && minor >= 9), `Python ${fixture.python} is 3.9 or later`).toBe(true);

    for (const queryKind of ["full", "page", "search", "compact", "trend", "live"] as const) {
      const firstIds = new Map(fixture.first[queryKind].map((segment) => [segment.appName, segment.id]));
      const secondIds = new Map(fixture.second[queryKind].map((segment) => [segment.appName, segment.id]));
      for (const appName of ["Single point", "Multi point a", "Multi point b", "Long duration", "Sparse drawing", "Final second", "[Redacted]", "Unavailable"]) {
        expect(firstIds.get(appName), `${queryKind} first ${appName}`).toBeTruthy();
        expect(secondIds.get(appName), `${queryKind} second ${appName}`).toBe(firstIds.get(appName));
      }
    }

    const firstPoint = selectActualConsumer(byApp(fixture.first.full, "Single point"), firstStartMs, boundaryMs);
    const secondPoint = selectActualConsumer(byApp(fixture.second.full, "Single point"), boundaryMs, boundaryMs + 26 * 60 * 60_000);
    expect([totalDurationSeconds(firstPoint), totalDurationSeconds(secondPoint)]).toEqual([2, 58]);

    const firstLong = selectActualConsumer(byApp(fixture.first.full, "Long duration"), firstStartMs, boundaryMs);
    const secondLong = selectActualConsumer(byApp(fixture.second.full, "Long duration"), boundaryMs, boundaryMs + 26 * 60 * 60_000);
    expect([totalDurationSeconds(firstLong), totalDurationSeconds(secondLong)]).toEqual([600, 600]);

    const firstMulti = aggregateDeviceElapsedTime([
      ...byApp(fixture.first.full, "Multi point a"),
      ...byApp(fixture.first.full, "Multi point b"),
    ]).map((segment) => clipDeviceElapsedTimeSegment(segment, { start: firstStartMs, end: boundaryMs }));
    const secondMulti = aggregateDeviceElapsedTime([
      ...byApp(fixture.second.full, "Multi point a"),
      ...byApp(fixture.second.full, "Multi point b"),
    ]).map((segment) => clipDeviceElapsedTimeSegment(segment, { start: boundaryMs, end: boundaryMs + 26 * 60 * 60_000 }));
    expect([totalDurationSeconds(firstMulti), totalDurationSeconds(secondMulti)]).toEqual([2, 58]);

    const firstFinalSecond = selectActualConsumer(byApp(fixture.first.full, "Final second"), firstStartMs, boundaryMs);
    const secondFinalSecond = selectActualConsumer(byApp(fixture.second.full, "Final second"), boundaryMs, boundaryMs + 26 * 60 * 60_000);
    expect([totalDurationSeconds(firstFinalSecond), totalDurationSeconds(secondFinalSecond)]).toEqual([1, 0]);
    expect(buildClassificationActivityRows(firstFinalSecond)[0]?.totalSeconds).toBe(1);

    const excluded = selectActualConsumer(byApp(fixture.second.full, "[Redacted]"), boundaryMs, boundaryMs + 26 * 60 * 60_000);
    const failed = selectActualConsumer(byApp(fixture.second.full, "Unavailable"), boundaryMs, boundaryMs + 26 * 60 * 60_000);
    expect([totalDurationSeconds(excluded), totalDurationSeconds(failed)]).toEqual([0, 0]);
  });

  it("keeps sparse drawing geometry and correction targets while conserving sampled density", () => {
    const day = "2026-10-04";
    const firstStartMs = logicalDayStartMs(day, 240);
    const boundaryMs = logicalDayEndExclusiveMs(day, 240);
    const fixture = runFixture(firstStartMs, boundaryMs, boundaryMs + 24 * 60 * 60_000);
    const raw = byApp(fixture.first.full, "Sparse drawing")[0];
    const clipped = selectActualConsumer([raw], firstStartMs, boundaryMs)[0];
    expect(clipped.durationSeconds).toBe(60);

    const dayField = buildQuarterHourDayField([clipped], day, 240);
    const focusChart = buildFocusDriftChart([clipped], day, undefined, null, 240);
    const overlaps = splitSegmentIntoDayOverlaps(clipped, day, day, 240);
    const events = buildWeekCalendarEvents([clipped], day, day, 0, 24, undefined, 240).get(day) ?? [];
    expect(dayField.reduce((sum, slot) => sum + slot.totalSeconds, 0)).toBe(60);
    expect(focusChart.points.reduce((sum, point) => sum + point.trackedSeconds, 0)).toBe(60);
    expect(focusChart.points.reduce((sum, point) => sum + point.focusCaptures, 0)).toBe(1);
    expect(overlaps.map((overlap) => overlap.durationSeconds)).toEqual([60]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      segmentIds: [raw.id],
      activeDurationMinutes: 1,
      durationMinutes: 10,
    });
    expect(events[0].identities.reduce((sum, identity) => sum + identity.seconds, 0)).toBe(60);

    const correctionInput = { category: "workspace" as const, productivity: "focus" as const, classifiedAt: "2026-10-07T00:00:00.000Z" };
    expect(buildClassificationCorrectionRecord({ ...correctionInput, segment: clipped }))
      .toEqual(buildClassificationCorrectionRecord({ ...correctionInput, segment: raw }));
  });

  it.each([
    ["spring midnight", "2026-03-08", 0, 23 * 60 * 60_000, "11:50 PM", "12:00 AM"],
    ["fall midnight", "2026-11-01", 0, 25 * 60 * 60_000, "11:50 PM", "12:00 AM"],
    ["spring custom 04:00", "2026-03-07", 240, 23 * 60 * 60_000, "3:50 AM", "4:00 AM"],
    ["fall custom 04:00", "2026-10-31", 240, 25 * 60 * 60_000, "3:50 AM", "4:00 AM"],
  ])("keeps fixed clock geometry and drawing density across the New York %s DST day", (_label, day, boundaryMinutes, expectedWindowMs, startLabel, endLabel) => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const start = logicalDayStartMs(day, boundaryMinutes);
      const end = logicalDayEndExclusiveMs(day, boundaryMinutes);
      expect(end - start).toBe(expectedWindowMs);
      const raw = classified({
        id: `dst-drawing-${day}`,
        appName: "DST drawing",
        platform: "macos",
        source: "manual",
        startedAt: new Date(end - 10 * 60_000).toISOString(),
        endedAt: new Date(end + 10 * 60_000).toISOString(),
        durationSeconds: 120,
      });
      const clipped = clipDeviceElapsedTimeSegment(raw, { start, end });
      expect(clipped.durationSeconds).toBe(60);

      const dayField = buildQuarterHourDayField([clipped], day, boundaryMinutes);
      const focusChart = buildFocusDriftChart([clipped], day, undefined, null, boundaryMinutes);
      const events = buildWeekCalendarEvents([clipped], day, day, 0, 24, undefined, boundaryMinutes).get(day) ?? [];
      expect(dayField).toHaveLength(96);
      expect(dayField.filter((slot) => slot.totalSeconds > 0).map((slot) => slot.index)).toEqual([95]);
      expect(dayField.reduce((sum, slot) => sum + slot.totalSeconds, 0)).toBe(60);
      expect(focusChart.points.filter((point) => point.trackedSeconds > 0).map((point) => point.bucketStartMinute)).toEqual([1410]);
      expect(focusChart.points.reduce((sum, point) => sum + point.trackedSeconds, 0)).toBe(60);
      expect(focusChart.points.reduce((sum, point) => sum + point.focusCaptures, 0)).toBe(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        segmentIds: [raw.id],
        startLabel,
        endLabel,
        activeDurationMinutes: 1,
        durationMinutes: 10,
      });
      expect(events[0].identities.reduce((sum, identity) => sum + identity.seconds, 0)).toBe(60);
      expect(buildClassificationCorrectionRecord({
        segment: clipped,
        category: "workspace",
        productivity: "focus",
        classifiedAt: "2026-10-07T00:00:00.000Z",
      }).segmentId).toBe(raw.id);
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });
});
