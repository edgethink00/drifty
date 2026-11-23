import { describe, expect, it } from "vitest";

import type { GoogleCalendarWeekEvent } from "./googleCalendarWeek";
import { mergePlannedCalendarWeeks } from "./plannedCalendarWeek";
import type { GoogleCalendarWeekState } from "./useGoogleCalendarWeek";

function event(id: string, title: string, startMinute: number, durationMinutes = 60, allDay = false): GoogleCalendarWeekEvent {
  return { id, sourceId: id, day: "2026-11-24", title, startMinute, durationMinutes, allDay };
}

function state(status: GoogleCalendarWeekState["status"], events: GoogleCalendarWeekEvent[] = []): GoogleCalendarWeekState {
  return { status, events: new Map(events.length ? [["2026-11-24", events]] : []) };
}

describe("mergePlannedCalendarWeeks", () => {
  it("shows an event that is in both Google and macOS Calendar once", () => {
    const merged = mergePlannedCalendarWeeks(
      state("ready", [event("g1", "Design review", 600)]),
      state("ready", [event("m1", "Design review ", 600), event("m2", "Dentist", 900)]),
    );
    expect(merged.status).toBe("ready");
    expect(merged.sources).toEqual(["google", "mac"]);
    expect(merged.events.get("2026-11-24")?.map((item) => item.id)).toEqual(["g1", "mac:m2"]);
  });

  it("keeps same-titled events at different times and all-day events first", () => {
    const merged = mergePlannedCalendarWeeks(
      state("disabled"),
      state("ready", [event("m1", "Focus", 600), event("m2", "Focus", 780), event("m3", "Holiday", 0, 0, true)]),
    );
    expect(merged.sources).toEqual(["mac"]);
    expect(merged.events.get("2026-11-24")?.map((item) => item.title)).toEqual(["Holiday", "Focus", "Focus"]);
  });

  it("reports ready when one source is ready and the other failed, and error only when all failed", () => {
    expect(mergePlannedCalendarWeeks(state("error"), state("ready", [event("m1", "A", 60)])).status).toBe("ready");
    expect(mergePlannedCalendarWeeks(state("loading"), state("error")).status).toBe("loading");
    expect(mergePlannedCalendarWeeks(state("error"), state("disabled")).status).toBe("error");
  });

  it("stays out of the way when neither calendar is on", () => {
    const merged = mergePlannedCalendarWeeks(state("disabled"), state("disconnected"));
    expect(merged.status).toBe("disconnected");
    expect(merged.events.size).toBe(0);
    expect(merged.sources).toEqual([]);
  });
});
