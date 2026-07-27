import { describe, expect, it } from "vitest";
import type { ActivitySegment, ProjectWindowAssignmentRecord, TeamProjectAssignmentRecord } from "@drifty/domain";
import { aggregateTeamProjectDayTotals } from "./teamProjectTime";

function segment(
  id: string,
  startedAt: string,
  durationSeconds: number,
  extra: Partial<ActivitySegment> = {},
): ActivitySegment {
  return { id, startedAt, endedAt: startedAt, durationSeconds, appName: "", ...extra } as ActivitySegment;
}

function assignment(segmentId: string, teamProjectId: string | null, extra: Partial<TeamProjectAssignmentRecord> = {}): TeamProjectAssignmentRecord {
  return { segmentId, teamProjectId, source: "ai", ...extra };
}

describe("aggregateTeamProjectDayTotals", () => {
  it("sums stored assignment seconds per project per logical day", () => {
    const segments = [
      segment("s1", "2026-07-08T03:00:00.000Z", 600),
      segment("s2", "2026-07-08T06:00:00.000Z", 300),
      segment("s3", "2026-07-09T03:00:00.000Z", 200),
    ];
    const assignments = [
      assignment("s1", "p-code"),
      assignment("s2", "p-code"),
      assignment("s3", "p-web"),
    ];

    const entries = aggregateTeamProjectDayTotals(assignments, segments, 0);
    const byKey = Object.fromEntries(entries.map((entry) => [`${entry.project_id}|${entry.activity_date}`, entry.seconds]));

    expect(byKey["p-code|2026-07-08"]).toBe(900);
    expect(byKey["p-web|2026-07-09"]).toBe(200);
  });

  it("ignores stale assignments, null projects, and missing/zero-duration segments", () => {
    const segments = [
      segment("s1", "2026-07-08T03:00:00.000Z", 500),
      segment("s2", "2026-07-08T03:00:00.000Z", 0),
      segment("s3", "2026-07-08T03:00:00.000Z", 400),
    ];
    const assignments = [
      assignment("s1", "p", { stale: true }),
      assignment("s2", "p"),
      assignment("s3", null),
      assignment("s-missing", "p"),
      assignment("s3b", "p"), // no matching segment
    ];

    expect(aggregateTeamProjectDayTotals(assignments, segments, 0)).toEqual([]);
  });

  it("excludes remote-device segments from published team totals", () => {
    const segments = [
      segment("local", "2026-07-08T03:00:00.000Z", 600),
      segment("remote", "2026-07-08T06:00:00.000Z", 300, { deviceId: "device-b" }),
    ];
    const assignments = [assignment("local", "p-code"), assignment("remote", "p-code")];

    expect(aggregateTeamProjectDayTotals(assignments, segments, 0)).toEqual([
      { project_id: "p-code", activity_date: "2026-07-08", seconds: 600 },
    ]);
  });

  it("returns nothing when there are no assignments", () => {
    expect(aggregateTeamProjectDayTotals([], [segment("s1", "2026-07-08T03:00:00.000Z", 100)], 0)).toEqual([]);
  });

  it("publishes exact fixed-window team totals without collapsing a source segment", () => {
    const segments = [segment("s1", "2026-07-08T03:00:00.000Z", 360, {
      endedAt: "2026-07-08T03:06:00.000Z",
    })];
    const windows: ProjectWindowAssignmentRecord[] = [
      {
        windowId: "w0",
        windowStartedAt: "2026-07-08T03:00:00.000Z",
        windowEndedAt: "2026-07-08T03:03:00.000Z",
        durationSeconds: 180,
        segmentOverlaps: [{ segmentId: "s1", durationSeconds: 180 }],
        projectId: null,
        teamProjectId: "team-a",
        source: "ai",
      },
      {
        windowId: "w1",
        windowStartedAt: "2026-07-08T03:03:00.000Z",
        windowEndedAt: "2026-07-08T03:06:00.000Z",
        durationSeconds: 180,
        segmentOverlaps: [{ segmentId: "s1", durationSeconds: 180 }],
        projectId: null,
        teamProjectId: "team-b",
        source: "ai",
      },
    ];

    expect(aggregateTeamProjectDayTotals([], segments, 0, windows)).toEqual([
      { project_id: "team-a", activity_date: "2026-07-08", seconds: 180 },
      { project_id: "team-b", activity_date: "2026-07-08", seconds: 180 },
    ]);
  });
});
