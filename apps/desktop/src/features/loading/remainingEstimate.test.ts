import { describe, expect, it } from "vitest";

import {
  estimateRemainingMs,
  mergeRemainingMs,
  remainingLabel,
  sameRemainingLabel,
} from "./remainingEstimate";

describe("remaining estimate", () => {
  it("says nothing until the samples span enough time and progress", () => {
    expect(estimateRemainingMs([{ at: 0, value: 0.1 }])).toBeNull();
    expect(estimateRemainingMs([
      { at: 0, value: 0.1 },
      { at: 2_000, value: 0.4 },
    ])).toBeNull();
    expect(estimateRemainingMs([
      { at: 0, value: 0.1 },
      { at: 30_000, value: 0.105 },
    ])).toBeNull();
  });

  it("projects the rest of the work from observed throughput", () => {
    expect(estimateRemainingMs([
      { at: 0, value: 0.2 },
      { at: 10_000, value: 0.4 },
    ])).toBeCloseTo(30_000, 5);
  });

  it("stays silent when the projection is too far out to be a real expectation", () => {
    expect(estimateRemainingMs([
      { at: 0, value: 0 },
      { at: 60_000, value: 0.03 },
    ])).toBeNull();
  });

  it("ignores a reading that goes backwards, as a growing total can make it", () => {
    expect(estimateRemainingMs([
      { at: 0, value: 0.4 },
      { at: 20_000, value: 0.3 },
    ])).toBeNull();
  });

  it("refuses to grow the countdown over noise but accepts a genuine slowdown", () => {
    expect(mergeRemainingMs(null, 40_000)).toBe(40_000);
    expect(mergeRemainingMs(40_000, 48_000)).toBe(40_000);
    expect(mergeRemainingMs(40_000, 20_000)).toBe(20_000);
    expect(mergeRemainingMs(40_000, 200_000)).toBe(200_000);
    expect(mergeRemainingMs(40_000, null)).toBe(40_000);
  });

  it("reports coarse buckets rather than a countdown users can audit", () => {
    expect(remainingLabel(null)).toBeNull();
    expect(remainingLabel(9_000)).toEqual({ kind: "almost" });
    expect(remainingLabel(45_000)).toEqual({ kind: "underMinute" });
    expect(remainingLabel(100_000)).toEqual({ kind: "minutes", minutes: 2 });
    expect(remainingLabel(20 * 60_000)).toBeNull();
  });

  it("never claims almost done next to a number that disagrees with it", () => {
    // A fast connection really can finish in nine seconds from 45%, but saying
    // "almost done" there reads as a broken screen.
    expect(remainingLabel(9_000, 0.45)).toEqual({ kind: "underMinute" });
    expect(remainingLabel(9_000, 0.95)).toEqual({ kind: "almost" });
    // Longer buckets are unaffected; only the strongest claim is guarded.
    expect(remainingLabel(100_000, 0.1)).toEqual({ kind: "minutes", minutes: 2 });
  });

  it("treats equal buckets as the same label so the copy does not flicker", () => {
    expect(sameRemainingLabel({ kind: "minutes", minutes: 2 }, { kind: "minutes", minutes: 2 })).toBe(true);
    expect(sameRemainingLabel({ kind: "minutes", minutes: 2 }, { kind: "minutes", minutes: 3 })).toBe(false);
    expect(sameRemainingLabel(null, { kind: "almost" })).toBe(false);
    expect(sameRemainingLabel(null, null)).toBe(true);
  });
});
