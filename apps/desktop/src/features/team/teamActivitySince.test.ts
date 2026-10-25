import { expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { teamActivitySince } from "./teamActivitySince";
import { teamFocusDayTotals } from "./teamFocusPublish";
import { aggregateTeamProjectDayTotals } from "./teamProjectTime";
const segment = (id: string, start: string, end: string, durationSeconds: number): ActivitySegment => ({
  id, startedAt: start, endedAt: end, durationSeconds, appName: "Safari", siteDomain: "stackoverflow.com", siteTitle: "Developer docs", platform: "macos", source: "nsworkspace",
});
it("excludes earlier history and splits the sampled record crossing joining for both project and focus aggregates", () => {
  const original = [
    segment("before", "2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z", 3600),
    segment("crossing", "2026-10-20T10:00:00Z", "2026-10-20T11:00:00Z", 1800),
    segment("after", "2026-10-20T11:00:00Z", "2026-10-20T12:00:00Z", 3600),
  ];
  const eligible = teamActivitySince(original, "2026-10-20T10:30:00Z");
  expect(eligible.map((row) => row.id)).toEqual(["crossing", "after"]);
  expect(eligible[0]).toMatchObject({ startedAt: "2026-10-20T10:30:00.000Z", durationSeconds: 900 });
  expect(original[1].durationSeconds).toBe(1800);
  expect(aggregateTeamProjectDayTotals(original.map((row) => ({ segmentId: row.id, teamProjectId: "p", source: "ai" })), eligible, 0))
    .toEqual([{ project_id: "p", activity_date: "2026-10-20", seconds: 4500 }]);
  expect(teamFocusDayTotals(eligible, { start_date: "2026-10-20", end_date: "2026-10-20" }, { includeAiClassifications: false }, 0))
    .toEqual([{ activity_date: "2026-10-20", seconds: 4500 }]);
});
it("fails closed on an invalid join time and keeps later records intact", () => {
  const later = segment("after", "2026-10-20T11:00:00Z", "2026-10-20T12:00:00Z", 3600);
  expect(teamActivitySince([later], "bad")).toEqual([]);
  expect(teamActivitySince([later], "2026-10-20T12:00:00Z")).toEqual([]);
  expect(teamActivitySince([later], "2026-10-20T09:00:00Z")[0]).toBe(later);
});
