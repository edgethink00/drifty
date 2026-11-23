import type { GoogleCalendarWeekEvent } from "./googleCalendarWeek";
import type { GoogleCalendarWeekState, GoogleCalendarWeekStatus } from "./useGoogleCalendarWeek";

export type PlannedCalendarSource = "google" | "mac";

export type PlannedCalendarWeek = {
  readonly status: GoogleCalendarWeekStatus;
  readonly events: Map<string, GoogleCalendarWeekEvent[]>;
  /** Sources that currently contribute events or are loading them. */
  readonly sources: readonly PlannedCalendarSource[];
};

const ACTIVE: readonly GoogleCalendarWeekStatus[] = ["loading", "ready", "error"];

function duplicateKey(event: GoogleCalendarWeekEvent): string {
  return [
    event.allDay ? "all-day" : "timed",
    Math.round(event.startMinute),
    Math.round(event.durationMinutes),
    event.title.trim().toLocaleLowerCase(),
  ].join("|");
}

/**
 * One planned layer for Week. A Google account that is also added to macOS
 * Calendar would otherwise draw every event twice, so events with the same
 * title and time on a day are shown once (Google's copy wins).
 */
export function mergePlannedCalendarWeeks(
  google: GoogleCalendarWeekState,
  mac: GoogleCalendarWeekState,
): PlannedCalendarWeek {
  const inputs = ([["google", google], ["mac", mac]] as const).filter(([, state]) => ACTIVE.includes(state.status));
  if (inputs.length === 0) {
    const fallback = google.status === "disabled" ? mac.status : google.status;
    return { status: fallback === "disconnected" ? "disconnected" : "disabled", events: new Map(), sources: [] };
  }
  const statuses = inputs.map(([, state]) => state.status);
  const status: GoogleCalendarWeekStatus = statuses.includes("ready")
    ? "ready"
    : statuses.includes("loading")
      ? "loading"
      : "error";

  const events = new Map<string, GoogleCalendarWeekEvent[]>();
  const seen = new Map<string, Set<string>>();
  for (const [source, state] of inputs) {
    for (const [day, dayEvents] of state.events) {
      const list = events.get(day) ?? [];
      const keys = seen.get(day) ?? new Set<string>();
      for (const event of dayEvents) {
        const key = duplicateKey(event);
        if (keys.has(key)) continue;
        keys.add(key);
        list.push(source === "google" ? event : { ...event, id: `${source}:${event.id}` });
      }
      events.set(day, list);
      seen.set(day, keys);
    }
  }
  for (const list of events.values()) {
    list.sort((left, right) => (
      Number(right.allDay) - Number(left.allDay)
      || left.startMinute - right.startMinute
      || left.title.localeCompare(right.title)
    ));
  }
  return { status, events, sources: inputs.map(([source]) => source) };
}
