import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { MILESTONE_CHOICE_RESPONSE_PREFIX, isTauriRuntime } from "../companion/watcherBridge";
import { activeSessionPhases, type FocusSession, type FocusSessionMode } from "./focusSession";

/**
 * The menu bar's copy of the running session. The renderer owns the session;
 * the shell only shows it (time left beside the icon, a status row and End)
 * and forwards the menu's start and end choices back here. The pet window
 * reads the same copy to sleep through a pomodoro break.
 */
export type NativeFocusSession = {
  readonly id: string;
  readonly mode: FocusSessionMode;
  readonly startedAtMs: number;
  readonly endsAtMs: number;
  readonly phases: readonly {
    readonly kind: "focus" | "break";
    readonly round: number;
    readonly rounds: number;
    readonly startMs: number;
    readonly endMs: number;
  }[];
};

export const FOCUS_SESSION_CHANGED_EVENT = "focus-session://changed";

/** Menu bar choices, emitted by the shell to the main window. */
export const FOCUS_SESSION_TRAY_EVENTS = {
  start30: "tray-focus-session-start-30",
  start60: "tray-focus-session-start-60",
  start120: "tray-focus-session-start-120",
  start240: "tray-focus-session-start-240",
  startCustom: "tray-focus-session-start-custom",
  startPomodoro: "tray-focus-session-start-pomodoro",
  startPomodoro50: "tray-focus-session-start-pomodoro-50",
  startPomodoroCustom: "tray-focus-session-start-pomodoro-custom",
  skipBreak: "tray-focus-session-skip-break",
  end: "tray-focus-session-end",
} as const;

export function toNativeFocusSession(session: FocusSession | null): NativeFocusSession | null {
  if (!session) return null;
  return {
    id: session.id,
    mode: session.mode,
    startedAtMs: session.startedAt,
    endsAtMs: session.endsAt,
    // A skipped break moves the schedule's anchor before the start; the shell
    // accepts only phases inside the session, so the copy starts where it did.
    phases: activeSessionPhases(session)
      .filter((phase) => phase.end > session.startedAt)
      .map((phase) => ({
        kind: phase.kind,
        round: phase.round,
        rounds: phase.rounds,
        startMs: Math.max(phase.start, session.startedAt),
        endMs: phase.end,
      })),
  };
}

export async function publishNativeFocusSession(session: FocusSession | null): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("focus_session_set", { session: toNativeFocusSession(session) });
}

export async function readNativeFocusSession(): Promise<NativeFocusSession | null> {
  if (!isTauriRuntime()) return null;
  return await invoke<NativeFocusSession | null>("focus_session_get");
}

/** The break card's "Skip break", answered from the Companion (respondNativeMilestoneChoice). */
export function listenToFocusSessionCardChoice(onSkipBreak: () => void): () => void {
  return listenToShellEvent<{ readonly response?: unknown }>("watcher-peek-response", (payload) => {
    if (payload?.response === MILESTONE_CHOICE_RESPONSE_PREFIX + "focusSkipBreak") onSkipBreak();
  });
}

/** Listens to one Tauri event; returns a cleanup that is safe before the listener resolves. */
export function listenToShellEvent<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauriRuntime()) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listen<T>(event, (message) => handler(message.payload)).then((stop) => {
    if (disposed) cleanupTauriEventListener(stop);
    else unlisten = stop;
  }).catch(() => undefined);
  return () => {
    disposed = true;
    cleanupTauriEventListener(unlisten);
  };
}
