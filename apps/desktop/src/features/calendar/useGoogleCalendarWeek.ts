import { logicalDayEndExclusiveMs, logicalDayStartMs } from "@drifty/domain";
import { useEffect, useState } from "react";

import {
  GOOGLE_CALENDAR_CONNECTION_CHANGED_EVENT,
  getGoogleCalendarCapability,
  getGoogleCalendarEvents,
  getGoogleCalendarStatus,
  hasLocalGoogleCalendarConnectionMarker,
  isGoogleCalendarOnboardingEnabled,
} from "./googleCalendarClient";
import { buildGoogleCalendarWeekEvents, type GoogleCalendarWeekEvent } from "./googleCalendarWeek";

export type GoogleCalendarWeekStatus = "disabled" | "disconnected" | "loading" | "ready" | "error";

export type GoogleCalendarWeekState = {
  readonly status: GoogleCalendarWeekStatus;
  readonly events: Map<string, GoogleCalendarWeekEvent[]>;
};

type UseGoogleCalendarWeekOptions = {
  readonly enabled: boolean;
  readonly userId: string | null;
  readonly startDay: string;
  readonly endDay: string;
  readonly startOfDayMinutes: number;
};

function emptyEvents(): Map<string, GoogleCalendarWeekEvent[]> {
  return new Map();
}

export function useGoogleCalendarWeek({
  enabled,
  userId,
  startDay,
  endDay,
  startOfDayMinutes,
}: UseGoogleCalendarWeekOptions): GoogleCalendarWeekState {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<GoogleCalendarWeekState>({ status: "disabled", events: emptyEvents() });

  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener(GOOGLE_CALENDAR_CONNECTION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(GOOGLE_CALENDAR_CONNECTION_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    let active = true;
    if (!enabled || !userId || !isGoogleCalendarOnboardingEnabled()) {
      setState({ status: "disabled", events: emptyEvents() });
      return () => {
        active = false;
      };
    }
    if (!hasLocalGoogleCalendarConnectionMarker(userId)) {
      setState({ status: "disconnected", events: emptyEvents() });
      return () => {
        active = false;
      };
    }

    setState((current) => ({ status: "loading", events: current.events }));
    void (async () => {
      const capability = await getGoogleCalendarCapability();
      if (!capability.configured) {
        if (active) setState({ status: "disabled", events: emptyEvents() });
        return;
      }
      const connection = await getGoogleCalendarStatus(userId);
      if (!connection.connected) {
        if (active) setState({ status: "disconnected", events: emptyEvents() });
        return;
      }
      const start = new Date(logicalDayStartMs(startDay, startOfDayMinutes)).toISOString();
      const end = new Date(logicalDayEndExclusiveMs(endDay, startOfDayMinutes)).toISOString();
      const events = await getGoogleCalendarEvents(userId, start, end);
      if (active) {
        setState({
          status: "ready",
          events: buildGoogleCalendarWeekEvents(events, startDay, endDay, startOfDayMinutes),
        });
      }
    })().catch(() => {
      if (active) setState({ status: "error", events: emptyEvents() });
    });

    return () => {
      active = false;
    };
  }, [enabled, endDay, revision, startDay, startOfDayMinutes, userId]);

  return state;
}
