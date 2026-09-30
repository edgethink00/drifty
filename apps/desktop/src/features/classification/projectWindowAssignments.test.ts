import { describe, expect, it } from "vitest";
import {
  buildFlowBlocks,
  buildPersonalProjectSliceProjection,
  type ActivitySegment,
  type ProjectAssignmentRecord,
  type ProjectWindowAssignmentRecord,
} from "@drifty/domain";

const source: ActivitySegment = {
  id: "segment-1",
  startedAt: "2026-07-28T09:00:00.000Z",
  endedAt: "2026-07-28T09:06:00.000Z",
  durationSeconds: 360,
  appName: "Chrome",
  siteDomain: "example.com",
  platform: "macos",
  source: "accessibility",
};

function windowAssignment(
  windowId: string,
  startedAt: string,
  endedAt: string,
  projectId: string | null,
): ProjectWindowAssignmentRecord {
  return {
    windowId,
    windowStartedAt: startedAt,
    windowEndedAt: endedAt,
    durationSeconds: 180,
    segmentOverlaps: [{ segmentId: source.id, durationSeconds: 180 }],
    projectId,
    teamProjectId: null,
    source: "ai",
  };
}

describe("buildPersonalProjectSliceProjection", () => {
  it("retains a captured Windows app named Unavailable when its process identity is verified", () => {
    const captured: ActivitySegment = {
      ...source,
      id: "captured-unavailable",
      appName: "Unavailable",
      bundleId: "C:\\Apps\\Unavailable\\Unavailable.exe",
      platform: "windows",
      source: "win32-foreground",
      frontmostCaptureSource: "win32-foreground",
    };
    const projection = buildPersonalProjectSliceProjection(
      [captured],
      [{
        ...windowAssignment("w0", captured.startedAt, "2026-07-28T09:03:00.000Z", "project-a"),
        segmentOverlaps: [{ segmentId: captured.id, durationSeconds: 180 }],
      }],
      [],
    );

    expect(projection.segments.map((segment) => segment.appName)).toEqual(["Unavailable", "Unavailable"]);
    expect(projection.segments.reduce((seconds, segment) => seconds + segment.durationSeconds, 0)).toBe(360);
    expect([...projection.projectBySegmentId.values()]).toEqual(["project-a"]);
  });

  it("hides old Windows capture failures even when persisted window decisions reference them", () => {
    const failedCapture: ActivitySegment = {
      ...source,
      id: "failed-capture",
      startedAt: "2026-07-28T09:06:00.000Z",
      endedAt: "2026-07-28T09:09:00.000Z",
      durationSeconds: 180,
      appName: "Unavailable",
      bundleId: null,
      platform: "windows",
      source: "win32-foreground",
    };
    const unassignedFailure = {
      ...failedCapture,
      id: "unassigned-failure",
      startedAt: "2026-07-28T09:09:00.000Z",
      endedAt: "2026-07-28T09:12:00.000Z",
    };
    const projection = buildPersonalProjectSliceProjection(
      [source, failedCapture, unassignedFailure],
      [
        windowAssignment("w0", "2026-07-28T09:00:00.000Z", "2026-07-28T09:03:00.000Z", "project-a"),
        {
          ...windowAssignment("w2", failedCapture.startedAt, failedCapture.endedAt, "project-a"),
          segmentOverlaps: [{ segmentId: failedCapture.id, durationSeconds: 180 }],
        },
      ],
      [],
    );

    expect(projection.segments.map((segment) => segment.appName)).toEqual(["Chrome", "Chrome"]);
    expect(projection.segments.reduce((seconds, segment) => seconds + segment.durationSeconds, 0)).toBe(360);
    expect([...projection.projectBySegmentId.values()]).toEqual(["project-a"]);
  });

  it("preserves different project decisions for adjacent 3-minute windows of one source segment", () => {
    const projection = buildPersonalProjectSliceProjection(
      [source],
      [
        windowAssignment("w0", "2026-07-28T09:00:00.000Z", "2026-07-28T09:03:00.000Z", "project-a"),
        windowAssignment("w1", "2026-07-28T09:03:00.000Z", "2026-07-28T09:06:00.000Z", "project-b"),
      ],
      [],
    );

    expect(projection.segments).toHaveLength(2);
    expect(projection.segments.map((segment) => segment.durationSeconds)).toEqual([180, 180]);
    expect(projection.segments.map((segment) => projection.projectBySegmentId.get(segment.id))).toEqual([
      "project-a",
      "project-b",
    ]);
    const flow = buildFlowBlocks(
      [source],
      "2026-07-28",
      3,
      undefined,
      0,
      undefined,
      projection.projectBySegmentId,
      projection.segments,
    );
    expect(flow.map((block) => block.projectId)).toEqual(["project-a", "project-b"]);
  });

  it("lets a manual source-segment assignment override every overlapping AI window", () => {
    const manual: ProjectAssignmentRecord = {
      segmentId: source.id,
      projectId: "manual-project",
      source: "manual",
    };
    const projection = buildPersonalProjectSliceProjection(
      [source],
      [
        windowAssignment("w0", "2026-07-28T09:00:00.000Z", "2026-07-28T09:03:00.000Z", "project-a"),
        windowAssignment("w1", "2026-07-28T09:03:00.000Z", "2026-07-28T09:06:00.000Z", "project-b"),
      ],
      [manual],
    );

    expect([...projection.projectBySegmentId.values()]).toEqual(["manual-project", "manual-project"]);
  });

  it("keeps uncovered duration on the legacy assignment during a partial rollout", () => {
    const legacy: ProjectAssignmentRecord = {
      segmentId: source.id,
      projectId: "legacy-project",
      source: "ai",
    };
    const projection = buildPersonalProjectSliceProjection(
      [source],
      [windowAssignment("w0", "2026-07-28T09:00:00.000Z", "2026-07-28T09:03:00.000Z", "project-a")],
      [legacy],
    );

    expect(projection.segments.map((segment) => segment.durationSeconds)).toEqual([180, 180]);
    expect([...projection.projectBySegmentId.values()]).toEqual(["project-a", "legacy-project"]);
    expect(projection.segments.map((segment) => [segment.startedAt, segment.endedAt])).toEqual([
      ["2026-07-28T09:00:00.000Z", "2026-07-28T09:03:00.000Z"],
      ["2026-07-28T09:03:00.000Z", "2026-07-28T09:06:00.000Z"],
    ]);
  });
});
