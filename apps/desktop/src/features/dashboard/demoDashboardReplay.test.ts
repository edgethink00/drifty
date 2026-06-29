import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  buildDemoDashboardReplayAnchor,
  buildDemoDashboardReplayFixture,
  resolveDemoDashboardReplayProgress,
  sliceDemoDashboardReplaySegments,
} from "./demoDashboardReplay";
import { WeekDashboardDayModelCache, buildWeekDashboardModel } from "./weekDashboardModel";

function baselineSegment(): ActivitySegment {
  return {
    id: "baseline-focus",
    startedAt: "2026-06-17T09:00:00",
    endedAt: "2026-06-17T09:30:00",
    durationSeconds: 30 * 60,
    appName: "Baseline Studio",
    bundleId: "com.drifty.synthetic.baseline-studio",
    windowTitle: "Synthetic focus block",
    platform: "macos",
    source: "manual",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
      reason: "Synthetic baseline segment for dashboard model characterization.",
    },
  };
}

describe("dashboard replay baseline", () => {
  it("Given a minimal synthetic ActivitySegment When the week model is built Then totals and calendar events are derived", () => {
    const segments = [baselineSegment()];

    const model = buildWeekDashboardModel({
      cache: new WeekDashboardDayModelCache(),
      classificationOptions: { includeAiClassifications: true },
      endDay: "2026-06-17",
      segments,
      startDay: "2026-06-17",
      startOfDayMinutes: 0,
      todayDay: "2026-06-17",
    });

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.totalSeconds).toBe(30 * 60);
    expect(model.rows[0]?.focusSeconds).toBe(30 * 60);
    expect(model.rows[0]?.slices.map((slice) => slice.category)).toEqual(["workspace"]);
    expect(model.calendarEvents.get("2026-06-17")?.[0]?.appName).toBe("Baseline Studio");
  });
});

function totalSeconds(segments: readonly ActivitySegment[]): number {
  return segments.reduce((total, segment) => total + segment.durationSeconds, 0);
}

function productivityTotals(segments: readonly ActivitySegment[]): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const segment of segments) {
    const productivity = segment.classification?.productivity ?? "unknown";
    totals.set(productivity, (totals.get(productivity) ?? 0) + segment.durationSeconds);
  }
  return totals;
}

function expectValidSyntheticSegment(segment: ActivitySegment): void {
  const startedAt = new Date(segment.startedAt).getTime();
  const endedAt = new Date(segment.endedAt).getTime();

  expect(Number.isFinite(startedAt)).toBe(true);
  expect(Number.isFinite(endedAt)).toBe(true);
  expect(endedAt).toBeGreaterThan(startedAt);
  expect(segment.durationSeconds).toBe(Math.round((endedAt - startedAt) / 1000));
  expect(segment.platform).toBe("macos");
  expect(segment.source).toBe("manual");
  expect(segment.bundleId).toMatch(/^com\.drifty\.synthetic\./);
  expect(segment.windowTitle).toContain("Synthetic");
  expect(segment.classification).toMatchObject({
    source: "manual",
  });
  expect(typeof segment.classification?.confidence).toBe("number");
  expect(segment.classification?.confidence).toBeGreaterThan(0);
  expect(segment.classification?.reason).toContain("Synthetic");
}

describe("demo dashboard replay anchors", () => {
  it("Given a day replay request When the anchor is built Then it uses the caller logical day", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "day",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 240,
      startOfWeek: "monday",
    });

    expect(anchor).toEqual({
      kind: "day",
      anchorDay: "2026-06-18",
      startDay: "2026-06-18",
      endDay: "2026-06-18",
      rangeStart: "2026-06-18T04:00:00",
      rangeEnd: "2026-06-19T03:59:59",
      startOfDayMinutes: 240,
    });
  });

  it("Given a week replay request When the anchor is built Then it uses the last completed week", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "week",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 240,
      startOfWeek: "monday",
    });

    expect(anchor).toEqual({
      kind: "week",
      anchorDay: "2026-06-14",
      startDay: "2026-06-08",
      endDay: "2026-06-14",
      rangeStart: "2026-06-08T04:00:00",
      rangeEnd: "2026-06-15T03:59:59",
      startOfDayMinutes: 240,
    });
  });
});

