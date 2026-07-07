import { describe, expect, it } from "vitest";
import { buildContextualProjectBySegmentId, type ActivitySegment, type Project, type ProjectAssignmentRecord } from "@drifty/domain";
import { contextualProjectColorBySegment, NO_PROJECT_COLOR, projectColorBySegment, projectColorMap, projectFlowLegend } from "./projectFlowView";

function project(id: string, name: string, color: string): Project {
  return { id, name, description: "", color, status: "active", anchors: [], createdAt: "", updatedAt: "" };
}

function assignment(segmentId: string, projectId: string | null): ProjectAssignmentRecord {
  return { segmentId, projectId, source: "ai" };
}

const projects = [project("p1", "Drifty", "#111111"), project("p2", "Blog", "#222222"), project("p3", "Unused", "#333333")];

describe("projectColorBySegment", () => {
  it("colors assigned segments by project and unassigned/unknown gray", () => {
    const colors = projectColorMap(projects);
    const bySegment = projectColorBySegment(
      [assignment("1", "p1"), assignment("2", null), assignment("3", "ghost")],
      colors,
    );
    expect(bySegment.get("1")).toBe("#111111");
    expect(bySegment.get("2")).toBe(NO_PROJECT_COLOR);
    expect(bySegment.get("3")).toBe(NO_PROJECT_COLOR);
  });
});

describe("projectFlowLegend", () => {
  it("lists only projects that appear, then a gray No project entry", () => {
    const legend = projectFlowLegend(projects, [assignment("1", "p1"), assignment("2", null), assignment("3", "p2")]);
    expect(legend.map((entry) => entry.name)).toEqual(["Drifty", "Blog", "No project"]);
    expect(legend.find((entry) => entry.projectId === null)?.color).toBe(NO_PROJECT_COLOR);
    expect(legend.some((entry) => entry.name === "Unused")).toBe(false);
  });

  it("omits No project when everything is assigned", () => {
    const legend = projectFlowLegend(projects, [assignment("1", "p1")]);
    expect(legend.map((entry) => entry.name)).toEqual(["Drifty"]);
  });

  it("shows only No project when there are no assignments", () => {
    expect(projectFlowLegend(projects, [])).toEqual([{ projectId: null, name: "No project", color: NO_PROJECT_COLOR }]);
  });
});

function seg(id: string, startedAt: string, endedAt: string, durationSeconds: number): ActivitySegment {
  return { id, startedAt, endedAt, durationSeconds, appName: "Code", platform: "macos", source: "accessibility" };
}

describe("contextual project smoothing", () => {
  const segments = [
    seg("1", "2026-04-06T09:00:00+00:00", "2026-04-06T09:10:00+00:00", 600),
    seg("2", "2026-04-06T09:10:00+00:00", "2026-04-06T09:12:00+00:00", 120),
    seg("3", "2026-04-06T09:12:00+00:00", "2026-04-06T09:22:00+00:00", 600),
  ];

  it("fills a short unassigned gap dominated by one project", () => {
    const resolution = buildContextualProjectBySegmentId(
      segments,
      new Map([["1", "p1"], ["2", null], ["3", "p1"]]),
    );
    expect(resolution.get("1")).toEqual({ projectId: "p1", basis: "direct" });
    expect(resolution.get("2")).toEqual({ projectId: "p1", basis: "contextual" });
    expect(resolution.get("3")).toEqual({ projectId: "p1", basis: "direct" });
  });

  it("leaves an unassigned segment gray when no project dominates the window", () => {
    const resolution = buildContextualProjectBySegmentId(
      segments,
      new Map([["1", "p1"], ["2", null], ["3", "p2"]]),
    );
    // p1 and p3 each ~50% — neither reaches the strong-share threshold.
    expect(resolution.get("2")?.projectId).toBeNull();
  });

  it("never overrides a direct assignment", () => {
    const resolution = buildContextualProjectBySegmentId(
      segments,
      new Map([["1", "p1"], ["2", "p2"], ["3", "p1"]]),
    );
    expect(resolution.get("2")).toEqual({ projectId: "p2", basis: "direct" });
  });

  it("maps contextual fills to the project color for the flow chart", () => {
    const colors = projectColorMap([project("p1", "Drifty", "#112233")]);
    const bySegment = contextualProjectColorBySegment(segments, [assignment("1", "p1"), assignment("2", null), assignment("3", "p1")], colors);
    expect(bySegment.get("2")).toBe("#112233");
  });
});
