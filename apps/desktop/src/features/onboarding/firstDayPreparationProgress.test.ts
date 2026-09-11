import { describe, expect, it } from "vitest";

import {
  firstDayPreparationBand,
  firstDayPreparationIndeterminateHeadroom,
  firstDayPreparationTrackValue,
  normalizeFirstDayPreparationPlan,
} from "./firstDayPreparationProgress";

describe("first-day preparation track", () => {
  it("keeps the plan in gate order and folds in a phase the plan did not predict", () => {
    expect(normalizeFirstDayPreparationPlan(["classifying", "importing"], "downloading")).toEqual([
      "importing",
      "downloading",
      "classifying",
    ]);
  });

  it("falls back to the classifying phase when nothing is known yet", () => {
    expect(normalizeFirstDayPreparationPlan([], "ready")).toEqual(["classifying"]);
  });

  it("hands each phase a band that starts exactly where the previous one ended", () => {
    const plan = ["importing", "downloading", "classifying"] as const;
    const importing = firstDayPreparationBand(plan, "importing");
    const downloading = firstDayPreparationBand(plan, "downloading");
    const classifying = firstDayPreparationBand(plan, "classifying");

    expect(importing.start).toBe(0);
    expect(downloading.start).toBeCloseTo(importing.end, 10);
    expect(classifying.start).toBeCloseTo(downloading.end, 10);
    expect(classifying.end).toBe(1);
  });

  it("never restarts the track when the gate moves to the next phase", () => {
    const plan = ["importing", "classifying"] as const;
    const endOfImport = firstDayPreparationTrackValue(plan, "importing", 1);
    const startOfClassify = firstDayPreparationTrackValue(plan, "classifying", 0);

    expect(startOfClassify).toBeCloseTo(endOfImport, 10);
    expect(startOfClassify).toBeGreaterThan(0);
  });

  it("holds the floor its predecessors earned while a phase has nothing to measure", () => {
    const plan = ["importing", "classifying"] as const;
    expect(firstDayPreparationTrackValue(plan, "classifying", null))
      .toBeCloseTo(firstDayPreparationBand(plan, "classifying").start, 10);
  });

  it("clamps a phase progress report into its own band", () => {
    const plan = ["importing", "classifying"] as const;
    expect(firstDayPreparationTrackValue(plan, "importing", 4)).toBeCloseTo(
      firstDayPreparationBand(plan, "importing").end,
      10,
    );
    expect(firstDayPreparationTrackValue(plan, "ready", null)).toBe(1);
  });

  it("lets the never-measurable import phase creep further than phases that go determinate", () => {
    expect(firstDayPreparationIndeterminateHeadroom("importing"))
      .toBeGreaterThan(firstDayPreparationIndeterminateHeadroom("classifying"));
  });
});
