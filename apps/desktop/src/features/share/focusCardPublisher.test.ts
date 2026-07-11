import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shiftIsoDate, todayIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

import { buildFocusCardPayload } from "./focusCardPublisher";

// Safari on stackoverflow.com classifies as focus (mirrors leaderboardPublisher.test).
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

describe("buildFocusCardPayload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a 30-day daily series with week-scoped headline aggregates", () => {
    const today = todayIsoDate();
    const monthStart = shiftIsoDate(today, -29);
    const midWeek = shiftIsoDate(today, -3);
    const outsideWeek = shiftIsoDate(today, -20);

    const payload = buildFocusCardPayload(
      [makeSegment(today, 3600), makeSegment(midWeek, 1800), makeSegment(outsideWeek, 900)],
      { windowEndDay: today, startOfDayMinutes: 0, includeAiClassifications: false },
    );

    expect(payload.window_start_date).toBe(monthStart);
    expect(payload.window_end_date).toBe(today);
    expect(payload.daily_focus).toHaveLength(30);

    // Headline aggregates stay week-scoped: the 20-days-ago hour is excluded.
    expect(payload.focus_seconds_today).toBe(3600);
    expect(payload.focus_seconds_7d).toBe(5400);
    expect(payload.drift_seconds_7d).toBe(0);
    expect(payload.neutral_seconds_7d).toBe(0);
    expect(payload.focus_share).toBe(1);

    // ...but the daily series carries the full month.
    const byDay = Object.fromEntries(payload.daily_focus.map((point) => [point.day, point.focus]));
    expect(byDay[today]).toBe(3600);
    expect(byDay[midWeek]).toBe(1800);
    expect(byDay[outsideWeek]).toBe(900);
    expect(byDay[monthStart]).toBe(0);
  });

  it("returns a zeroed but well-formed payload for an empty window", () => {
    const today = todayIsoDate();
    const payload = buildFocusCardPayload([], { windowEndDay: today, startOfDayMinutes: 0, includeAiClassifications: false });

    expect(payload.focus_seconds_today).toBe(0);
    expect(payload.focus_seconds_7d).toBe(0);
    expect(payload.drift_seconds_7d).toBe(0);
    expect(payload.neutral_seconds_7d).toBe(0);
    expect(payload.focus_share).toBe(0);
    expect(payload.daily_focus).toHaveLength(30);
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

  // ── Detail opt-ins (embed detail levels) ──────────────────────────────────
  // Regression contract: with no flags, both public detail fields stay absent.
  // false flags — every detail FIELD stays absent, so nothing new is published by default.
  it("omits every detail field when no flags are set (regression: old behavior)", () => {
    const today = todayIsoDate();
    const payload = buildFocusCardPayload([makeSegment(today, 3600)], {
      windowEndDay: today,
      startOfDayMinutes: 0,
      includeAiClassifications: false,
    });

    expect(payload.share_category_breakdown).toBe(false);
    expect(payload.share_hourly_pattern).toBe(false);
    expect(payload).not.toHaveProperty("category_breakdown_7d");
    expect(payload).not.toHaveProperty("hourly_focus_pattern");
    expect(payload).not.toHaveProperty("top_apps_7d");
  });

  it("attaches only the detail whose flag is on", () => {
    const today = todayIsoDate();
    const base = { windowEndDay: today, startOfDayMinutes: 0, includeAiClassifications: false };
    const segments = [makeSegment(today, 3600)];

    const categoryOnly = buildFocusCardPayload(segments, { ...base, shareCategoryBreakdown: true });
    expect(categoryOnly.share_category_breakdown).toBe(true);
    expect(categoryOnly.category_breakdown_7d).toBeDefined();
    expect(categoryOnly).not.toHaveProperty("hourly_focus_pattern");
    expect(categoryOnly).not.toHaveProperty("top_apps_7d");

    const hourlyOnly = buildFocusCardPayload(segments, { ...base, shareHourlyPattern: true });
    expect(hourlyOnly.hourly_focus_pattern).toBeDefined();
    expect(hourlyOnly).not.toHaveProperty("category_breakdown_7d");
    expect(hourlyOnly).not.toHaveProperty("top_apps_7d");

    expect(categoryOnly).not.toHaveProperty("share_top_apps");
  });

  it("computes a week-scoped category breakdown with aggregate productivity detail", () => {
    const today = todayIsoDate();
    const midWeek = shiftIsoDate(today, -3);
    const outsideWeek = shiftIsoDate(today, -20);

    const payload = buildFocusCardPayload(
      [makeSegment(today, 3600), makeSegment(midWeek, 1800), makeSegment(outsideWeek, 900)],
      { windowEndDay: today, startOfDayMinutes: 0, includeAiClassifications: false, shareCategoryBreakdown: true },
    );

    const breakdown = payload.category_breakdown_7d ?? [];
    expect(breakdown.length).toBeGreaterThan(0);
    // Week-scoped: the 20-days-ago segment is excluded (5400 = 3600 + 1800).
    expect(breakdown.reduce((sum, entry) => sum + entry.seconds, 0)).toBe(5400);
    for (const entry of breakdown) {
      expect(Object.keys(entry).sort()).toEqual(["category", "driftSeconds", "focusSeconds", "neutralSeconds", "seconds"]);
      expect(entry.category).not.toBe("unknown");
      expect(entry.seconds).toBeGreaterThan(0);
      expect(entry.focusSeconds + entry.neutralSeconds + entry.driftSeconds).toBe(entry.seconds);
    }
    // Sorted largest-first.
    const seconds = breakdown.map((entry) => entry.seconds);
    expect([...seconds].sort((a, b) => b - a)).toEqual(seconds);
  });

  it("averages the hourly focus pattern per hour-of-day across the 7-day window", () => {
    const today = todayIsoDate();
    const midWeek = shiftIsoDate(today, -3);
    const outsideWeek = shiftIsoDate(today, -20);

    const payload = buildFocusCardPayload(
      // Both in-week segments start 09:00Z = 18:00 KST (tests run with TZ=Asia/Seoul):
      // today's fills 18:00–19:00 (3600s), mid-week's 18:00–18:30 (1800s).
      [makeSegment(today, 3600), makeSegment(midWeek, 1800), makeSegment(outsideWeek, 900)],
      { windowEndDay: today, startOfDayMinutes: 0, includeAiClassifications: false, shareHourlyPattern: true },
    );

    const pattern = payload.hourly_focus_pattern ?? [];
    expect(pattern).toHaveLength(24);
    expect(pattern.map((point) => point.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    // (3600 + 1800) / 7 days ≈ 771; the out-of-week hour contributes nothing.
    expect(pattern[18].focusSeconds).toBe(Math.round(5400 / 7));
    expect(pattern.filter((point) => point.hour !== 18).every((point) => point.focusSeconds === 0)).toBe(true);
    // Averages only — a 24-bucket rhythm can never encode per-day/session ordering.
    for (const point of pattern) {
      expect(Object.keys(point).sort()).toEqual(["focusSeconds", "hour"]);
    }
  });

  it("never includes app identity in the public focus-card payload", () => {
    const today = todayIsoDate();
    const payload = buildFocusCardPayload([makeSegment(today, 7200, "Xcode")], {
      windowEndDay: today,
      startOfDayMinutes: 0,
      includeAiClassifications: false,
      shareCategoryBreakdown: true,
    });

    expect(payload).not.toHaveProperty("share_top_apps");
    expect(payload).not.toHaveProperty("top_apps_7d");
    expect(JSON.stringify(payload)).not.toContain("Xcode");
  });
});
