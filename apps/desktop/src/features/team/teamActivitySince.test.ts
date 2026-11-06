import { expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { teamActivitySince, teamActivityWithinSpans } from "./teamActivitySince";
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

it("keeps only the parts of records inside the team's hours", () => {
  const spans = [
    { start: Date.parse("2026-10-20T09:00:00Z"), end: Date.parse("2026-10-20T18:00:00Z") },
    { start: Date.parse("2026-10-21T09:00:00Z"), end: Date.parse("2026-10-21T18:00:00Z") },
  ];
  const inside = segment("inside", "2026-10-20T10:00:00Z", "2026-10-20T11:00:00Z", 3600);
  const closing = segment("closing", "2026-10-20T17:30:00Z", "2026-10-20T18:30:00Z", 1800);
  const night = segment("night", "2026-10-20T22:00:00Z", "2026-10-20T23:00:00Z", 3600);
  const overnight = segment("overnight", "2026-10-20T17:00:00Z", "2026-10-21T10:00:00Z", 61200);
  const kept = teamActivityWithinSpans([inside, closing, night, overnight], spans);
  expect(kept[0]).toBe(inside);
  expect(kept[1]).toMatchObject({ id: "closing", startedAt: "2026-10-20T17:30:00.000Z", endedAt: "2026-10-20T18:00:00.000Z", durationSeconds: 900 });
  // A record reaching into two days of hours: its later part takes an id of its own, so no assignment follows it.
  expect(kept.slice(2).map((row) => [row.id, row.durationSeconds])).toEqual([["overnight", 3600], ["overnight~1", 3600]]);
  expect(kept).toHaveLength(4);
  expect(teamActivityWithinSpans([inside], [])).toEqual([]);
});
