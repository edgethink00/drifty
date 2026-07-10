import { describe, expect, it } from "vitest";
import type { ActivitySegment, TeamProjectAssignmentRecord } from "@drifty/domain";
import { aggregateTeamProjectDayTotals } from "./teamProjectTime";

function segment(id: string, startedAt: string, durationSeconds: number): ActivitySegment {
  return { id, startedAt, endedAt: startedAt, durationSeconds, appName: "" } as ActivitySegment;
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

  it("returns nothing when there are no assignments", () => {
    expect(aggregateTeamProjectDayTotals([], [segment("s1", "2026-07-08T03:00:00.000Z", 100)], 0)).toEqual([]);
  });
});
