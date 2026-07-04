import { describe, expect, it } from "vitest";
import {
  beginClassificationRun,
  endClassificationRun,
  getClassificationActivitySnapshot,
  reportClassificationRemaining,
  subscribeClassificationActivity,
  withClassificationActivity,
  type ClassificationActivityState,
} from "./classificationActivity";

describe("classificationActivity", () => {
  it("brackets a run: running is true during and idle after, with remaining taken from the summary", async () => {
    const states: ClassificationActivityState[] = [];
    const unsubscribe = subscribeClassificationActivity((state) => states.push(state));

    let runningDuringRun = false;
    await withClassificationActivity(
      async () => {
        runningDuringRun = getClassificationActivitySnapshot().running;
        return { metrics: { unclassifiedSegments: 5 } };
      },
      (result) => result.metrics.unclassifiedSegments,
    );
    unsubscribe();

    expect(runningDuringRun).toBe(true);
    // The remaining count surfaced while running, before the run settled back to idle.
    expect(states.some((state) => state.running && state.remaining === 5)).toBe(true);
    expect(getClassificationActivitySnapshot()).toEqual({ running: false, remaining: null });
  });

  it("stays running across nested runs until the outermost ends", () => {
    beginClassificationRun();
    expect(getClassificationActivitySnapshot().running).toBe(true);

    beginClassificationRun();
    endClassificationRun();
    // Inner run ended but the outer is still active.
    expect(getClassificationActivitySnapshot().running).toBe(true);

    endClassificationRun();
    expect(getClassificationActivitySnapshot()).toEqual({ running: false, remaining: null });
  });

  it("ignores remaining updates once idle", () => {
    reportClassificationRemaining(9);
    expect(getClassificationActivitySnapshot()).toEqual({ running: false, remaining: null });
  });
});