describe("demo dashboard replay fixtures", () => {
  it("Given a fixed day anchor When the fixture is built twice Then deterministic synthetic story totals are returned", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "day",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 0,
      startOfWeek: "monday",
    });

    const first = buildDemoDashboardReplayFixture(anchor);
    const second = buildDemoDashboardReplayFixture(anchor);
    const totals = productivityTotals(first.segments);

    expect(second).toEqual(first);
    expect(first.segments).toHaveLength(7);
    expect(totalSeconds(first.segments)).toBe(21_600);
    expect(totals.get("focus")).toBe(17_100);
    expect(totals.get("neutral")).toBe(3_600);
    expect(totals.get("drift")).toBe(900);
    expect(first.segments.map((segment) => segment.classification?.category)).toEqual([
      "workspace",
      "communication",
      "learning",
      "social_media",
      "workspace",
      "utility",
      "workspace",
    ]);
    first.segments.forEach(expectValidSyntheticSegment);
  });

  it("Given a fixed week anchor When the fixture is built Then a full completed week with varied mix is returned", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "week",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 0,
      startOfWeek: "monday",
    });

    const fixture = buildDemoDashboardReplayFixture(anchor);
    const totals = productivityTotals(fixture.segments);
    const model = buildWeekDashboardModel({
      cache: new WeekDashboardDayModelCache(),
      classificationOptions: { includeAiClassifications: true },
      endDay: anchor.endDay,
      segments: fixture.segments,
      startDay: anchor.startDay,
      startOfDayMinutes: anchor.startOfDayMinutes,
      todayDay: anchor.endDay,
    });

    expect(fixture.segments).toHaveLength(26);
    expect(totalSeconds(fixture.segments)).toBe(93_300);
    expect(totals.get("focus")).toBe(62_700);
    expect(totals.get("neutral")).toBe(20_400);
    expect(totals.get("drift")).toBe(10_200);
    expect(model.rows.map((row) => row.day)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
    expect(model.rows.map((row) => row.totalSeconds)).toEqual([
      14_700,
      16_200,
      17_100,
      15_900,
      12_900,
      9_300,
      7_200,
    ]);
    fixture.segments.forEach(expectValidSyntheticSegment);
  });
});

describe("demo dashboard replay slicing", () => {
  it("Given increasing progress When segments are sliced Then output is monotonic and active segments are truncated", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "day",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 0,
      startOfWeek: "monday",
    });
    const fixture = buildDemoDashboardReplayFixture(anchor);

    const morning = sliceDemoDashboardReplaySegments({ anchor, progress: 10 / 24, segments: fixture.segments });
    const afternoon = sliceDemoDashboardReplaySegments({ anchor, progress: 14 / 24, segments: fixture.segments });

    expect(morning.progress).toBe(10 / 24);
    expect(morning.virtualCurrentDay).toBe("2026-06-18");
    expect(morning.virtualCurrentMinuteOfDay).toBe(599);
    expect(morning.segments).toHaveLength(1);
    expect(morning.segments[0]?.endedAt).toBe("2026-06-18T10:00:00");
    expect(morning.segments[0]?.durationSeconds).toBe(60 * 60);
    expect(totalSeconds(afternoon.segments)).toBeGreaterThan(totalSeconds(morning.segments));
    expect(afternoon.segments.every((segment) => segment.durationSeconds > 0)).toBe(true);
  });

  it("Given a noon start-of-day When replay starts Then no pre-roll segments are revealed and totals increase from zero", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "day",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 12 * 60,
      startOfWeek: "monday",
    });
    const fixture = buildDemoDashboardReplayFixture(anchor);

    const totals = [0, 10 / 24, 14 / 24, 1].map((progress) => (
      totalSeconds(sliceDemoDashboardReplaySegments({ anchor, progress, segments: fixture.segments }).segments)
    ));

    expect(sliceDemoDashboardReplaySegments({ anchor, progress: 0, segments: fixture.segments }).segments).toHaveLength(0);
    expect(totals[0]).toBe(0);
    expect(totals[1]).toBeGreaterThan(totals[0] ?? 0);
    expect(totals[2]).toBeGreaterThan(totals[1] ?? 0);
    expect(totals[3]).toBe(fixture.totalSeconds);
  });

  it("Given malformed progress and invalid segments When slicing Then values are clamped without invalid output", () => {
    const anchor = buildDemoDashboardReplayAnchor({
      kind: "day",
      currentLogicalDay: "2026-06-18",
      startOfDayMinutes: 0,
      startOfWeek: "monday",
    });
    const fixture = buildDemoDashboardReplayFixture(anchor);
    const zeroDurationSegment = {
      ...fixture.segments[0],
      id: "zero-duration",
      endedAt: fixture.segments[0]?.startedAt ?? "2026-06-18T09:00:00",
      durationSeconds: 0,
    };

    const below = sliceDemoDashboardReplaySegments({ anchor, progress: -0.25, segments: fixture.segments });
    const above = sliceDemoDashboardReplaySegments({ anchor, progress: 1.25, segments: fixture.segments });
    const invalid = sliceDemoDashboardReplaySegments({ anchor, progress: 0.5, segments: [zeroDurationSegment] });

    expect(below.progress).toBe(0);
    expect(below.segments).toEqual([]);
    expect(above.progress).toBe(1);
    expect(above.segments).toEqual(fixture.segments);
    expect(invalid.segments).toEqual([]);
    expect(resolveDemoDashboardReplayProgress({ durationSeconds: 0, elapsedMs: 5_000 })).toBe(1);
    expect(resolveDemoDashboardReplayProgress({ durationSeconds: 45, elapsedMs: -1_000 })).toBe(0);
    expect(resolveDemoDashboardReplayProgress({ durationSeconds: 45, elapsedMs: 90_000 })).toBe(1);
  });
});
