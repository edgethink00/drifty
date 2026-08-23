import { describe, expect, it } from "vitest";

import { DEV_SIGNALS_SAMPLE_DAY } from "./devSignalsSampleDay";
import {
  MINUTES_IN_DAY,
  formatHours,
  hasDevSignals,
  mergeForDisplay,
  mergeSpans,
  peakConcurrency,
  summarize,
} from "./devSignalsModel";

describe("dev signals model", () => {
  it("never reports more time than a day holds", () => {
    // Parallel agent sessions summed naively produced 33 hours in a 24-hour
    // day during development. Every displayed duration must survive this.
    const summary = summarize(DEV_SIGNALS_SAMPLE_DAY);
    expect(summary.agentMinutes).toBeLessThanOrEqual(MINUTES_IN_DAY);
    expect(summary.attentionMinutes).toBeLessThanOrEqual(MINUTES_IN_DAY);
    expect(summary.combinedMinutes).toBeLessThanOrEqual(MINUTES_IN_DAY);
  });

  it("keeps the combined figure below the naive sum", () => {
    const summary = summarize(DEV_SIGNALS_SAMPLE_DAY);
    expect(summary.combinedMinutes).toBeLessThan(summary.agentMinutes + summary.attentionMinutes);
  });

  it("splits agent time into attended and unattended without loss", () => {
    const summary = summarize(DEV_SIGNALS_SAMPLE_DAY);
    expect(summary.attendedMinutes + summary.unattendedMinutes).toBe(summary.agentMinutes);
  });

  it("reproduces the measured day that motivated the feature", () => {
    const summary = summarize(DEV_SIGNALS_SAMPLE_DAY);
    expect(formatHours(summary.agentMinutes)).toBe("11.7h");
    expect(formatHours(summary.attentionMinutes)).toBe("1.7h");
    expect(summary.unattendedMinutes).toBeGreaterThan(summary.attentionMinutes);
  });

  it("merges overlapping spans", () => {
    expect(mergeSpans([{ start: 0, end: 10 }, { start: 5, end: 20 }])).toEqual([{ start: 0, end: 20 }]);
  });

  it("ignores inverted and empty spans", () => {
    expect(mergeSpans([{ start: 10, end: 10 }, { start: 20, end: 5 }])).toEqual([]);
  });

  it("closes small gaps only for display", () => {
    const spans = [{ start: 0, end: 5 }, { start: 8, end: 12 }];
    expect(mergeForDisplay(spans, 6)).toEqual([{ start: 0, end: 12 }]);
    // The reported duration still comes from the unsmoothed merge.
    expect(mergeSpans(spans)).toHaveLength(2);
  });

  it("does not join spans separated by more than the gap", () => {
    expect(mergeForDisplay([{ start: 0, end: 5 }, { start: 60, end: 70 }], 6)).toHaveLength(2);
  });

  it("does not count a turn ending as another starts as concurrency", () => {
    expect(peakConcurrency([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toBe(1);
    expect(peakConcurrency([{ start: 0, end: 10 }, { start: 5, end: 20 }])).toBe(2);
  });

  it("hides the surface when there is nothing to show", () => {
    expect(hasDevSignals(null)).toBe(false);
    expect(hasDevSignals({ day: "x", attention: [], agentSpans: [], agentTurns: [], commits: [] })).toBe(false);
    expect(hasDevSignals(DEV_SIGNALS_SAMPLE_DAY)).toBe(true);
  });
});
