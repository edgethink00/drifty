import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import {
  COMPANION_MOMENT_STALE_AFTER_MS,
  companionMomentReferenceMs,
  isCompanionMomentStale,
} from "./companionMomentFreshness";
import {
  END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS,
  buildMockPendingEndOfDayReviewSegments,
  sumEndOfDayReviewTrackedSeconds,
} from "./endOfDayReviewData";

describe("companion moment freshness", () => {
  const NOW = Date.parse("2026-08-18T12:00:00.000Z");

  it("reads generatedAt, falls back to returnedAt, and tolerates missing timestamps", () => {
    expect(companionMomentReferenceMs({ generatedAt: "2026-08-18T11:59:00.000Z" }))
      .toBe(Date.parse("2026-08-18T11:59:00.000Z"));
    expect(companionMomentReferenceMs({ returnedAt: "2026-08-18T11:58:00.000Z" }))
      .toBe(Date.parse("2026-08-18T11:58:00.000Z"));
    expect(companionMomentReferenceMs({})).toBeNull();
    expect(companionMomentReferenceMs({ generatedAt: "not-a-date" })).toBeNull();
  });

  it("marks moments older than the stale window as consumed, fresh ones as alive", () => {
    const fresh = { generatedAt: new Date(NOW - 5 * 60 * 1000).toISOString() };
    const stale = { generatedAt: new Date(NOW - COMPANION_MOMENT_STALE_AFTER_MS - 1).toISOString() };
    expect(isCompanionMomentStale(fresh, NOW)).toBe(false);
    expect(isCompanionMomentStale(stale, NOW)).toBe(true);
    // No timestamp means nothing to expire; producers without one behave as before.
    expect(isCompanionMomentStale({}, NOW)).toBe(false);
  });
});

describe("end-of-day review minimum tracked time", () => {
  it("requires three hours of tracked time so thin days never produce a review", () => {
    expect(END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS).toBe(3 * 60 * 60);
  });

  it("sums clamped segment durations as the day total", () => {
    const segments = [
      segment(3_600),
      segment(7_200),
      segment(-30),
    ];
    expect(sumEndOfDayReviewTrackedSeconds(segments)).toBe(10_800);
    expect(sumEndOfDayReviewTrackedSeconds([])).toBe(0);
  });

  it("keeps the afternoon mock activity raw after the 14:20 AI cutoff", () => {
    const segments = buildMockPendingEndOfDayReviewSegments("2026-09-04");
    const cutoff = new Date("2026-09-04T14:20:00").getTime();
    const beforeCutoff = segments.filter((item) => new Date(item.startedAt).getTime() < cutoff);
    const afterCutoff = segments.filter((item) => new Date(item.startedAt).getTime() >= cutoff);

    expect(beforeCutoff.every((item) => item.classification)).toBe(true);
    expect(afterCutoff.every((item) => !item.classification)).toBe(true);
    expect(sumEndOfDayReviewTrackedSeconds(segments)).toBeGreaterThan(END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS);
  });
});

function segment(durationSeconds: number): ActivitySegment {
  return {
    id: `s-${durationSeconds}`,
    startedAt: "2026-08-18T00:00:00.000Z",
    endedAt: "2026-08-18T01:00:00.000Z",
    durationSeconds,
    appName: "Example",
    platform: "macos",
    source: "accessibility",
  };
}
