import { useEffect, useState } from "react";
import {
  FOCUS_SESSION_CHANGED_EVENT,
  listenToShellEvent,
  readNativeFocusSession,
  type NativeFocusSession,
} from "../focus-session/focusSessionBridge";

/** The end of the pomodoro break running now, if any. */
export function focusBreakEndAt(session: NativeFocusSession | null, now: number): number | null {
  if (!session || now >= session.endsAtMs) return null;
  const phase = session.phases.find((entry) => now >= entry.startMs && now < entry.endMs);
  return phase?.kind === "break" ? phase.endMs : null;
}

function nextBoundary(session: NativeFocusSession | null, now: number): number | null {
  if (!session) return null;
  const upcoming = session.phases.map((entry) => entry.startMs).concat(session.endsAtMs).filter((time) => time > now);
  return upcoming.length ? Math.min(...upcoming) : null;
}

/**
 * The cat sleeps through a pomodoro break, the same way it sleeps through a
 * timed pause (usePetTimedPauseSleep). The pet window reads the shell's copy
 * of the session, which the main window keeps current.
 */
export function usePetFocusBreakSleep(): number | null {
  const [session, setSession] = useState<NativeFocusSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let disposed = false;
    const stop = listenToShellEvent<NativeFocusSession | null>(FOCUS_SESSION_CHANGED_EVENT, (next) => {
      if (disposed) return;
      setSession(next);
      setNow(Date.now());
    });
    void readNativeFocusSession().then((initial) => {
      if (!disposed) setSession(initial);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      stop();
    };
  }, []);
  const boundary = nextBoundary(session, now);
  useEffect(() => {
    if (boundary === null) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(0, boundary - Date.now()) + 50));
    return () => window.clearTimeout(timer);
  }, [boundary]);
  return focusBreakEndAt(session, now);
}
