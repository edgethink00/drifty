import { describe, expect, it } from "vitest";
import type { ProjectPassRun } from "@drifty/domain";
import { estimateProjectPassSpend, summarizeProjectPassCost } from "./projectPassCostModel";

function run(fields: Partial<ProjectPassRun> & Pick<ProjectPassRun, "id" | "ranAt">): ProjectPassRun {
  return { rangeStart: "", rangeEnd: "", trigger: "schedule", promptVersion: "pp-v1", ...fields };
}

describe("summarizeProjectPassCost", () => {
  const runs = [
    run({ id: 1, ranAt: "2026-04-06T23:00:00+00:00", trigger: "eod", tokensIn: 8000, tokensOut: 2000, assignmentsCount: 40, correctionsCount: 3 }),
    run({ id: 2, ranAt: "2026-04-06T12:00:00+00:00", trigger: "schedule", tokensIn: 4000, tokensOut: 1000, assignmentsCount: 20, correctionsCount: 1 }),
    run({ id: 3, ranAt: "2026-04-05T23:00:00+00:00", trigger: "manual", tokensIn: 6000, tokensOut: 1500 }),
  ];

  it("totals tokens, groups by day (newest first) and by trigger", () => {
    const summary = summarizeProjectPassCost(runs);
    expect(summary.totalPasses).toBe(3);
    expect(summary.totalTokensIn).toBe(18000);
    expect(summary.totalTokensOut).toBe(4500);
    expect(summary.byDay.map((bucket) => bucket.day)).toEqual(["2026-04-06", "2026-04-05"]);
    expect(summary.byDay[0]).toMatchObject({ passes: 2, tokensIn: 12000, assignments: 60, corrections: 4 });
    expect(summary.byTrigger).toEqual({ eod: 1, schedule: 1, manual: 1 });
  });

  it("leaves cost null without pricing and estimates when prices are given", () => {
    expect(summarizeProjectPassCost(runs).estimatedCostUsd).toBeNull();
    const priced = summarizeProjectPassCost(runs, { pricePerMTokIn: 0.25, pricePerMTokOut: 2 });
    // 18000/1e6*0.25 + 4500/1e6*2 = 0.0045 + 0.009 = 0.0135
    expect(priced.estimatedCostUsd).toBeCloseTo(0.0135, 6);
  });

  it("handles an empty history", () => {
    const summary = summarizeProjectPassCost([]);
    expect(summary).toMatchObject({ totalPasses: 0, totalTokensIn: 0, byDay: [], byTrigger: {} });
  });
});

describe("estimateProjectPassSpend", () => {
  it("prices per-run by the run's model and extrapolates a monthly figure per activity-day", () => {
    const spend = estimateProjectPassSpend([
      run({
        id: 1,
        ranAt: "2026-04-06T23:00:00+00:00",
        model: "openai/gpt-5-mini",
        rangeStart: "2026-03-30T00:00:00.000Z",
        rangeEnd: "2026-04-06T00:00:00.000Z",
        tokensIn: 8000,
        tokensOut: 2000,
      }),
    ]);
    // gpt-5-mini tier 0.25 in / 2.0 out: 8000/1e6*0.25 + 2000/1e6*2 = 0.002 + 0.004 = 0.006.
    expect(spend.totalUsd).toBeCloseTo(0.006, 6);
    expect(spend.models).toEqual(["openai/gpt-5-mini"]);
    // The range spans 7 activity-days → monthly = 0.006 / 7 * 30.
    expect(spend.monthlyUsd).toBeCloseTo((0.006 / 7) * 30, 6);
  });

  it("falls back to the default tier for unknown models and dedupes the model list", () => {
    const spend = estimateProjectPassSpend([
      run({ id: 1, ranAt: "t", model: "mystery/model", rangeStart: "2026-04-06T00:00:00.000Z", rangeEnd: "2026-04-07T00:00:00.000Z", tokensIn: 1_000_000, tokensOut: 0 }),
      run({ id: 2, ranAt: "t", model: "mystery/model", rangeStart: "2026-04-06T00:00:00.000Z", rangeEnd: "2026-04-07T00:00:00.000Z", tokensIn: 0, tokensOut: 1_000_000 }),
    ]);
    // Default tier 0.25 in / 2.0 out: 1M in → 0.25, 1M out → 2.0.
    expect(spend.totalUsd).toBeCloseTo(2.25, 6);
    expect(spend.models).toEqual(["mystery/model"]);
  });
});
