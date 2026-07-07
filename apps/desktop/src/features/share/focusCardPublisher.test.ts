import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shiftIsoDate, todayIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

import { buildFocusCardPayload } from "./focusCardPublisher";

// Safari on stackoverflow.com classifies as focus (mirrors leaderboardPublisher.test).
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

describe("buildFocusCardPayload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a 7-day window with per-day focus and consistent aggregates", () => {
    const today = todayIsoDate();
    const start = shiftIsoDate(today, -6);
    const midWeek = shiftIsoDate(today, -3);

    const payload = buildFocusCardPayload([makeSegment(today, 3600), makeSegment(midWeek, 1800)], {
      windowEndDay: today,
      startOfDayMinutes: 0,
      includeAiClassifications: false,
    });

    expect(payload.window_start_date).toBe(start);
    expect(payload.window_end_date).toBe(today);
    expect(payload.daily_focus).toHaveLength(7);

    expect(payload.focus_seconds_today).toBe(3600);
    expect(payload.focus_seconds_7d).toBe(5400);
    // all focus segments → no drift/neutral, share is 1
    expect(payload.drift_seconds_7d).toBe(0);
    expect(payload.neutral_seconds_7d).toBe(0);
    expect(payload.focus_share).toBe(1);

    const byDay = Object.fromEntries(payload.daily_focus.map((point) => [point.day, point.focus]));
    expect(byDay[today]).toBe(3600);
    expect(byDay[midWeek]).toBe(1800);
    expect(byDay[start]).toBe(0);
  });

  it("returns a zeroed but well-formed payload for an empty window", () => {
    const today = todayIsoDate();
    const payload = buildFocusCardPayload([], { windowEndDay: today, startOfDayMinutes: 0, includeAiClassifications: false });

    expect(payload.focus_seconds_today).toBe(0);
    expect(payload.focus_seconds_7d).toBe(0);
    expect(payload.drift_seconds_7d).toBe(0);
    expect(payload.neutral_seconds_7d).toBe(0);
    expect(payload.focus_share).toBe(0);
    expect(payload.daily_focus).toHaveLength(7);
    expect(payload.daily_focus.every((point) => point.focus === 0)).toBe(true);
  });

  it("keeps focus_share within [0,1]", () => {
    const today = todayIsoDate();
    const payload = buildFocusCardPayload([makeSegment(today, 3600)], {
      windowEndDay: today,
      startOfDayMinutes: 0,
      includeAiClassifications: false,
    });
    expect(payload.focus_share).toBeGreaterThanOrEqual(0);
    expect(payload.focus_share).toBeLessThanOrEqual(1);
  });
});
