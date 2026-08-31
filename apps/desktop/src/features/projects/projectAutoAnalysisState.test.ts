import { describe, expect, it } from "vitest";

import {
  aggregateProjectAutoAnalysisPhase,
  IDLE_PROJECT_AUTO_ANALYSIS,
  projectAutoAnalysisPhase,
  projectsAwaitingAutoAnalysis,
  resolveProjectAutoAnalysisAfterPass,
  setProjectAutoAnalysisPhase,
} from "./projectAutoAnalysisState";

describe("projectAutoAnalysisState", () => {
  it("treats an untracked project as idle", () => {
    expect(projectAutoAnalysisPhase(IDLE_PROJECT_AUTO_ANALYSIS, "p1")).toBe("idle");
  });

  it("keeps each project's phase independent", () => {
    const state = setProjectAutoAnalysisPhase(
      setProjectAutoAnalysisPhase(IDLE_PROJECT_AUTO_ANALYSIS, "p1", "error"),
      "p2",
      "running",
    );
    expect(projectAutoAnalysisPhase(state, "p1")).toBe("error");
    expect(projectAutoAnalysisPhase(state, "p2")).toBe("running");
  });

  it("lists only the projects that still owe the user a run", () => {
    const state = { p1: "complete", p2: "error", p3: "running", p4: "waiting_for_model" } as const;
    expect(projectsAwaitingAutoAnalysis(state)).toEqual(["p2"]);
  });

  it("surfaces the most active shared phase for the matching card", () => {
    expect(aggregateProjectAutoAnalysisPhase({ p1: "error", p2: "running" })).toBe("running");
    expect(aggregateProjectAutoAnalysisPhase({ p1: "error", p2: "queued" })).toBe("queued");
    expect(aggregateProjectAutoAnalysisPhase({ p1: "queued", p2: "running" })).toBe("running");
    expect(aggregateProjectAutoAnalysisPhase({ p1: "complete", p2: "error" })).toBe("error");
    expect(aggregateProjectAutoAnalysisPhase({ p1: "complete", p2: "waiting_for_model" })).toBe("waiting_for_model");
    expect(aggregateProjectAutoAnalysisPhase({ p1: "complete" })).toBe("idle");
    expect(aggregateProjectAutoAnalysisPhase(IDLE_PROJECT_AUTO_ANALYSIS)).toBe("idle");
  });

  it("clears earlier failures once a pass over the same window succeeds", () => {
    const next = resolveProjectAutoAnalysisAfterPass({ p1: "error", p2: "running" }, ["p2"], "complete");
    expect(next).toEqual({ p1: "complete", p2: "complete" });
  });

  it("keeps a project waiting for setup untouched when another pass succeeds", () => {
    const next = resolveProjectAutoAnalysisAfterPass({ p1: "waiting_for_model", p2: "running" }, ["p2"], "complete");
    expect(next).toEqual({ p1: "waiting_for_model", p2: "complete" });
  });

  it("marks the attempted projects as failed without rewriting unrelated ones", () => {
    const next = resolveProjectAutoAnalysisAfterPass({ p1: "complete", p2: "running" }, ["p2"], "error");
    expect(next).toEqual({ p1: "complete", p2: "error" });
  });
});
