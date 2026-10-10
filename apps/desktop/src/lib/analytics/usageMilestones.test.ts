import { describe, expect, it } from "vitest";
import {
  evaluateUsageMilestones,
  isMeasuring,
  readUsageMilestoneState,
  writeUsageMilestoneState,
  type UsageMilestoneState,
} from "./usageMilestones";

const HOUR = 3_600;
const START = new Date("2026-10-10T09:00:00.000Z");
const daysLater = (days: number) => new Date(START.getTime() + days * 86_400_000);

describe("usage milestones", () => {
  it("measures a new install and reports each milestone once with its day bucket", () => {
    const first = evaluateUsageMilestones(null, 0.5 * HOUR, START);
    expect(first.events).toEqual([]);
    expect(first.state).toMatchObject({ startedAt: START.toISOString(), reported: [], closed: false });

    const tenHours = evaluateUsageMilestones(first.state, 12 * HOUR, daysLater(3));
    expect(tenHours.events).toEqual([{ milestone: "tracked_10h", days_since_start_bucket: "0_7" }]);

    const again = evaluateUsageMilestones(tenHours.state, 14 * HOUR, daysLater(4));
    expect(again.events).toEqual([]);

    const thirtyHours = evaluateUsageMilestones(again.state, 31 * HOUR, daysLater(11));
    expect(thirtyHours.events).toEqual([{ milestone: "tracked_30h", days_since_start_bucket: "8_14" }]);
    expect(isMeasuring(thirtyHours.state)).toBe(false);
  });

  it("reports both milestones together when one check crosses both", () => {
    const start = evaluateUsageMilestones(null, 0, START).state;
    expect(evaluateUsageMilestones(start, 40 * HOUR, daysLater(20)).events).toEqual([
      { milestone: "tracked_10h", days_since_start_bucket: "15_30" },
      { milestone: "tracked_30h", days_since_start_bucket: "15_30" },
    ]);
  });

  it("never reports for an install that already had hours of history", () => {
    const existing = evaluateUsageMilestones(null, 50 * HOUR, START);
    expect(existing.events).toEqual([]);
    expect(existing.state.closed).toBe(true);
    expect(isMeasuring(existing.state)).toBe(false);
    expect(evaluateUsageMilestones(existing.state, 80 * HOUR, daysLater(1)).events).toEqual([]);
  });

  it("stops measuring after 90 days without reporting late milestones", () => {
    const start = evaluateUsageMilestones(null, 0, START).state;
    const late = evaluateUsageMilestones(start, 31 * HOUR, daysLater(91));
    expect(late.events).toEqual([]);
    expect(late.state.closed).toBe(true);
    expect(evaluateUsageMilestones(start, 31 * HOUR, daysLater(75)).events.map((event) => event.days_since_start_bucket))
      .toEqual(["61_90", "61_90"]);
  });

  it("round-trips its state and ignores anything unrecognised", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
    const state: UsageMilestoneState = { version: 1, startedAt: START.toISOString(), reported: ["tracked_10h"], closed: false };
    writeUsageMilestoneState(state, storage);
    expect(readUsageMilestoneState(storage)).toEqual(state);

    values.set("drifty.analytics.usageMilestones.v1", JSON.stringify({ ...state, reported: ["tracked_10h", "tracked_99h"] }));
    expect(readUsageMilestoneState(storage)?.reported).toEqual(["tracked_10h"]);
    values.set("drifty.analytics.usageMilestones.v1", "{not json");
    expect(readUsageMilestoneState(storage)).toBeNull();
  });
});
