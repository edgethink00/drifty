import { aggregateDeviceElapsedTime } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  buildEndOfDayReviewDailySignals,
  buildEndOfDayReviewComparison,
  buildEndOfDayReviewSummary,
  type EndOfDayReviewEvent,
} from "./endOfDayReviewModel";

const reviewDay = "2026-04-06";
const generatedAt = "2026-04-06T23:58:00.000Z";

function buildSegment({
  id,
  appName,
  startHour,
  durationMinutes,
  category,
  productivity,
  siteDomain = null,
  siteTitle = null,
  bundleId = `com.example.${id}`,
}: {
  id: string;
  appName: string;
  startHour: number;
  durationMinutes: number;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  siteDomain?: string | null;
  siteTitle?: string | null;
  bundleId?: string;
}): ActivitySegment {
  const startedAt = new Date(Date.UTC(2026, 3, 6, startHour, 0, 0, 0));
  const endedAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: durationMinutes * 60,
    appName,
    bundleId,
    windowTitle: siteTitle ?? `${appName} window`,
    siteDomain,
    siteTitle,
    siteUrl: siteDomain ? `https://${siteDomain}/work` : null,
    platform: "macos",
    source: "accessibility",
    classification: {
      category,
      productivity,
      source: "manual",
      confidence: 1,
      reason: "Deterministic end-of-day review fixture",
    },
  };
}

function buildReviewEvent(segments: ActivitySegment[]): EndOfDayReviewEvent {
  return buildEndOfDayReviewSummary({
    day: reviewDay,
    generatedAt,
    segments,
  });
}

/** A segment on a local wall-clock hour of the given day, so day boundaries follow the test machine. */
function localSegment(day: string, startHour: number, minutes: number, productivity: ProductivityLabel, imported = false): ActivitySegment {
  const startedAt = new Date(day + "T" + String(startHour).padStart(2, "0") + ":00:00");
  return {
    id: day + "-" + startHour + "-" + productivity,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    appName: "Code",
    bundleId: "com.example.code",
    windowTitle: "work",
    platform: "macos",
    source: imported ? "browser-history-import" : "accessibility",
    classification: {
      category: productivity === "drift" ? "entertainment" : productivity === "focus" ? "workspace" : "utility",
      productivity,
      source: "manual",
      confidence: 1,
    },
  };
}

describe("buildEndOfDayReviewComparison", () => {
  const today = "2026-04-07";
  const yesterday = "2026-04-06";
  const at8pm = new Date(today + "T20:00:00").toISOString();

  it("compares with yesterday only up to the same time of day", () => {
    const comparison = buildEndOfDayReviewComparison({
      day: today,
      generatedAt: at8pm,
      previousDaySegments: [
        localSegment(yesterday, 9, 180, "focus"),
        localSegment(yesterday, 19, 120, "drift"), // only 19:00-20:00 counts at 8 PM
        localSegment(yesterday, 21, 60, "focus"), // after 8 PM: not yet comparable
      ],
      current: { focusSeconds: 4 * 3600, driftSeconds: 30 * 60, neutralSeconds: 0 },
    });
    expect(comparison).toEqual({ focusDeltaSeconds: 3600, driftDeltaSeconds: -30 * 60, otherDeltaSeconds: 0, scope: "sameTime" });
  });

  it("compares whole days for a catch-up review of a finished day", () => {
    const nextMorning = new Date("2026-04-08T08:00:00").toISOString();
    const comparison = buildEndOfDayReviewComparison({
      day: today,
      generatedAt: nextMorning,
      previousDaySegments: [localSegment(yesterday, 9, 180, "focus"), localSegment(yesterday, 21, 60, "focus")],
      current: { focusSeconds: 4 * 3600, driftSeconds: 0, neutralSeconds: 0 },
    });
    expect(comparison?.focusDeltaSeconds).toBe(0);
    expect(comparison?.scope).toBe("wholeDay");
  });

  it("skips a yesterday Drifty did not watch long enough, counting imported history as unwatched", () => {
    const current = { focusSeconds: 3600, driftSeconds: 0, neutralSeconds: 0 };
    expect(buildEndOfDayReviewComparison({ day: today, generatedAt: at8pm, current, previousDaySegments: [localSegment(yesterday, 9, 170, "focus")] })).toBeUndefined();
    expect(buildEndOfDayReviewComparison({
      day: today,
      generatedAt: at8pm,
      current,
      previousDaySegments: [localSegment(yesterday, 9, 120, "focus"), localSegment(yesterday, 13, 240, "focus", true)],
    })).toBeUndefined();
    // A live review without the previous day keeps the rows off.
    expect(buildEndOfDayReviewSummary({ day: today, generatedAt: at8pm, segments: [localSegment(today, 9, 240, "focus")] }).comparison).toBeUndefined();
    expect(buildEndOfDayReviewSummary({
      day: today,
      generatedAt: at8pm,
      segments: [localSegment(today, 9, 240, "focus")],
      previousDaySegments: [localSegment(yesterday, 9, 180, "focus")],
    }).comparison).toEqual({ focusDeltaSeconds: 3600, driftDeltaSeconds: 0, otherDeltaSeconds: 0, scope: "sameTime" });
  });
});

