import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";

import { sumEndOfDayReviewTrackedSeconds } from "./endOfDayReviewData";

describe("end-of-day review readiness", () => {
  it("counts observed tracking but excludes estimated browser-history imports", () => {
    const observed = segment({ id: "observed", durationSeconds: 45 * 60, source: "nsworkspace" });
    const imported = segment({
      id: "imported",
      durationSeconds: 4 * 60 * 60,
      source: "browser-history-import",
      siteSource: "browser-history-import",
    });

    expect(sumEndOfDayReviewTrackedSeconds([observed, imported])).toBe(45 * 60);
  });

  it("does not count a historical failed Windows foreground capture as tracked time", () => {
    const observed = segment({ id: "observed", durationSeconds: 45 * 60, source: "win32-foreground", platform: "windows" });
    const failed = segment({
      id: "failed",
      durationSeconds: 4 * 60 * 60,
      source: "unknown",
      platform: "windows",
      appName: "Unavailable",
      bundleId: null,
    });

    expect(sumEndOfDayReviewTrackedSeconds([observed, failed])).toBe(45 * 60);
  });

  it("does not let malformed durations lower or instantly satisfy the observed total", () => {
    expect(sumEndOfDayReviewTrackedSeconds([
      segment({ id: "valid", durationSeconds: 60, source: "manual" }),
      segment({ id: "negative", durationSeconds: -30, source: "accessibility" }),
      segment({ id: "nan", durationSeconds: Number.NaN, source: "accessibility" }),
      segment({ id: "infinite", durationSeconds: Number.POSITIVE_INFINITY, source: "accessibility" }),
    ])).toBe(60);
  });
});

function segment(overrides: Partial<ActivitySegment> & Pick<ActivitySegment, "id" | "durationSeconds" | "source">): ActivitySegment {
  return {
    startedAt: "2026-08-23T00:00:00.000Z",
    endedAt: "2026-08-23T00:01:00.000Z",
    appName: "Code",
    platform: "macos",
    ...overrides,
  };
}
