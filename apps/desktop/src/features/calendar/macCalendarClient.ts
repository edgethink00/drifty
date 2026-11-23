import { invoke } from "@tauri-apps/api/core";

import type { GoogleCalendarEvent } from "./googleCalendarClient";

/** macOS Calendar (EventKit) access for the optional Week overlay. */
export type MacCalendarAuthorization =
  | "notDetermined"
  | "granted"
  | "denied"
  | "restricted"
  | "writeOnly"
  | "unsupported";

/** Same shape as a Google event, so both feed one Week layer. */
export type MacCalendarEvent = GoogleCalendarEvent;

const AUTHORIZATIONS: readonly MacCalendarAuthorization[] = [
  "notDetermined", "granted", "denied", "restricted", "writeOnly", "unsupported",
];
const ENABLED_STORAGE_KEY = "drifty.macCalendar.enabled.v1";
const ID_MAX_LENGTH = 1_024;
const TEXT_MAX_LENGTH = 4_096;
const TIME_MAX_LENGTH = 64;
const MAX_EVENTS = 500;

export const MAC_CALENDAR_CHANGED_EVENT = "drifty:mac-calendar-changed";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function parseAuthorization(value: unknown): MacCalendarAuthorization {
  if (typeof value === "string" && (AUTHORIZATIONS as readonly string[]).includes(value)) {
    return value as MacCalendarAuthorization;
  }
  throw new Error("Mac Calendar authorization response was invalid.");
}

/** Whether the person turned the overlay on. Permission is checked separately. */
export function isMacCalendarEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMacCalendarEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(ENABLED_STORAGE_KEY, "1");
    else window.localStorage.removeItem(ENABLED_STORAGE_KEY);
  } catch {
    // Storage can be unavailable; the overlay then stays off.
  }
  window.dispatchEvent(new Event(MAC_CALENDAR_CHANGED_EVENT));
}

export async function getMacCalendarAuthorization(): Promise<MacCalendarAuthorization> {
  if (!isTauriRuntime()) return "unsupported";
  return parseAuthorization(await invoke("mac_calendar_status"));
}

/** Shows the macOS prompt only while access is undecided; otherwise reports the current state. */
export async function requestMacCalendarAccess(): Promise<MacCalendarAuthorization> {
  if (!isTauriRuntime()) return "unsupported";
  return parseAuthorization(await invoke("mac_calendar_request_access"));
}

export function parseMacCalendarEvents(value: unknown): MacCalendarEvent[] {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) {
    throw new Error("Mac Calendar events response was invalid.");
  }
  return value.map((event) => {
    if (
      !isRecord(event)
      || !isBoundedString(event.id, ID_MAX_LENGTH)
      || !isBoundedString(event.title, TEXT_MAX_LENGTH)
      || !isBoundedString(event.start, TIME_MAX_LENGTH)
      || !isBoundedString(event.end, TIME_MAX_LENGTH)
      || typeof event.allDay !== "boolean"
    ) {
      throw new Error("Mac Calendar event was invalid.");
    }
    return { id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay };
  });
}

export async function getMacCalendarEvents(start: string, end: string): Promise<MacCalendarEvent[]> {
  return parseMacCalendarEvents(await invoke("mac_calendar_events", { start, end }));
}