describe("buildEndOfDayReviewDailySignals", () => {
  it("does not turn unclassified known-app time into focus while AI is unavailable", () => {
    const segment = {
      ...buildSegment({
        id: "unclassified-xcode",
        appName: "Xcode",
        bundleId: "com.apple.dt.Xcode",
        startHour: 9,
        durationMinutes: 60,
        category: "workspace",
        productivity: "focus",
      }),
      classification: undefined,
    };
    const summary = buildEndOfDayReviewSummary({
      day: reviewDay,
      generatedAt,
      segments: [segment],
      classificationOptions: {
        includeBuiltInHeuristics: false,
        builtInHeuristicsUnavailableSince: "2026-04-06T00:00:00.000Z",
      },
    });

    expect(summary.focusSeconds).toBe(0);
    expect(summary.driftSeconds).toBe(0);
    expect(summary.neutralSeconds).toBe(0);
    expect(summary.unclassifiedSeconds).toBe(60 * 60);
    expect(summary.categorySummaries).toEqual([
      expect.objectContaining({ label: "Unknown", durationSeconds: 60 * 60 }),
    ]);

  });

  it("derives deep runs and the strongest focus hour from local segments", () => {
    const signals = buildEndOfDayReviewDailySignals([
      buildSegment({
        id: "morning-focus",
        appName: "Code",
        startHour: 9,
        durationMinutes: 90,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "afternoon-focus",
        appName: "Figma",
        startHour: 14,
        durationMinutes: 30,
        category: "workspace",
        productivity: "focus",
      }),
    ]);

    expect(signals.deepSessionCount).toBe(1);
    expect(signals.longestFocusRunSeconds).toBe(90 * 60);
    expect(signals.longestFocusRunStartedAt).toBe(new Date(Date.UTC(2026, 3, 6, 9)).toISOString());
    const localPeakHour = String(new Date(Date.UTC(2026, 3, 6, 9)).getHours()).padStart(2, "0");
    expect(signals.peakHourLabel).toBe(`${localPeakHour}:00`);
    expect(signals.peakHourFocusSeconds).toBe(60 * 60);
  });

  it("keeps the reviewed cross-day rows in the deterministic Dev preview", () => {
    const preview = buildEndOfDayReviewSummary({
      day: reviewDay,
      generatedAt,
      segments: [],
      isMock: true,
    });

    expect(preview.highlightLabel).toBe("#2 of 14 · 8 PM");
    expect(preview.leaderboardCelebration).toMatchObject({
      period: "daily",
      rank: 2,
      participantCount: 14,
      windowEndDay: reviewDay,
    });
    expect(preview.comparison).toEqual({
      focusDeltaSeconds: 38 * 60,
      driftDeltaSeconds: -9 * 60,
      otherDeltaSeconds: 5 * 60,
    });
    expect(preview.dailySignals).toEqual({
      deepSessionCount: 0,
      longestFocusRunSeconds: 0,
      longestFocusRunStartedAt: null,
      peakHourLabel: null,
      peakHourFocusSeconds: 0,
    });
  });

  it("withholds comparison, signals, and leaderboard celebration from a pending assessment", () => {
    const pending = buildEndOfDayReviewSummary({
      day: reviewDay,
      generatedAt,
      segments: [buildSegment({
        id: "pending-review",
        appName: "Code",
        startHour: 9,
        durationMinutes: 180,
        category: "workspace",
        productivity: "focus",
      })],
      isMock: true,
      assessment: {
        state: "pending",
        route: "local",
        reason: "provider_disconnected",
        recoveryAction: "retry",
      },
    });

    expect(pending.assessment?.state).toBe("pending");
    expect(pending.highlightLabel).toBeUndefined();
    expect(pending.comparison).toBeUndefined();
    expect(pending.dailySignals).toBeUndefined();
    expect(pending.leaderboardCelebration).toBeUndefined();
  });
});


