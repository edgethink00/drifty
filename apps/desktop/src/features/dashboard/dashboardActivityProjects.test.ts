import { describe, expect, it } from "vitest";
import type {
  ActivitySegment,
  ProjectAssignmentRecord,
  ProjectWindowAssignmentRecord,
} from "@drifty/domain";
import {
  buildDashboardProjectBySegmentId,
  summarizeDashboardActivityProject,
} from "./dashboardActivityProjects";

function segment(id: string, durationSeconds = 360): ActivitySegment {
  return {
    id,
    startedAt: "2026-09-02T00:00:00.000Z",
    endedAt: "2026-09-02T00:06:00.000Z",
    durationSeconds,
    appName: "Figma",
    platform: "macos",
    source: "accessibility",
  };
}

function windowAssignment(
  id: string,
  segmentId: string,
  projectId: string | null,
  durationSeconds: number,
  startedAt: string,
): ProjectWindowAssignmentRecord {
  return {
    windowId: id,
    windowStartedAt: startedAt,
    windowEndedAt: new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString(),
    durationSeconds,
    segmentOverlaps: [{ segmentId, durationSeconds }],
    projectId,
    teamProjectId: null,
    source: "ai",
  };
}

describe("buildDashboardProjectBySegmentId", () => {
  it("uses the dominant AI window and lets the later window win an exact tie", () => {
    const source = segment("segment-a");
    const result = buildDashboardProjectBySegmentId(
      [source],
      [],
      [
        windowAssignment("w1", source.id, "project-a", 180, "2026-09-02T00:00:00.000Z"),
        windowAssignment("w2", source.id, "project-b", 180, "2026-09-02T00:03:00.000Z"),
      ],
    );

    expect(result.get(source.id)).toBe("project-b");
  });

  it("lets an explicit manual No project choice override all AI windows", () => {
    const source = segment("segment-a");
    const manual: ProjectAssignmentRecord = {
      segmentId: source.id,
      projectId: null,
      source: "manual",
      assignedAt: "2026-09-02T01:00:00.000Z",
    };
    const result = buildDashboardProjectBySegmentId(
      [source],
      [manual],
      [windowAssignment("w1", source.id, "project-a", 360, source.startedAt)],
    );

    expect(result.has(source.id)).toBe(true);
    expect(result.get(source.id)).toBeNull();
  });

  it("weights uncovered duration with the legacy assignment", () => {
    const source = segment("segment-a", 600);
    const legacy: ProjectAssignmentRecord = { segmentId: source.id, projectId: "legacy", source: "ai" };
    const result = buildDashboardProjectBySegmentId(
      [source],
      [legacy],
      [windowAssignment("w1", source.id, "window", 180, source.startedAt)],
    );

    expect(result.get(source.id)).toBe("legacy");
  });
});

describe("summarizeDashboardActivityProject", () => {
  it("reports a duration-weighted dominant project and mixed state", () => {
    const segments = [segment("long", 600), segment("short", 120)];
    const byId = new Map(segments.map((item) => [item.id, item]));
    const summary = summarizeDashboardActivityProject(
      ["short", "long"],
      byId,
      new Map([["short", null], ["long", "project-a"]]),
    );

    expect(summary).toEqual({ projectId: "project-a", hasMixedProject: true });
  });
});
