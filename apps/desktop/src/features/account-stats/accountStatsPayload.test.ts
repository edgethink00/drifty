import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shiftIsoDate, todayIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

import { buildAccountStatsPayload, buildAccountStatsPayloadFromTracker } from "./accountStatsPayload";
import { TOP_APPS_MAX, TOP_APPS_MIN_SECONDS } from "../share/focusCardPublisher";
import { trackerClient } from "../../lib/api/trackerClient";

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { getTimeline: vi.fn() },
}));

// Safari on stackoverflow.com classifies as focus (mirrors focusCardPublisher.test).
function makeSegment(day: string, durationSeconds: number, appName = "Safari"): ActivitySegment {
  const startedAt = new Date(`${day}T09:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  return {
    id: `${day}-${appName}-${durationSeconds}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    appName,
    siteDomain: appName === "Safari" ? "stackoverflow.com" : null,
    siteTitle: appName === "Safari" ? "Developer docs" : null,
    platform: "macos",
    source: "nsworkspace",
  };
}

const baseInput = { startOfDayMinutes: 0, includeAiClassifications: false };

describe("buildAccountStatsPayload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scopes today vs 7d vs 30d windows correctly", () => {
    const today = todayIsoDate();
    const monthStart = shiftIsoDate(today, -29);
    const midWeek = shiftIsoDate(today, -3);
    const outsideWeek = shiftIsoDate(today, -20);

    const payload = buildAccountStatsPayload(
      [makeSegment(today, 3600), makeSegment(midWeek, 1800), makeSegment(outsideWeek, 900)],
      { ...baseInput, windowEndDay: today },
    );

    // Today slice: only today's segment.
    expect(payload.focusSecondsToday).toBe(3600);
    expect(payload.driftSecondsToday).toBe(0);
    expect(payload.neutralSecondsToday).toBe(0);
    expect(payload.categoryBreakdownToday.reduce((sum, entry) => sum + entry.seconds, 0)).toBe(3600);

    // 7-day slice: today + mid-week, the 20-days-ago segment is excluded.
    expect(payload.focusSeconds7d).toBe(5400);
    expect(payload.driftSeconds7d).toBe(0);
    expect(payload.neutralSeconds7d).toBe(0);
    expect(payload.focusShare7d).toBe(1);
    expect(payload.categoryBreakdown7d.reduce((sum, entry) => sum + entry.seconds, 0)).toBe(5400);

    // 30-day series carries the full month.
    expect(payload.dailySeries30d).toHaveLength(30);
    const byDay = Object.fromEntries(payload.dailySeries30d.map((point) => [point.day, point.focus]));
    expect(payload.dailySeries30d[0]?.day).toBe(monthStart);
    expect(byDay[today]).toBe(3600);
    expect(byDay[midWeek]).toBe(1800);
    expect(byDay[outsideWeek]).toBe(900);
    expect(byDay[monthStart]).toBe(0);
    for (const point of payload.dailySeries30d) {
      expect(Object.keys(point).sort()).toEqual(["day", "drift", "focus", "neutral"]);
    }

    expect(payload.windowEndDate).toBe(today);
    expect(payload.timezone.length).toBeGreaterThan(0);
  });

  it("returns a zeroed but well-formed payload for an empty window", () => {
    const today = todayIsoDate();
    const payload = buildAccountStatsPayload([], { ...baseInput, windowEndDay: today });

    expect(payload.focusSecondsToday).toBe(0);
    expect(payload.driftSecondsToday).toBe(0);
    expect(payload.neutralSecondsToday).toBe(0);
    expect(payload.categoryBreakdownToday).toEqual([]);
    expect(payload.focusSeconds7d).toBe(0);
    expect(payload.focusShare7d).toBe(0);
    expect(payload.categoryBreakdown7d).toEqual([]);
    expect(payload.topApps7d).toEqual([]);
    expect(payload.hourlyPattern7d).toHaveLength(24);
    expect(payload.hourlyPattern7d.every((point) => point.focusSeconds === 0)).toBe(true);
    expect(payload.dailySeries30d).toHaveLength(30);
    expect(payload.dailySeries30d.every((point) => point.focus === 0)).toBe(true);
  });

  it("averages the hourly pattern per hour-of-day across the 7-day window", () => {
    const today = todayIsoDate();
    const midWeek = shiftIsoDate(today, -3);
    const outsideWeek = shiftIsoDate(today, -20);

    const payload = buildAccountStatsPayload(
      // Both in-week segments start 09:00Z = 18:00 KST (tests run with TZ=Asia/Seoul):
      // today's fills 18:00–19:00 (3600s), mid-week's 18:00–18:30 (1800s).
      [makeSegment(today, 3600), makeSegment(midWeek, 1800), makeSegment(outsideWeek, 900)],
      { ...baseInput, windowEndDay: today },
    );

    expect(payload.hourlyPattern7d).toHaveLength(24);
    expect(payload.hourlyPattern7d.map((point) => point.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    // (3600 + 1800) / 7 days; the out-of-week hour contributes nothing.
    expect(payload.hourlyPattern7d[18].focusSeconds).toBe(Math.round(5400 / 7));
    expect(payload.hourlyPattern7d.filter((point) => point.hour !== 18).every((point) => point.focusSeconds === 0)).toBe(true);
  });

  it("caps top apps at 5 and drops under-15-minute apps", () => {
    const today = todayIsoDate();
    const midWeek = shiftIsoDate(today, -2);
    const payload = buildAccountStatsPayload(
      [
        makeSegment(today, 7200, "Xcode"),
        makeSegment(today, 5400, "Safari"),
        makeSegment(midWeek, 4500, "Figma"),
        makeSegment(midWeek, 3600, "Slack"),
        makeSegment(today, 1800, "Notes"),
        makeSegment(midWeek, 1200, "Terminal"),
        makeSegment(today, TOP_APPS_MIN_SECONDS - 1, "Preview"), // under the 15-minute floor
      ],
      { ...baseInput, windowEndDay: today },
    );

    expect(payload.topApps7d).toHaveLength(TOP_APPS_MAX); // 6 qualify, capped at 5 — Terminal is cut
    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Xcode", "Safari", "Figma", "Slack", "Notes"]);
    expect(payload.topApps7d.every((entry) => entry.seconds >= TOP_APPS_MIN_SECONDS)).toBe(true);
    for (const entry of payload.topApps7d) {
      expect(Object.keys(entry).sort()).toEqual(["appName", "seconds"]);
    }
  });
});

describe("buildAccountStatsPayloadFromTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(trackerClient.getTimeline).mockReset();
  });

  it("excludes browser-history-import segments from every aggregate", async () => {
    const today = todayIsoDate();
    const imported: ActivitySegment = {
      ...makeSegment(today, 7200, "Arc"),
      source: "browser-history-import",
    };
    vi.mocked(trackerClient.getTimeline).mockResolvedValue([makeSegment(today, 3600), imported]);

    const payload = await buildAccountStatsPayloadFromTracker({ ...baseInput, windowEndDay: today });

    expect(payload.focusSecondsToday).toBe(3600);
    expect(payload.focusSeconds7d).toBe(3600);
    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Safari"]);
    expect(payload.dailySeries30d.find((point) => point.day === today)?.focus).toBe(3600);
  });

  it("excludes segments synced in from another Mac from every aggregate", async () => {
    const today = todayIsoDate();
    const remote: ActivitySegment = {
      ...makeSegment(today, 7200, "Arc"),
      deviceId: "11111111-2222-3333-4444-555555555555",
    };
    vi.mocked(trackerClient.getTimeline).mockResolvedValue([makeSegment(today, 3600), remote]);

    const payload = await buildAccountStatsPayloadFromTracker({ ...baseInput, windowEndDay: today });

    // Otherwise every synced device would publish an inflated total that
    // double-counts the other device's activity.
    expect(payload.focusSecondsToday).toBe(3600);
    expect(payload.focusSeconds7d).toBe(3600);
    expect(payload.topApps7d.map((entry) => entry.appName)).toEqual(["Safari"]);
    expect(payload.dailySeries30d.find((point) => point.day === today)?.focus).toBe(3600);
  });
});
