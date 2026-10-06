import { expect, it } from "vitest";
import { buildPersonalProjectSliceProjection, type ActivitySegment, type ProjectWindowAssignmentRecord } from "@drifty/domain";
import { buildWeeklyBreakdown } from "../insights/insightData";
import { aggregateTeamProjectDayTotals } from "../team/teamProjectTime";

it("keeps sparse historical Project lens and team publish-ready totals at the captured 60 seconds", () => {
  const raw: ActivitySegment = { id: "sparse", startedAt: "2026-04-06T09:00:00Z", endedAt: "2026-04-06T09:06:00Z", durationSeconds: 60, appName: "Code", platform: "macos", source: "accessibility",
    classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 } };
  const windows: ProjectWindowAssignmentRecord[] = [0, 3].map(minute => ({
    windowId: "w" + minute, windowStartedAt: new Date(Date.parse(raw.startedAt) + minute * 60000).toISOString(),
    windowEndedAt: new Date(Date.parse(raw.startedAt) + (minute + 3) * 60000).toISOString(),
    durationSeconds: 180, segmentOverlaps: [{ segmentId: raw.id, durationSeconds: 180 }],
    projectId: "project", teamProjectId: "team-project", source: "ai",
  }));
  const project = buildPersonalProjectSliceProjection([raw], windows, []);
  const weekly = buildWeeklyBreakdown([raw], undefined, undefined, project.projectBySegmentId, project.segments);
  expect(weekly.reduce((n, d) => n + d.focusSeconds, 0)).toBe(60);
  expect(weekly.reduce((n, d) => n + Object.values(d.projectSeconds).reduce<number>((a, b) => a + (b ?? 0), 0), 0)).toBe(60);
  expect(aggregateTeamProjectDayTotals([], [raw], 0, windows)).toEqual([{ project_id: "team-project", activity_date: "2026-04-06", seconds: 60 }]);
});
