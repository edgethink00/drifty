import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildEndOfDayReviewDailySignals } from "../companion/endOfDayReviewModel";
import { buildDayPatternMetrics, SWITCH_MIN_STAY_SECONDS, streakBarHeight } from "./dayPatternMetrics";

const DAY = "2026-10-13";

type SegmentOptions = {
  readonly productivity?: "focus" | "drift" | "neutral" | null;
  readonly appName?: string;
  readonly siteDomain?: string;
  readonly seconds?: number;
};

/** `productivity: null` is an unlabeled tool that no rule or heuristic recognizes. */
function segment(id: string, start: string, minutes: number, options: SegmentOptions = {}): ActivitySegment {
  const startedAt = new Date(`${DAY}T${start}`);
  const seconds = options.seconds ?? minutes * 60;
  const productivity = options.productivity === undefined ? "focus" : options.productivity;
  const appName = options.appName ?? (productivity === null ? "Unlabeled Tool" : "Editor");
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + seconds * 1000).toISOString(),
    durationSeconds: seconds,
    appName,
    bundleId: `com.example.${appName.toLowerCase().replace(/\s+/gu, "-")}`,
    windowTitle: "Untitled",
    siteDomain: options.siteDomain,
    platform: "macos",
    source: "manual",
    classification: productivity === null ? null : {
      category: productivity === "drift" ? "entertainment" : productivity === "neutral" ? "utility" : "workspace",
      productivity,
      source: "manual",
      confidence: 1,
    },
  };
}

function localMs(time: string): number {
  return new Date(`${DAY}T${time}:00`).getTime();
}

describe("buildDayPatternMetrics", () => {
  it("keeps a focus run going across a short break and ends it after five minutes", () => {
    const metrics = buildDayPatternMetrics([
      segment("a", "10:00", 20),
      segment("slack", "10:20", 3, { productivity: "drift", appName: "Slack" }),
      segment("b", "10:23", 10),
      segment("c", "10:40", 15),
    ]);

    expect(metrics.focusRuns.map((run) => run.seconds / 60)).toEqual([30, 15]);
    expect(metrics.longestFocus).toMatchObject({ startMs: localMs("10:00"), endMs: localMs("10:33"), seconds: 30 * 60 });
  });

  it("reports the same Longest streak as the Day Review for the same day", () => {
    const segments = [
      segment("morning", "09:10", 25),
      segment("pending", "09:35", 4, { productivity: null }),
      segment("morning-2", "09:39", 12),
      segment("video", "11:00", 40, { productivity: "drift", appName: "Safari", siteDomain: "youtube.com" }),
      segment("afternoon", "14:10", 32),
      segment("afternoon-2", "14:44", 9),
    ];

    const metrics = buildDayPatternMetrics(segments);
    const review = buildEndOfDayReviewDailySignals(segments);

    expect(metrics.longestFocus?.seconds).toBe(41 * 60);
    expect(metrics.longestFocus?.seconds).toBe(review.longestFocusRunSeconds);
    expect(new Date(metrics.longestFocus?.startMs ?? 0).toISOString()).toBe(review.longestFocusRunStartedAt);
  });

  it("gives a tie to the earlier run", () => {
    const metrics = buildDayPatternMetrics([segment("first", "09:00", 20), segment("second", "13:00", 20)]);

    expect(metrics.longestFocus?.startMs).toBe(localMs("09:00"));
  });

  it("finds the longest drift run and the largest focus and drift sources", () => {
    const metrics = buildDayPatternMetrics([
      segment("code", "09:00", 50, { appName: "Cursor" }),
      segment("docs", "10:00", 30, { appName: "Safari", siteDomain: "developer.apple.com" }),
      segment("code-2", "11:00", 20, { appName: "Cursor" }),
      segment("feed", "21:40", 90, { productivity: "drift", appName: "Safari", siteDomain: "youtube.com" }),
      segment("chat", "23:20", 30, { productivity: "drift", appName: "Discord" }),
      segment("feed-2", "23:55", 20, { productivity: "drift", appName: "Safari", siteDomain: "youtube.com" }),
    ]);

    expect(metrics.topFocus).toMatchObject({ label: "Cursor", seconds: 70 * 60 });
    expect(metrics.topDrift).toMatchObject({ label: "youtube.com", seconds: 110 * 60 });
    expect(metrics.longestDrift).toMatchObject({ startMs: localMs("21:40"), seconds: 90 * 60 });
  });

  it("leaves unclassified time out of runs and sources but keeps it in tracked time", () => {
    const metrics = buildDayPatternMetrics([segment("pending", "09:00", 30, { productivity: null })]);

    expect(metrics.trackedSeconds).toBe(30 * 60);
    expect(metrics.classifiedSeconds).toBe(0);
    expect(metrics.longestFocus).toBeNull();
    expect(metrics.topFocus).toBeNull();
    expect(metrics.longestDrift).toBeNull();
  });

  it("counts moves between apps and sites, skipping pass-through visits", () => {
    const metrics = buildDayPatternMetrics([
      segment("code", "09:00", 20, { appName: "Cursor" }),
      segment("finder-blip", "09:20", 0, { appName: "Finder", seconds: SWITCH_MIN_STAY_SECONDS - 1 }),
      segment("code-again", "09:21", 10, { appName: "Cursor" }),
      segment("docs", "09:31", 9, { appName: "Safari", siteDomain: "www.Example.com" }),
      segment("docs-2", "09:40", 10, { appName: "Arc", siteDomain: "example.com" }),
      segment("chat", "09:50", 10, { productivity: "neutral", appName: "Slack" }),
    ]);

    // Cursor → example.com → Slack: the Finder blip and the second Cursor
    // segment do not count, and one site in two browsers is one visit.
    expect(metrics.switches?.count).toBe(2);
    expect(metrics.switches?.averageStaySeconds).toBeCloseTo((59 * 60) / 3, 5);
    expect(metrics.switches?.perHour).toBeCloseTo(2 / ((59 * 60 + 9) / 3600), 5);
  });

  it("combines same-site capture segments before ignoring visits under ten seconds", () => {
    const metrics = buildDayPatternMetrics([
      segment("code", "09:00", 10, { appName: "Cursor" }),
      segment("docs-title-a", "09:10:00", 0, { appName: "Safari", siteDomain: "docs.example", seconds: 6 }),
      segment("docs-title-b", "09:10:06", 0, { appName: "Arc", siteDomain: "docs.example", seconds: 6 }),
      segment("chat", "09:10:12", 10, { appName: "Slack" }),
    ]);

    expect(metrics.switches?.count).toBe(2);
    expect(metrics.switches?.averageStaySeconds).toBeCloseTo((20 * 60 + 12) / 3, 5);
  });

  it("bounds the streak axis by whole hours around the recorded activity", () => {
    const metrics = buildDayPatternMetrics([segment("early", "09:12", 10), segment("late", "22:40", 15)]);

    expect(metrics.span).toEqual({ startMs: localMs("09:00"), endMs: localMs("23:00") });
  });
});

describe("streakBarHeight", () => {
  it("grows with the run and reaches full height at 90 minutes", () => {
    expect(streakBarHeight(0, 32, 4)).toBe(4);
    expect(streakBarHeight(45 * 60, 32, 4)).toBe(18);
    expect(streakBarHeight(90 * 60, 32, 4)).toBe(32);
    expect(streakBarHeight(160 * 60, 32, 4)).toBe(32);
  });
});
