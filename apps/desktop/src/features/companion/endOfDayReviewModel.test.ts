import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  buildEndOfDayReviewDailySignals,
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
