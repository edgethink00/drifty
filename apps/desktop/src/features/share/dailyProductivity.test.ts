import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logicalDayEndExclusiveMs, shiftIsoDate, todayIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

import { buildDailyProductivitySeries } from "./dailyProductivity";

function makeSegment(day: string, durationSeconds: number, overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  const startedAt = new Date(`${day}T09:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  return {
    id: `${day}-${durationSeconds}-${overrides.appName ?? "safari"}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    appName: "Safari",
    siteDomain: "stackoverflow.com",
    siteTitle: "Developer docs",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

describe("buildDailyProductivitySeries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("buckets per-day focus and drift over the window", () => {
    const today = todayIsoDate();
    const start = shiftIsoDate(today, -29);
    const midMonth = shiftIsoDate(today, -10);

    const series = buildDailyProductivitySeries(
      [
        makeSegment(today, 3600),
        // YouTube classifies as drift by default rules.
        makeSegment(today, 1200, { appName: "Safari", siteDomain: "youtube.com", siteTitle: "Video" }),
        makeSegment(midMonth, 1800),
      ],
      start,
      today,
      { fallbackCandidates: [] },
      0,
    );

    expect(series).toHaveLength(30);
    const byDay = Object.fromEntries(series.map((point) => [point.day, point]));
    expect(byDay[today].focus).toBe(3600);
    expect(byDay[today].drift).toBe(1200);
    expect(byDay[midMonth].focus).toBe(1800);
    expect(byDay[start]).toEqual({ day: start, focus: 0, drift: 0, neutral: 0 });
  });

  it("splits a segment across the logical-day boundary", () => {
    const today = todayIsoDate();
    const yesterday = shiftIsoDate(today, -1);
    // Straddle the local logical-day boundary: 30 minutes either side of it.
    const boundaryMs = logicalDayEndExclusiveMs(yesterday, 0);
    const startedAt = new Date(boundaryMs - 30 * 60 * 1000);
    const endedAt = new Date(boundaryMs + 30 * 60 * 1000);
    const crossing: ActivitySegment = {
      ...makeSegment(yesterday, 3600),
      id: "crossing",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    };

    const series = buildDailyProductivitySeries([crossing], yesterday, today, { fallbackCandidates: [] }, 0);
    const byDay = Object.fromEntries(series.map((point) => [point.day, point]));
    expect(byDay[yesterday].focus).toBe(1800);
    expect(byDay[today].focus).toBe(1800);
  });
});

describe("Profile daily productivity uses elapsed time across devices", () => {
  const day = "2026-10-04";
  const record = (id: string, deviceId: string, startMinute: number, durationSeconds: number, productivity: "focus" | "drift" = "focus"): ActivitySegment => {
    const start = new Date(2026, 9, 4, 9, startMinute).getTime();
    return makeSegment(day, durationSeconds, {
      id, deviceId, startedAt: new Date(start).toISOString(), endedAt: new Date(start + durationSeconds * 1000).toISOString(),
      classification: { category: productivity === "focus" ? "workspace" : "entertainment", productivity, source: "manual", confidence: 1 },
    });
  };

  it.each([[0, 1800], [15, 2700], [30, 3600]])("does not count concurrent devices twice (offset %i)", (offset, expected) => {
    const records = [record("mac", "mac", 0, 1800), record("pc", "pc", offset, 1800)];
    const original = JSON.stringify(records);
    expect(buildDailyProductivitySeries(records, day, day, {}, 0)[0].focus).toBe(expected);
    expect(JSON.stringify(records)).toBe(original);
    expect(buildDailyProductivitySeries(records.filter(item => item.deviceId === "mac"), day, day, {}, 0)[0].focus).toBe(1800);
  });

  it("allocates simultaneous Focus/Drift consistently instead of inflating either", () => {
    const records = [record("mac", "mac", 0, 1800), record("pc", "pc", 0, 1800, "drift")];
    expect(buildDailyProductivitySeries(records, day, day, {}, 0)[0]).toEqual({ day, focus: 900, drift: 900, neutral: 0 });
  });

  it("preserves fractional allocations from three concurrent devices", () => {
    const records = [record("a", "a", 0, 1), record("b", "b", 0, 1, "drift"), record("c", "c", 0, 1, "drift")];
    const point = buildDailyProductivitySeries(records, day, day, {}, 0)[0];
    expect(point.focus).toBeCloseTo(1 / 3);
    expect(point.drift).toBeCloseTo(2 / 3);
    expect(point.focus + point.drift).toBeCloseTo(1);
  });

  it("clips device allocations on both sides of the logical day", () => {
    const boundary = new Date(2026, 9, 4, 4).getTime();
    const records = ["mac", "pc"].map(deviceId => ({
      ...record(deviceId, deviceId, 0, 3600),
      startedAt: new Date(boundary - 1800_000).toISOString(), endedAt: new Date(boundary + 1800_000).toISOString(),
    }));
    expect(buildDailyProductivitySeries(records, "2026-10-03", day, {}, 240)).toEqual([
      { day: "2026-10-03", focus: 1800, drift: 0, neutral: 0 },
      { day, focus: 1800, drift: 0, neutral: 0 },
    ]);
  });

  it("preserves a newly captured point sample", () => {
    const point = record("point", "mac", 0, 5);
    point.endedAt = point.startedAt;
    expect(buildDailyProductivitySeries([point], day, day, {}, 0)[0].focus).toBe(5);
  });

  it("retains an uncontested single-device day's sampling semantics", () => {
    const records = [record("local-a", "mac", 0, 60), record("local-b", "mac", 0, 60),
      { ...record("elsewhere", "pc", 0, 60), startedAt: new Date(2026, 9, 5, 9).toISOString(), endedAt: new Date(2026, 9, 5, 9, 1).toISOString() }];
    expect(buildDailyProductivitySeries(records, day, day, {}, 0)[0].focus).toBe(120);
  });
});

describe("Profile allocation preserves duration-based classifications", () => {
  it.each([
    ["X", "x.com", "https://x.com/home"],
    ["YouTube", "youtube.com", "https://www.youtube.com/feed/subscriptions"],
  ])("keeps the original 40s %s feed classification after sharing elapsed time", (_name, siteDomain, siteUrl) => {
    const day = "2026-10-04";
    const start = new Date(2026, 9, 4, 9).getTime();
    const feed = makeSegment(day, 40, {
      id: "feed", deviceId: "mac", siteDomain, siteUrl,
      startedAt: new Date(start).toISOString(), endedAt: new Date(start + 40_000).toISOString(),
    });
    const docs = { ...feed, id: "docs", deviceId: "pc", siteDomain: "stackoverflow.com", siteUrl: "https://stackoverflow.com/questions/1" };
    expect(buildDailyProductivitySeries([feed], day, day, {}, 0)[0].drift).toBe(40);
    expect(buildDailyProductivitySeries([feed, docs], day, day, {}, 0)[0]).toEqual({
      day, focus: 20, drift: 20, neutral: 0,
    });
  });
});
