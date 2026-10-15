import { describe, expect, it } from "vitest";
import { buildRollingFocusSeconds, type ActivitySegment } from "@drifty/domain";

function makeSegment(
  id: string,
  startedAt: string,
  endedAt: string,
  appName: string,
  extra: Partial<ActivitySegment> = {},
): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    appName,
    platform: "macos",
    source: "nsworkspace",
    ...extra,
  };
}

describe("buildRollingFocusSeconds", () => {
  it("clips midnight overlap to the requested local window", () => {
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "midnight",
          new Date(2026, 3, 5, 23, 30).toISOString(),
          new Date(2026, 3, 6, 0, 30).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "Developer docs" },
        ),
      ],
      "2026-04-06",
      "2026-04-06",
    );

    expect(total).toBe(1800);
  });

  it("includes today and the previous six local dates", () => {
    const segments = Array.from({ length: 8 }, (_, offset) =>
        makeSegment(
          `day-${offset}`,
          new Date(2026, 3, 5 + offset, 10, 0).toISOString(),
          new Date(2026, 3, 5 + offset, 10, 10).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "Developer docs" },
        ),
    );

    const total = buildRollingFocusSeconds(segments, "2026-04-06", "2026-04-12");

    expect(total).toBe(7 * 600);
  });

  it("uses a 4am start boundary for local leaderboard windows", () => {
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "early-morning-previous-logical-day",
          new Date(2026, 3, 7, 3, 30).toISOString(),
          new Date(2026, 3, 7, 4, 30).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "Developer docs" },
        ),
      ],
      "2026-04-06",
      "2026-04-06",
      undefined,
      4 * 60,
    );

    expect(total).toBe(30 * 60);
  });

  it("counts only focus-labeled categories", () => {
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "learning-app",
          new Date(2026, 3, 6, 9, 0).toISOString(),
          new Date(2026, 3, 6, 9, 20).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "Developer guide" },
        ),
        makeSegment(
          "learning",
          new Date(2026, 3, 6, 10, 0).toISOString(),
          new Date(2026, 3, 6, 10, 30).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "TypeScript docs" },
        ),
        makeSegment(
          "communication",
          new Date(2026, 3, 6, 11, 0).toISOString(),
          new Date(2026, 3, 6, 11, 15).toISOString(),
          "Mail",
        ),
        makeSegment(
          "drift",
          new Date(2026, 3, 6, 12, 0).toISOString(),
          new Date(2026, 3, 6, 12, 25).toISOString(),
          "Safari",
          { siteDomain: "youtube.com", siteTitle: "YouTube" },
        ),
      ],
      "2026-04-06",
      "2026-04-06",
    );

    expect(total).toBe(50 * 60);
  });

  it("does not count unknown uncaptured activity as focus", () => {
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "unknown",
          new Date(2026, 3, 6, 13, 0).toISOString(),
          new Date(2026, 3, 6, 13, 20).toISOString(),
          "Unknown",
        ),
      ],
      "2026-04-06",
      "2026-04-06",
    );

    expect(total).toBe(0);
  });

  it("works with fewer than seven days of input", () => {
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "first",
          new Date(2026, 3, 6, 8, 0).toISOString(),
          new Date(2026, 3, 6, 8, 15).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "Developer docs" },
        ),
        makeSegment(
          "second",
          new Date(2026, 3, 8, 8, 0).toISOString(),
          new Date(2026, 3, 8, 8, 20).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "Docs" },
        ),
      ],
      "2026-04-06",
      "2026-04-12",
    );

    expect(total).toBe(35 * 60);
  });

  it("counts a segment that stays within the local day", () => {
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "dst",
          new Date(2026, 2, 8, 1, 30).toISOString(),
          new Date(2026, 2, 8, 3, 30).toISOString(),
          "Safari",
          { siteDomain: "stackoverflow.com", siteTitle: "Developer docs" },
        ),
      ],
      "2026-03-08",
      "2026-03-08",
    );

    expect(total).toBe(7200);
  });

  it("preserves recorded focus time for a point segment", () => {
    const capturedAt = new Date(2026, 3, 6, 14, 0).toISOString();
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "single-sample",
          capturedAt,
          capturedAt,
          "Safari",
          {
            durationSeconds: 5,
            siteDomain: "stackoverflow.com",
            siteTitle: "Developer docs",
          },
        ),
      ],
      "2026-04-06",
      "2026-04-06",
    );

    expect(total).toBe(5);
  });

  it("does not move a point segment into a different leaderboard day", () => {
    const capturedAt = new Date(2026, 3, 7, 0, 0).toISOString();
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "next-day-sample",
          capturedAt,
          capturedAt,
          "Safari",
          {
            durationSeconds: 5,
            siteDomain: "stackoverflow.com",
            siteTitle: "Developer docs",
          },
        ),
      ],
      "2026-04-06",
      "2026-04-06",
    );

    expect(total).toBe(0);
  });

  it("preserves sparse recorded focus instead of filling its timestamp span", () => {
    const total = buildRollingFocusSeconds(
      [
        makeSegment(
          "ordinary",
          new Date(2026, 3, 6, 15, 0).toISOString(),
          new Date(2026, 3, 6, 15, 10).toISOString(),
          "Safari",
          {
            durationSeconds: 5,
            siteDomain: "stackoverflow.com",
            siteTitle: "Developer docs",
          },
        ),
      ],
      "2026-04-06",
      "2026-04-06",
    );

    expect(total).toBe(5);
  });
});
