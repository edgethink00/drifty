import { logicalDayEndExclusiveMs, logicalDayStartMs } from "@drifty/domain";

import { buildIsoDayList } from "../../lib/formatting";
import type { GoogleCalendarEvent } from "./googleCalendarClient";

export type GoogleCalendarWeekEvent = {
  readonly id: string;
  readonly sourceId: string;
  readonly day: string;
  readonly title: string;
  readonly startMinute: number;
  readonly durationMinutes: number;
  readonly allDay: boolean;
};

function isIsoDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(new Date(`${value}T12:00:00`).getTime());
}

function appendEvent(
  byDay: Map<string, GoogleCalendarWeekEvent[]>,
  event: GoogleCalendarWeekEvent,
): void {
  byDay.get(event.day)?.push(event);
}

export function buildGoogleCalendarWeekEvents(
  events: readonly GoogleCalendarEvent[],
  startDay: string,
  endDay: string,
  startOfDayMinutes: number,
): Map<string, GoogleCalendarWeekEvent[]> {
  const days = buildIsoDayList(startDay, endDay);
  const byDay = new Map(days.map((day) => [day, [] as GoogleCalendarWeekEvent[]]));

  for (const event of events) {
    if (event.allDay) {
      if (!isIsoDay(event.start) || !isIsoDay(event.end) || event.end <= event.start) continue;
      for (const day of days) {
        if (day < event.start || day >= event.end) continue;
        appendEvent(byDay, {
          id: `${event.id}:${day}`,
          sourceId: event.id,
          day,
          title: event.title,
          startMinute: 0,
          durationMinutes: 0,
          allDay: true,
        });
      }
      continue;
    }

    const eventStartMs = new Date(event.start).getTime();
    const eventEndMs = new Date(event.end).getTime();
    if (!Number.isFinite(eventStartMs) || !Number.isFinite(eventEndMs) || eventEndMs <= eventStartMs) continue;

    for (const day of days) {
      const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
      const dayEndMs = logicalDayEndExclusiveMs(day, startOfDayMinutes);
      const overlapStartMs = Math.max(eventStartMs, dayStartMs);
      const overlapEndMs = Math.min(eventEndMs, dayEndMs);
      if (overlapEndMs <= overlapStartMs) continue;
      appendEvent(byDay, {
        id: `${event.id}:${day}`,
        sourceId: event.id,
        day,
        title: event.title,
        startMinute: (overlapStartMs - dayStartMs) / 60_000,
        durationMinutes: (overlapEndMs - overlapStartMs) / 60_000,
        allDay: false,
      });
    }
  }

  for (const dayEvents of byDay.values()) {
    dayEvents.sort((left, right) => (
      Number(right.allDay) - Number(left.allDay)
      || left.startMinute - right.startMinute
      || left.title.localeCompare(right.title)
    ));
  }
  return byDay;
}
