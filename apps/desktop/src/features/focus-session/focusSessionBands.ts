import { useEffect, useMemo, useState } from "react";
import { logicalDayStartMs } from "@drifty/domain";
import { plannedSessionMinutes, sessionPhases, useFocusSessionState, type FocusSessionRecord } from "./focusSession";

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** One focus stretch of a session on a logical day, in minutes from the day's start. */
export type FocusSessionBand = {
  readonly key: string;
  readonly sessionId: string;
  readonly mode: FocusSessionRecord["mode"];
  readonly top: number;
  readonly bottom: number;
  readonly sessionStart: number;
  readonly sessionEnd: number;
};

/**
 * The focus phases of finished and running sessions that fall on this
 * logical day; a pomodoro's breaks are the gaps between them.
 */
export function focusSessionBands(records: readonly FocusSessionRecord[], day: string, startOfDayMinutes: number): FocusSessionBand[] {
  const dayStart = logicalDayStartMs(day, startOfDayMinutes);
  const dayEnd = dayStart + DAY_MINUTES * MINUTE;
  const minute = (ms: number) => Math.min(DAY_MINUTES, Math.max(0, (ms - dayStart) / MINUTE));
  return records.flatMap((record) => {
    if (record.endedAt <= dayStart || record.startedAt >= dayEnd) return [];
    const anchor = record.anchorAt ?? record.startedAt;
    const plannedEnd = record.mode === "pomodoro"
      ? anchor + plannedSessionMinutes("pomodoro", 0, record.plan) * MINUTE
      : record.endedAt;
    return sessionPhases(record.mode, anchor, Math.max(plannedEnd, record.endedAt), record.endedAt, record.plan)
      // A skipped break moves the schedule's anchor earlier; nothing ran before the start.
      .map((phase) => ({ ...phase, start: Math.max(phase.start, record.startedAt) }))
      .filter((phase) => phase.kind === "focus" && phase.end > phase.start && phase.end > dayStart && phase.start < dayEnd)
      .map((phase) => ({
        key: record.id + ":" + phase.round,
        sessionId: record.id,
        mode: record.mode,
        top: minute(phase.start),
        bottom: minute(phase.end),
        sessionStart: minute(record.startedAt),
        sessionEnd: minute(record.endedAt),
      }));
  });
}

/** The day's focus phases for the Day Breakdown's session list, kept current while a session runs. */
export function useFocusSessionBands(day: string, startOfDayMinutes: number): FocusSessionBand[] {
  const { active, history } = useFocusSessionState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, [active]);
  return useMemo(() => {
    const running: FocusSessionRecord[] = active && now > active.startedAt
      ? [{
        id: active.id,
        mode: active.mode,
        startedAt: active.startedAt,
        endedAt: Math.min(now, active.endsAt),
        ...(active.plan ? { plan: active.plan } : {}),
        ...(active.anchorAt !== undefined ? { anchorAt: active.anchorAt } : {}),
      }]
      : [];
    return focusSessionBands([...history, ...running], day, startOfDayMinutes);
  }, [active, day, history, now, startOfDayMinutes]);
}
