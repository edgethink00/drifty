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
