import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildFocusCalendar, focusCalendarLevel, focusCalendarWindow } from "./focusCalendar";

function segment(startedAt: string, endedAt: string, productivity: "focus" | "drift" = "focus"): ActivitySegment {
  return {
    id: `${startedAt}-${productivity}`, startedAt, endedAt,
    durationSeconds: (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    appName: "Fixture", windowTitle: "", platform: "macos", source: "nsworkspace",
    classification: { category: "workspace", productivity, source: "manual", confidence: 1, reason: "fixture" },
  };
}
describe("focus calendar", () => {
  it("anchors rolling review windows to the selected day without future cells", () => {
    expect(focusCalendarWindow("2026-09-09", "half")).toEqual({ startDay: "2026-04-10", gridEndDay: "2026-09-09" });
    expect(focusCalendarWindow("2026-09-09", "half-compact")).toEqual(focusCalendarWindow("2026-09-09", "half"));
    expect(focusCalendarWindow("2026-09-09", "quarter")).toEqual({ startDay: "2026-06-10", gridEndDay: "2026-09-09" });
    expect(focusCalendarWindow("2026-02-05", "half")).toEqual({ startDay: "2025-09-06", gridEndDay: "2026-02-05" });
  });
  it("clamps shorter months and keeps the annual comparison unchanged", () => {
    expect(focusCalendarWindow("2024-08-31", "half").startDay).toBe("2024-04-01");
    expect(focusCalendarWindow("2026-05-31", "quarter").startDay).toBe("2026-03-01");
    expect(focusCalendarWindow("2024-09-09", "year")).toEqual({ startDay: "2024-01-01", gridEndDay: "2024-12-31" });
  });
  it("distinguishes a recorded day without focus from a day without records", () => {
    const days = buildFocusCalendar([segment("2026-09-08T10:00:00", "2026-09-08T11:00:00", "drift")], "2026-09-08", "2026-09-09");
    expect(days).toEqual([
      { day: "2026-09-08", trackedSeconds: 3600, focusSeconds: 0, level: 0 },
      { day: "2026-09-09", trackedSeconds: 0, focusSeconds: 0, level: 0 },
    ]);
  });
  it("splits at the user's logical day boundary and clips the requested range", () => {
    const days = buildFocusCalendar([segment("2026-09-08T03:00:00", "2026-09-09T05:00:00")], "2026-09-08", "2026-09-09", undefined, 240);
    expect(days.map(day => day.focusSeconds)).toEqual([24 * 3600, 3600]);
  });
  it("preserves the recorded duration of a newly sampled point", () => {
    const point = { ...segment("2026-09-09T09:00:00", "2026-09-09T09:00:00"), durationSeconds: 30 };
    expect(buildFocusCalendar([point], "2026-09-09", "2026-09-09")[0].focusSeconds).toBe(30);
  });
  it("ignores invalid and reversed timestamps", () => {
    expect(buildFocusCalendar([
      segment("invalid", "invalid"),
      segment("2026-09-09T10:00:00", "2026-09-09T09:00:00"),
    ], "2026-09-09", "2026-09-09")[0].trackedSeconds).toBe(0);
  });
  it("uses stable, explicit hour thresholds rather than relative maxima", () => {
    expect([0, 1, 3599, 3600, 7199, 7200, 14399, 14400].map(focusCalendarLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });
});
