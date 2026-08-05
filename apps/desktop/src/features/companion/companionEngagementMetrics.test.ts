// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPANION_ENGAGEMENT_METRICS_STORAGE_KEY,
  readCompanionEngagementMetrics,
  recordCompanionEngagementMetric,
} from "./companionEngagementMetrics";

describe("Companion local engagement metrics", () => {
  afterEach(() => window.localStorage.clear());

  it("stores aggregate counters without event payloads or activity context", () => {
    recordCompanionEngagementMetric("milestone_shown");
    recordCompanionEngagementMetric("milestone_shown");
    recordCompanionEngagementMetric("moment_auto_dismissed");

    expect(readCompanionEngagementMetrics()).toEqual({
      milestone_shown: 2,
      moment_auto_dismissed: 1,
    });
    expect(window.localStorage.getItem(COMPANION_ENGAGEMENT_METRICS_STORAGE_KEY)).not.toContain("VS Code");
  });

  it("ignores malformed or unbounded stored counters", () => {
    window.localStorage.setItem(COMPANION_ENGAGEMENT_METRICS_STORAGE_KEY, JSON.stringify({
      milestone_shown: -1,
      unknown_metric: 99,
      moment_dismissed: Number.MAX_SAFE_INTEGER + 10,
    }));

    expect(readCompanionEngagementMetrics()).toEqual({});
  });
});
