import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shiftIsoDate, todayIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

const { getTimeline, publishOwnFocusTotal } = vi.hoisted(() => ({
  getTimeline: vi.fn(),
  publishOwnFocusTotal: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: {
    getTimeline,
  },
}));

vi.mock("./leaderboardService", async (importOriginal) => {
  const original = await importOriginal<typeof import("./leaderboardService")>();
  return {
    ...original,
    publishOwnFocusTotal,
  };
});

import { buildLeaderboardPublishPayloads, publishLeaderboardPeriods } from "./leaderboardPublisher";

function makeSegment(day: string, durationSeconds: number): ActivitySegment {
  const startedAt = new Date(`${day}T09:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  return {
    id: `${day}-${durationSeconds}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    appName: "Safari",
    siteDomain: "stackoverflow.com",
    siteTitle: "Developer docs",
    platform: "macos",
    source: "nsworkspace",
  };
}

describe("leaderboardPublisher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
    vi.clearAllMocks();
  });

  it("builds daily, weekly, and monthly aggregate payloads from one monthly timeline read", async () => {
    const today = todayIsoDate();
    const weeklyStart = shiftIsoDate(today, -6);
    const monthlyStart = shiftIsoDate(today, -29);
    getTimeline.mockResolvedValue([
      makeSegment(today, 3600),
      makeSegment(weeklyStart, 1800),
      makeSegment(monthlyStart, 900),
    ]);

    const result = await buildLeaderboardPublishPayloads({
      profileDisplayName: "Alex",
      leaderboardWindowEndDay: today,
      timezone: "Asia/Seoul",
      startOfDayMinutes: 0,
      showAiClassificationImpact: false,
    });

    expect(getTimeline).toHaveBeenCalledTimes(1);
    expect(result.segmentCount).toBe(3);
    expect(result.payloads.map((payload) => ({
      period: payload.period,
      focusSeconds: payload.focusSeconds,
      windowStartDay: payload.windowStartDay,
      windowEndDay: payload.windowEndDay,
    }))).toEqual([
      { period: "daily", focusSeconds: 3600, windowStartDay: today, windowEndDay: today },
      { period: "weekly", focusSeconds: 5400, windowStartDay: weeklyStart, windowEndDay: today },
      { period: "monthly", focusSeconds: 6300, windowStartDay: monthlyStart, windowEndDay: today },
    ]);
    expect(result.payloads[0]?.payloadKey).not.toContain("siteDomain");
    expect(result.payloads[0]?.payloadKey).not.toContain("siteTitle");
  });

  it("excludes browser history import estimates from published focus totals", async () => {
    const today = todayIsoDate();
    getTimeline.mockResolvedValue([
      makeSegment(today, 3600),
      {
        ...makeSegment(today, 1800),
        id: `${today}-imported`,
        source: "browser-history-import",
        siteSource: "browser-history-import",
      },
    ]);

    const result = await buildLeaderboardPublishPayloads({
      profileDisplayName: "Alex",
      leaderboardWindowEndDay: today,
      timezone: "Asia/Seoul",
      startOfDayMinutes: 0,
      showAiClassificationImpact: false,
    });

    expect(result.segmentCount).toBe(1);
    for (const payload of result.payloads) {
      expect(payload.focusSeconds).toBe(3600);
    }
  });

  it("publishes auto aggregates without updating profiles", async () => {
    const today = todayIsoDate();
    getTimeline.mockResolvedValue([makeSegment(today, 3600)]);
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    const result = await publishLeaderboardPeriods({
      mode: "auto",
      profileDisplayName: "Alex",
      leaderboardWindowEndDay: today,
      timezone: "Asia/Seoul",
      startOfDayMinutes: 0,
      showAiClassificationImpact: false,
    });

    expect(result.success).toBe(true);
    expect(publishOwnFocusTotal).toHaveBeenCalledTimes(3);
    expect(publishOwnFocusTotal).toHaveBeenCalledWith(expect.objectContaining({ period: "daily" }), undefined, { updateProfile: false });
    expect(publishOwnFocusTotal).toHaveBeenCalledWith(expect.objectContaining({ period: "weekly" }), undefined, { updateProfile: false });
    expect(publishOwnFocusTotal).toHaveBeenCalledWith(expect.objectContaining({ period: "monthly" }), undefined, { updateProfile: false });
  });

  it("rebuilds stale publish windows against the current logical day before publishing", async () => {
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0, 0));
    const today = todayIsoDate();
    const staleDay = shiftIsoDate(today, -2);
    getTimeline.mockResolvedValue([makeSegment(today, 3600)]);
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    const result = await publishLeaderboardPeriods({
      mode: "auto",
      profileDisplayName: "Alex",
      leaderboardWindowEndDay: staleDay,
      timezone: "Asia/Seoul",
      startOfDayMinutes: 0,
      showAiClassificationImpact: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.payloads.map((payload) => payload.windowEndDay)).toEqual([today, today, today]);
    expect(publishOwnFocusTotal).toHaveBeenCalledWith(
      expect.objectContaining({ period: "daily", window_end_date: today }),
      undefined,
      { updateProfile: false },
    );
  });
});