describe("Day Review device allocations", () => {
  it("uses one elapsed budget for totals, categories, sources, runs, and hourly signals", () => {
    const local = localSegment(reviewDay, 9, 120, "focus");
    const records = [local, { ...local, id: "pc", deviceId: "pc", platform: "windows" as const }];
    const original = JSON.stringify(records);
    const event = buildReviewEvent(records);
    expect(event).toMatchObject({
      totalSeconds: 7200, focusSeconds: 7200, unclassifiedSeconds: 0,
      dailySignals: { longestFocusRunSeconds: 7200, peakHourFocusSeconds: 3600, deepSessionCount: 1 },
    });
    expect(event.categorySummaries).toEqual([expect.objectContaining({ durationSeconds: 7200, percent: 100 })]);
    expect(event.sourceSummaries).toEqual([expect.objectContaining({ durationSeconds: 7200, percent: 100 })]);
    expect(buildReviewEvent(aggregateDeviceElapsedTime(records))).toEqual(event);
    expect(JSON.stringify(records)).toBe(original);
  });

  it("clips yesterday's exact device allocation instead of scaling its whole-day share", () => {
    const records = [localSegment(reviewDay, 9, 240, "focus"), { ...localSegment(reviewDay, 11, 120, "focus"), id: "pc", deviceId: "pc" }];
    const compare = (previousDaySegments: ActivitySegment[]) => buildEndOfDayReviewComparison({
      day: "2026-04-07", generatedAt: new Date("2026-04-07T12:00:00").toISOString(),
      previousDaySegments, current: { focusSeconds: 10800, driftSeconds: 0, neutralSeconds: 0 },
    });
    expect(compare(records)).toEqual({ focusDeltaSeconds: 0, driftDeltaSeconds: 0, otherDeltaSeconds: 0, scope: "sameTime" });
    expect(compare(aggregateDeviceElapsedTime(records))).toEqual(compare(records));
    const thin = records.map((record) => ({ ...record, startedAt: records[1].startedAt, durationSeconds: 7200 }));
    expect(compare(thin)).toBeUndefined();
  });
});


describe("Day Review logical day boundaries", () => {
  it("clips totals, source rows and the longest run to the reviewed day", () => {
    const record = localSegment("2026-10-15", 1, 240, "focus");
    const event = buildEndOfDayReviewSummary({ day: "2026-10-15", generatedAt: new Date("2026-10-15T20:00:00").toISOString(), startOfDayMinutes: 240,
      segments: [record, { ...record, id: "remote", deviceId: "pc" }] });
    expect(event).toMatchObject({ totalSeconds: 3600, focusSeconds: 3600, unclassifiedSeconds: 0,
      dailySignals: { longestFocusRunSeconds: 3600, longestFocusRunStartedAt: new Date("2026-10-15T04:00:00").toISOString(), peakHourLabel: "04:00", peakHourFocusSeconds: 3600 } });
    expect(event.sourceSummaries?.[0]).toMatchObject({ durationSeconds: 3600, percent: 100 });
    expect(event.categorySummaries?.[0]).toMatchObject({ durationSeconds: 3600, percent: 100 });
  });

  it("does not let another day's time satisfy yesterday's observed-time bar", () => {
    expect(buildEndOfDayReviewComparison({ day: "2026-10-16", generatedAt: new Date("2026-10-16T20:00:00").toISOString(), startOfDayMinutes: 240,
      previousDaySegments: [localSegment("2026-10-15", 1, 240, "focus"), localSegment("2026-10-14", 9, 240, "focus")],
      current: { focusSeconds: 3600, driftSeconds: 0, neutralSeconds: 0 } })).toBeUndefined();
  });
});
