// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  canEvaluateCompanionDailyFocus,
  COMPANION_DAILY_FOCUS_MILESTONES_STORAGE_KEY,
  evaluateCompanionDailyFocusMilestones,
  initializeCompanionDailyFocusMilestones,
  persistCompanionDailyFocusMilestones,
  readCompanionDailyFocusMilestones,
} from "./companionDailyFocusMilestones";

describe("Companion daily focus milestones", () => {
  afterEach(() => window.localStorage.clear());

  it("baselines an existing day without replaying stale celebrations", () => {
    const progress = initializeCompanionDailyFocusMilestones("2026-08-03", 4 * 60 * 60, null);

    expect(progress.celebrated).toEqual(["day1h", "day3h"]);
    expect(progress.observedFocusSeconds).toBe(4 * 60 * 60);
  });

  it("announces the 1-hour rung exactly when live focus crosses it", () => {
    const progress = initializeCompanionDailyFocusMilestones("2026-08-03", 59 * 60 + 59, null);
    const result = evaluateCompanionDailyFocusMilestones({
      progress,
      day: "2026-08-03",
      focusSecondsToday: 60 * 60,
      announce: true,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "companion-daily-focus:2026-08-03:day1h",
      milestoneKind: "total",
      tier: 1,
      title: "1 hour of focus today",
      statSeconds: 60 * 60,
    });
  });

  it("returns multiple distinct rungs in chronological order", () => {
    const progress = initializeCompanionDailyFocusMilestones("2026-08-03", 59 * 60, null);
    const result = evaluateCompanionDailyFocusMilestones({
      progress,
      day: "2026-08-03",
      focusSecondsToday: 3 * 60 * 60 + 1,
      announce: true,
    });

    expect(result.events.map((event) => event.title)).toEqual([
      "1 hour of focus today",
      "3 hours of focus today",
    ]);
  });

  it("uses the stronger celebration treatment for a full 8-hour day", () => {
    const progress = initializeCompanionDailyFocusMilestones("2026-08-03", 7 * 60 * 60 + 59 * 60, null);
    const result = evaluateCompanionDailyFocusMilestones({
      progress,
      day: "2026-08-03",
      focusSecondsToday: 8 * 60 * 60,
      announce: true,
    });

    expect(result.events).toEqual([
      expect.objectContaining({
        id: "companion-daily-focus:2026-08-03:day8h",
        tier: 2,
        title: "8 hours of focus today",
      }),
    ]);
  });

  it("consumes thresholds silently while announcements are muted", () => {
    const progress = initializeCompanionDailyFocusMilestones("2026-08-03", 59 * 60, null);
    const muted = evaluateCompanionDailyFocusMilestones({
      progress,
      day: "2026-08-03",
      focusSecondsToday: 61 * 60,
      announce: false,
    });
    const shownAgain = evaluateCompanionDailyFocusMilestones({
      progress: muted.progress,
      day: "2026-08-03",
      focusSecondsToday: 62 * 60,
      announce: true,
    });

    expect(muted.events).toEqual([]);
    expect(muted.progress.celebrated).toContain("day1h");
    expect(shownAgain.events).toEqual([]);
  });

  it("does not repeat a celebration after a classification correction", () => {
    const before = initializeCompanionDailyFocusMilestones("2026-08-03", 59 * 60, null);
    const crossed = evaluateCompanionDailyFocusMilestones({
      progress: before,
      day: "2026-08-03",
      focusSecondsToday: 61 * 60,
      announce: true,
    });
    const corrected = evaluateCompanionDailyFocusMilestones({
      progress: crossed.progress,
      day: "2026-08-03",
      focusSecondsToday: 58 * 60,
      announce: true,
    });
    const recrossed = evaluateCompanionDailyFocusMilestones({
      progress: corrected.progress,
      day: "2026-08-03",
      focusSecondsToday: 62 * 60,
      announce: true,
    });

    expect(crossed.events).toHaveLength(1);
    expect(recrossed.events).toEqual([]);
  });

  it("starts a new logical day quietly instead of replaying a rollover value", () => {
    const previousDay = initializeCompanionDailyFocusMilestones("2026-08-03", 2 * 60 * 60, null);
    const nextDay = evaluateCompanionDailyFocusMilestones({
      progress: previousDay,
      day: "2026-08-04",
      focusSecondsToday: 0,
      announce: true,
    });

    expect(nextDay.events).toEqual([]);
    expect(nextDay.progress).toEqual({
      day: "2026-08-04",
      observedFocusSeconds: 0,
      celebrated: [],
    });
  });

  it("persists only safe milestone ids and ignores corrupt storage", () => {
    const progress = initializeCompanionDailyFocusMilestones("2026-08-03", 60 * 60, null);
    persistCompanionDailyFocusMilestones(progress);
    expect(readCompanionDailyFocusMilestones()).toEqual({
      day: "2026-08-03",
      celebrated: ["day1h"],
    });

    window.localStorage.setItem(COMPANION_DAILY_FOCUS_MILESTONES_STORAGE_KEY, "{broken");
    expect(readCompanionDailyFocusMilestones()).toBeNull();
  });

  describe("canEvaluateCompanionDailyFocus", () => {
    const loadedToday = {
      loaded: true,
      blocked: false,
      viewingToday: true,
      segmentsLoadedDay: "2026-08-15",
      day: "2026-08-15",
    } as const;

    it("trusts the figure when the loaded segments belong to the evaluated day", () => {
      expect(canEvaluateCompanionDailyFocus(loadedToday)).toBe(true);
    });

    /* The wall-clock day flips the instant the logical day rolls over, while the
       loaded segments still describe the previous day until the refresh lands.
       Celebrating there reports yesterday's focus under today's date. */
    it("withholds the figure while the loaded day lags a rollover", () => {
      expect(canEvaluateCompanionDailyFocus({
        ...loadedToday,
        segmentsLoadedDay: "2026-08-14",
      })).toBe(false);
    });

    it("withholds the figure before any day has been loaded", () => {
      expect(canEvaluateCompanionDailyFocus({
        ...loadedToday,
        segmentsLoadedDay: null,
      })).toBe(false);
    });

    it("stays closed before the first load and while tracker access is blocked", () => {
      expect(canEvaluateCompanionDailyFocus({ ...loadedToday, loaded: false })).toBe(false);
      expect(canEvaluateCompanionDailyFocus({ ...loadedToday, blocked: true })).toBe(false);
    });

    /* Browsing history switches the snapshot to the today-pinned alarm segments,
       so the day's own progress must keep being evaluated. Gating on
       `segmentsLoadedDay` there would silence milestones for as long as the user
       reads an earlier day. */
    it("keeps evaluating today while the user browses an earlier day", () => {
      expect(canEvaluateCompanionDailyFocus({
        ...loadedToday,
        viewingToday: false,
        segmentsLoadedDay: "2026-08-10",
      })).toBe(true);
    });
  });
});
