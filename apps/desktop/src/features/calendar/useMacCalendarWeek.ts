import { logicalDayEndExclusiveMs, logicalDayStartMs } from "@drifty/domain";
import { useEffect, useState } from "react";

import { buildGoogleCalendarWeekEvents, type GoogleCalendarWeekEvent } from "./googleCalendarWeek";
import {
  MAC_CALENDAR_CHANGED_EVENT,
  getMacCalendarAuthorization,
  getMacCalendarEvents,
  isMacCalendarEnabled,
} from "./macCalendarClient";
import type { GoogleCalendarWeekState } from "./useGoogleCalendarWeek";

type UseMacCalendarWeekOptions = {
  readonly enabled: boolean;
  readonly startDay: string;
  readonly endDay: string;
  readonly startOfDayMinutes: number;
};

function emptyEvents(): Map<string, GoogleCalendarWeekEvent[]> {
  return new Map();
}

/**
 * Events from macOS Calendar for the shown week. Reads nothing until the
 * person turns the setting on and macOS grants access, and rereads when the
 * window regains focus so edits made in Calendar appear.
 */
export function useMacCalendarWeek({
  enabled,
  startDay,
  endDay,
  startOfDayMinutes,
}: UseMacCalendarWeekOptions): GoogleCalendarWeekState {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<GoogleCalendarWeekState>({ status: "disabled", events: emptyEvents() });

  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener(MAC_CALENDAR_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(MAC_CALENDAR_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!enabled || !isMacCalendarEnabled()) {
      setState({ status: "disabled", events: emptyEvents() });
      return () => {
        active = false;
      };
    }
    setState((current) => ({ status: current.status === "ready" ? "ready" : "loading", events: current.events }));
    void (async () => {
      const authorization = await getMacCalendarAuthorization();
      if (!active) return;
      if (authorization !== "granted") {
        setState({ status: authorization === "unsupported" ? "disabled" : "disconnected", events: emptyEvents() });
        return;
      }
      const start = new Date(logicalDayStartMs(startDay, startOfDayMinutes)).toISOString();
      const end = new Date(logicalDayEndExclusiveMs(endDay, startOfDayMinutes)).toISOString();
      const events = await getMacCalendarEvents(start, end);
      if (active) {
        setState({ status: "ready", events: buildGoogleCalendarWeekEvents(events, startDay, endDay, startOfDayMinutes) });
      }
    })().catch(() => {
      if (active) setState({ status: "error", events: emptyEvents() });
    });
    return () => {
      active = false;
    };
  }, [enabled, endDay, revision, startDay, startOfDayMinutes]);

  if (!enabled) return { status: "disabled", events: emptyEvents() };
  return state;
}
