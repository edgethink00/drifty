import { describe, expect, it } from "vitest";
import { aggregateDeviceElapsedTime, filterSegmentsByDevice, totalDurationSeconds, type ActivitySegment } from "@drifty/domain";
import { buildQuarterHourDayField } from "../dashboard/dayField";
import { buildFocusDriftChart } from "../dashboard/focusDriftChart";
import { buildWeekDashboardDayModel } from "../dashboard/weekDashboardModel";
import { buildFocusCalendar } from "../insights/focusCalendar";
import { selectInsightSegments } from "../insights/insightSegments";

const records: ActivitySegment[] = [
  { id: "local-editor", appName: "Editor", startedAt: "2026-10-04T09:00:00", endedAt: "2026-10-04T09:30:00", durationSeconds: 1800, platform: "macos", source: "manual", classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 } },
  { id: "synced-video", appName: "Video", startedAt: "2026-10-04T09:00:00", endedAt: "2026-10-04T09:30:00", durationSeconds: 1800, deviceId: "pc", platform: "windows", source: "manual", classification: { category: "entertainment", productivity: "drift", source: "manual", confidence: 1 } },
];

describe("synced elapsed time across display models", () => {
  it("shows 30 elapsed minutes and consistent 15/15 breakdown in Day and Week", () => {
    const day = buildQuarterHourDayField(records, "2026-10-04");
    expect(day.reduce((sum, entry) => sum + entry.totalSeconds, 0)).toBe(1800);
    const chart = buildFocusDriftChart(records, "2026-10-04");
    expect(chart.points.reduce((sum, point) => sum + point.trackedSeconds, 0)).toBe(1800);
    expect(chart.points.reduce((sum, point) => sum + point.focusSeconds, 0)).toBe(900);
    expect(chart.points.reduce((sum, point) => sum + point.driftSeconds, 0)).toBe(900);
    const week = buildWeekDashboardDayModel({ day: "2026-10-04", segments: records, startOfDayMinutes: 0 });
    expect(week.row.totalSeconds).toBe(1800);
    expect(week.row.focusSeconds).toBe(900);
    expect(week.row.focusScore).toBe(50);
    expect(week.calendarEvents.reduce((sum, event) => sum + event.activeDurationMinutes, 0)).toBe(30);
    expect(new Set(week.calendarEvents.flatMap(event => event.segmentIds))).toEqual(new Set(records.map(record => record.id)));
    expect(week.calendarEvents.flatMap(event => event.identities).reduce((sum, identity) => sum + identity.seconds, 0)).toBe(1800);
  });

  it.each(["local", "pc"])("keeps the %s device's 30 minutes in the filtered Day and Week", filter => {
    const selected = filterSegmentsByDevice(records, filter);
    expect(totalDurationSeconds(selected)).toBe(1800);
    expect(buildQuarterHourDayField(selected, "2026-10-04").reduce((sum, entry) => sum + entry.totalSeconds, 0)).toBe(1800);
    expect(buildWeekDashboardDayModel({ day: "2026-10-04", segments: selected, startOfDayMinutes: 0 }).row.totalSeconds).toBe(1800);
  });

  it("keeps a local-only day identical when the Week includes another device on a later day", () => {
    const local = [records[0], { ...records[0], id: "overlapping-local-sample", startedAt: "2026-10-04T09:15:00", endedAt: "2026-10-04T09:45:00" }];
    const weekRecords = aggregateDeviceElapsedTime([...local, { ...records[1], startedAt: "2026-10-05T09:00:00", endedAt: "2026-10-05T09:30:00" }]);
    expect(totalDurationSeconds(local)).toBe(3600);
    expect(buildQuarterHourDayField(local, "2026-10-04").reduce((sum, entry) => sum + entry.totalSeconds, 0)).toBe(3600);
    expect(buildWeekDashboardDayModel({ day: "2026-10-04", segments: weekRecords, startOfDayMinutes: 0 }).row.totalSeconds).toBe(3600);
    expect(buildQuarterHourDayField(weekRecords, "2026-10-04").reduce((sum, entry) => sum + entry.totalSeconds, 0)).toBe(3600);
  });

  it("matches Trends summary and focus-calendar totals without mutating stored history", () => {
    const selected = selectInsightSegments({ historySegments: records, selectedDaySegments: [], range: { start: "2026-10-04T00:00:00", end: "2026-10-05T00:00:00" } });
    expect(totalDurationSeconds(selected)).toBe(1800);
    const calendar = buildFocusCalendar(selected, "2026-10-04", "2026-10-04");
    expect(calendar[0]).toMatchObject({ trackedSeconds: 1800, focusSeconds: 900 });
    expect(records.map(record => record.durationSeconds)).toEqual([1800, 1800]);
  });

  it("clips the same simultaneous interval on both sides of the logical-day boundary", () => {
    const midnight = records.map(record => ({ ...record, startedAt: "2026-10-04T03:45:00", endedAt: "2026-10-04T04:15:00" }));
    for (const day of ["2026-10-03", "2026-10-04"]) {
      const week = buildWeekDashboardDayModel({ day, segments: midnight, startOfDayMinutes: 240 });
      expect(week.row.totalSeconds).toBe(900);
      expect(week.row.focusSeconds).toBe(450);
      expect(buildQuarterHourDayField(midnight, day, 240).reduce((sum, entry) => sum + entry.totalSeconds, 0)).toBe(900);
    }
  });
});
