import { describe, expect, it } from "vitest";

import type { GoogleCalendarEvent } from "./googleCalendarClient";
import { buildGoogleCalendarWeekEvents } from "./googleCalendarWeek";

function calendarEvent(overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id: "event-1",
    title: "Planning",
    start: "2026-09-02T09:00:00+09:00",
    end: "2026-09-02T10:30:00+09:00",
    allDay: false,
    ...overrides,
  };
}

describe("buildGoogleCalendarWeekEvents", () => {
  it("maps timed events onto the same logical-day axis without changing tracked totals", () => {
    const result = buildGoogleCalendarWeekEvents(
      [calendarEvent()],
      "2026-08-31",
      "2026-09-06",
      4 * 60,
    );

    expect(result.get("2026-09-02")).toEqual([
      expect.objectContaining({
        sourceId: "event-1",
        title: "Planning",
        startMinute: 5 * 60,
        durationMinutes: 90,
        allDay: false,
      }),
    ]);
  });

  it("splits overnight events across logical days and clips each visual block", () => {
    const result = buildGoogleCalendarWeekEvents(
      [calendarEvent({
        start: "2026-09-03T03:30:00+09:00",
        end: "2026-09-03T04:30:00+09:00",
      })],
      "2026-09-02",
      "2026-09-03",
      4 * 60,
    );

    expect(result.get("2026-09-02")?.[0]).toMatchObject({ startMinute: 23.5 * 60, durationMinutes: 30 });
    expect(result.get("2026-09-03")?.[0]).toMatchObject({ startMinute: 0, durationMinutes: 30 });
  });

  it("expands Google all-day end-exclusive dates only inside the visible week", () => {
    const result = buildGoogleCalendarWeekEvents(
      [calendarEvent({
        id: "offsite",
        title: "Offsite",
        start: "2026-09-01",
        end: "2026-09-04",
        allDay: true,
      })],
      "2026-09-02",
      "2026-09-06",
      0,
    );

    expect(result.get("2026-09-02")?.[0]).toMatchObject({ sourceId: "offsite", allDay: true });
    expect(result.get("2026-09-03")?.[0]).toMatchObject({ sourceId: "offsite", allDay: true });
    expect(result.get("2026-09-04")).toEqual([]);
  });

  it("drops invalid date ranges instead of rendering unbounded blocks", () => {
    const result = buildGoogleCalendarWeekEvents(
      [calendarEvent({ start: "invalid", end: "still-invalid" })],
      "2026-09-01",
      "2026-09-07",
      0,
    );

    expect(Array.from(result.values()).flat()).toEqual([]);
  });
});
