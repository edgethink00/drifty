import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * A focus session the user starts from the title bar or the menu bar
 * (feedback 23, 47 and 60; owner review 2026-11-17).
 *
 * One block runs for a chosen length; a pomodoro runs rounds of focus with
 * breaks between them (25 + 5 minutes × 4 unless the user chose another
 * plan), and each round starts on its own. While
 * a focus phase runs the cat is stricter; a break rests it. Sessions live on
 * this device only: the active one, the summary of the last one and a short
 * history the Day Breakdown lists. Nothing here is synced.
 */
export type FocusSessionMode = "single" | "pomodoro";

/** A pomodoro's rounds: focus and break lengths in minutes, and how many rounds. */
export type PomodoroPlan = {
  readonly focusMinutes: number;
  readonly breakMinutes: number;
  readonly rounds: number;
};

export type FocusSession = {
  readonly id: string;
  readonly mode: FocusSessionMode;
  readonly startedAt: number;
  readonly endsAt: number;
  /**
   * Where the pomodoro schedule counts from; the start until a break card's
   * "Skip break" moves the rest of the rounds.
   */
  readonly anchorAt?: number;
  /** A pomodoro's rounds; the classic plan when absent. */
  readonly plan?: PomodoroPlan;
  /** Today's focus seconds when the session started, for the summary. */
  readonly focusSecondsAtStart: number | null;
  /** Drift alerts and automatic closes delivered while it ran. */
  readonly alerts: number;
  readonly closes: number;
};

export type FocusSessionSummary = {
  readonly id: string;
  readonly mode: FocusSessionMode;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly plannedSeconds: number;
  readonly plan?: PomodoroPlan;
  readonly anchorAt?: number;
  readonly endedEarly: boolean;
  readonly focusSeconds: number | null;
  readonly alerts: number;
  readonly closes: number;
};

/** A finished session as the Day Breakdown lists it. */
export type FocusSessionRecord = {
  readonly id: string;
  readonly mode: FocusSessionMode;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly plan?: PomodoroPlan;
  readonly anchorAt?: number;
};

export type FocusPhase = {
  readonly kind: "focus" | "break";
  /** 1-based round; a single block is round 1 of 1. */
  readonly round: number;
  readonly rounds: number;
  readonly start: number;
  readonly end: number;
};

/** When the cat steps in: at any time, or only while a session runs. */
export type FocusCatScope = "always" | "session";

export const POMODORO: PomodoroPlan = { focusMinutes: 25, breakMinutes: 5, rounds: 4 };
/** The longer menu bar plan (owner review 2026-11-19: 50-minute blocks are common). */
export const POMODORO_LONG: PomodoroPlan = { focusMinutes: 50, breakMinutes: 10, rounds: 4 };
export const FOCUS_MIN_MINUTES = 5;
/**
 * A day at most (owner decision 2026-11-20): long enough for any working
 * day, and a forgotten session still ends on its own by the next one.
 */
export const FOCUS_MAX_MINUTES = 24 * 60;
/** Custom pomodoro limits; the menu bar refuses a session over a day or sixteen phases. */
export const POMODORO_LIMITS = {
  focus: { min: 5, max: 120 },
  break: { min: 1, max: 30 },
  rounds: { min: 1, max: 8 },
  totalMinutes: FOCUS_MAX_MINUTES,
} as const;
/** While focusing, the cat steps in after at most this long. */
export const FOCUS_DRIFT_ALERT_DELAY_SECONDS = 30;
/** Finished sessions kept for the Day Breakdown. */
const HISTORY_LIMIT = 200;
const HISTORY_DAYS = 60;

export const FOCUS_SESSION_STORAGE_KEY = "drifty.focusSession.v1";
export const FOCUS_CAT_SCOPE_STORAGE_KEY = "drifty.focusSession.catScope.v1";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type StoredState = {
  readonly active: FocusSession | null;
  readonly summary: FocusSessionSummary | null;
  readonly history: readonly FocusSessionRecord[];
};

const DEFAULT_MINUTES = 50;
const EMPTY: StoredState = { active: null, summary: null, history: [] };

export function pomodoroPlanMinutes(plan: PomodoroPlan): number {
  return plan.rounds * plan.focusMinutes + (plan.rounds - 1) * plan.breakMinutes;
}

export function plannedSessionMinutes(mode: FocusSessionMode, minutes: number, plan: PomodoroPlan = POMODORO): number {
  if (mode === "pomodoro") return pomodoroPlanMinutes(plan);
  return clampMinutes(minutes);
}

/** A plan inside the limits, or null when it cannot run as given. */
export function validPomodoroPlan(plan: PomodoroPlan): PomodoroPlan | null {
  const whole = (value: number, range: { readonly min: number; readonly max: number }) =>
    Number.isInteger(value) && value >= range.min && value <= range.max;
  if (!whole(plan.focusMinutes, POMODORO_LIMITS.focus) || !whole(plan.breakMinutes, POMODORO_LIMITS.break) || !whole(plan.rounds, POMODORO_LIMITS.rounds)) return null;
  if (pomodoroPlanMinutes(plan) > POMODORO_LIMITS.totalMinutes) return null;
  return { focusMinutes: plan.focusMinutes, breakMinutes: plan.breakMinutes, rounds: plan.rounds };
}

function readPlan(value: unknown): PomodoroPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!finite(raw.focusMinutes) || !finite(raw.breakMinutes) || !finite(raw.rounds)) return undefined;
  return validPomodoroPlan({ focusMinutes: raw.focusMinutes, breakMinutes: raw.breakMinutes, rounds: raw.rounds }) ?? undefined;
}

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_MINUTES;
  return Math.min(FOCUS_MAX_MINUTES, Math.max(FOCUS_MIN_MINUTES, Math.round(minutes)));
}

/** Every phase of a session from its start, cut at `until` (its end by default). */
export function sessionPhases(mode: FocusSessionMode, startedAt: number, endsAt: number, until = endsAt, plan: PomodoroPlan = POMODORO): FocusPhase[] {
  const stop = Math.min(until, endsAt);
  if (stop <= startedAt) return [];
  if (mode === "single") return [{ kind: "focus", round: 1, rounds: 1, start: startedAt, end: stop }];
  const phases: FocusPhase[] = [];
  let cursor = startedAt;
  for (let round = 1; round <= plan.rounds && cursor < stop; round += 1) {
    const focusEnd = Math.min(cursor + plan.focusMinutes * MINUTE, stop);
    phases.push({ kind: "focus", round, rounds: plan.rounds, start: cursor, end: focusEnd });
    cursor = focusEnd;
    if (round === plan.rounds || cursor >= stop) break;
    const breakEnd = Math.min(cursor + plan.breakMinutes * MINUTE, stop);
    phases.push({ kind: "break", round, rounds: plan.rounds, start: cursor, end: breakEnd });
    cursor = breakEnd;
  }
  return phases;
}

/** The running session's phases, counted from its schedule anchor. */
export function activeSessionPhases(session: FocusSession): FocusPhase[] {
  return sessionPhases(session.mode, session.anchorAt ?? session.startedAt, session.endsAt, session.endsAt, session.plan);
}

export function focusPhaseAt(session: FocusSession, now: number): FocusPhase | null {
  if (now < session.startedAt || now >= session.endsAt) return null;
  return activeSessionPhases(session).find((phase) => now >= phase.start && now < phase.end) ?? null;
}

export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ── What a session changes in the cat ────────────────────────────────── */

export type FocusCatEffect = {
  readonly phase: "focus" | "break" | null;
  /** Drift alerts and automatic close may act at all. */
  readonly catAllowed: boolean;
  /** A focus phase turns drift alerts on even when their switch is off. */
  readonly alertsForced: boolean;
  /** A focus phase steps in sooner than the saved alert timing. */
  readonly delayCapSeconds: number | null;
  /** A focus phase is not paused by quiet hours. */
  readonly quietHoursBypassed: boolean;
  /** The next moment this answer can change, or null. */
  readonly changesAt: number | null;
};

export function focusCatEffect(session: FocusSession | null, scope: FocusCatScope, now: number): FocusCatEffect {
  const phase = session ? focusPhaseAt(session, now) : null;
  if (phase?.kind === "focus") {
    return { phase: "focus", catAllowed: true, alertsForced: true, delayCapSeconds: FOCUS_DRIFT_ALERT_DELAY_SECONDS, quietHoursBypassed: true, changesAt: phase.end };
  }
  if (phase?.kind === "break") {
    return { phase: "break", catAllowed: false, alertsForced: false, delayCapSeconds: null, quietHoursBypassed: false, changesAt: phase.end };
  }
  const startsLater = session && now < session.startedAt ? session.startedAt : null;
  return { phase: null, catAllowed: scope === "always", alertsForced: false, delayCapSeconds: null, quietHoursBypassed: false, changesAt: startsLater };
}

/* ── Store ────────────────────────────────────────────────────────────── */

const listeners = new Set<() => void>();
let state: StoredState | null = null;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMode(value: unknown): value is FocusSessionMode {
  return value === "single" || value === "pomodoro";
}

function readSession(value: unknown): FocusSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !isMode(raw.mode) || !finite(raw.startedAt) || !finite(raw.endsAt) || raw.endsAt <= raw.startedAt) return null;
  const plan = raw.mode === "pomodoro" ? readPlan(raw.plan) : undefined;
  return {
    id: raw.id,
    mode: raw.mode,
    startedAt: raw.startedAt,
    endsAt: raw.endsAt,
    ...(finite(raw.anchorAt) ? { anchorAt: raw.anchorAt } : {}),
    ...(plan ? { plan } : {}),
    focusSecondsAtStart: finite(raw.focusSecondsAtStart) ? raw.focusSecondsAtStart : null,
    alerts: finite(raw.alerts) ? raw.alerts : 0,
    closes: finite(raw.closes) ? raw.closes : 0,
  };
}

function readRecord(value: unknown): FocusSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !isMode(raw.mode) || !finite(raw.startedAt) || !finite(raw.endedAt) || raw.endedAt <= raw.startedAt) return null;
  const plan = raw.mode === "pomodoro" ? readPlan(raw.plan) : undefined;
  return {
    id: raw.id,
    mode: raw.mode,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    ...(plan ? { plan } : {}),
    ...(finite(raw.anchorAt) ? { anchorAt: raw.anchorAt } : {}),
  };
}

function read(): StoredState {
  if (state) return state;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(FOCUS_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const history = Array.isArray(parsed.history) ? parsed.history.map(readRecord).filter((record): record is FocusSessionRecord => record !== null) : [];
    state = {
      active: readSession(parsed.active),
      summary: parsed.summary && typeof parsed.summary === "object" ? parsed.summary as FocusSessionSummary : null,
      history,
    };
  } catch {
    state = EMPTY;
  }
  return state;
}

function write(next: StoredState) {
  state = next;
  try {
    window.localStorage.setItem(FOCUS_SESSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The session still runs for this launch.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readFocusSessionState(): StoredState {
  return read();
}

export function startFocusSession(options: {
  readonly mode: FocusSessionMode;
  readonly minutes: number;
  /** A pomodoro's rounds; the classic plan by default. */
  readonly plan?: PomodoroPlan;
  readonly now?: number;
  readonly focusSecondsNow?: number | null;
}): FocusSession {
  const now = options.now ?? Date.now();
  const current = read();
  const finished = current.active ? finishedState(current, now, options.focusSecondsNow ?? null) : current;
  const plan = options.mode === "pomodoro" ? (options.plan && validPomodoroPlan(options.plan)) || POMODORO : undefined;
  const session: FocusSession = {
    id: `focus-${now.toString(36)}`,
    mode: options.mode,
    startedAt: now,
    endsAt: now + plannedSessionMinutes(options.mode, options.minutes, plan) * MINUTE,
    ...(plan ? { plan } : {}),
    focusSecondsAtStart: typeof options.focusSecondsNow === "number" ? options.focusSecondsNow : null,
    alerts: 0,
    closes: 0,
  };
  write({ ...finished, active: session, summary: null });
  return session;
}

export function recordFocusBaseline(id: string, focusSeconds: number): void {
  const current = read();
  if (!current.active || current.active.id !== id || current.active.focusSecondsAtStart !== null) return;
  write({ ...current, active: { ...current.active, focusSecondsAtStart: focusSeconds } });
}

/** Counts an alert or an automatic close against a running focus phase. */
export function noteFocusSessionIntervention(kind: "alert" | "close", now = Date.now()): void {
  const current = read();
  const session = current.active;
  if (!session || focusPhaseAt(session, now)?.kind !== "focus") return;
  write({ ...current, active: kind === "alert" ? { ...session, alerts: session.alerts + 1 } : { ...session, closes: session.closes + 1 } });
}

function shiftSchedule(current: StoredState, session: FocusSession, deltaMs: number) {
  write({ ...current, active: { ...session, anchorAt: (session.anchorAt ?? session.startedAt) + deltaMs, endsAt: session.endsAt + deltaMs } });
}

/** The break card's "Skip break": the next round starts now. Returns that round. */
export function skipFocusBreak(now = Date.now()): number | null {
  const current = read();
  const session = current.active;
  const phase = session ? focusPhaseAt(session, now) : null;
  if (!session || !phase || phase.kind !== "break") return null;
  shiftSchedule(current, session, now - phase.end);
  return phase.round + 1;
}

function finishedState(current: StoredState, now: number, focusSecondsNow: number | null): StoredState {
  const session = current.active;
  if (!session) return current;
  const endedAt = Math.max(session.startedAt + 1, Math.min(now, session.endsAt));
  const elapsedSeconds = (endedAt - session.startedAt) / 1000;
  const focusSeconds = session.focusSecondsAtStart !== null && typeof focusSecondsNow === "number"
    ? Math.max(0, Math.min(focusSecondsNow - session.focusSecondsAtStart, elapsedSeconds))
    : null;
  const summary: FocusSessionSummary = {
    id: session.id,
    mode: session.mode,
    startedAt: session.startedAt,
    endedAt,
    plannedSeconds: Math.round((session.endsAt - session.startedAt) / 1000),
    ...(session.plan ? { plan: session.plan } : {}),
    ...(session.anchorAt !== undefined ? { anchorAt: session.anchorAt } : {}),
    endedEarly: now < session.endsAt,
    focusSeconds,
    alerts: session.alerts,
    closes: session.closes,
  };
  const record: FocusSessionRecord = {
    id: session.id,
    mode: session.mode,
    startedAt: session.startedAt,
    endedAt,
    ...(session.plan ? { plan: session.plan } : {}),
    ...(session.anchorAt !== undefined ? { anchorAt: session.anchorAt } : {}),
  };
  const history = [...current.history.filter((entry) => entry.id !== record.id && entry.endedAt > now - HISTORY_DAYS * DAY), record].slice(-HISTORY_LIMIT);
  return { ...current, active: null, summary, history };
}

/** Ends the running session (early or on time) and keeps its summary. */
export function endFocusSession(options: { readonly now?: number; readonly focusSecondsNow?: number | null } = {}): FocusSessionSummary | null {
  const current = read();
  if (!current.active) return null;
  const next = finishedState(current, options.now ?? Date.now(), options.focusSecondsNow ?? null);
  write(next);
  return next.summary;
}

export function dismissFocusSummary(): void {
  const current = read();
  if (current.summary) write({ ...current, summary: null });
}

export function useFocusSessionState(): StoredState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** A clock that ticks every second while a session runs; only small views use it. */
export function useFocusSessionClock(): { readonly session: FocusSession | null; readonly now: number } {
  const { active } = useFocusSessionState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return { session: active, now };
}

/* ── Last custom choice ───────────────────────────────────────────────── */

export const FOCUS_CUSTOM_STORAGE_KEY = "drifty.focusSession.custom.v1";

export type FocusCustomChoice = { readonly minutes: number; readonly plan: PomodoroPlan };

/** What the custom dialog opens with: the last values the user started. */
export function readFocusCustomChoice(): FocusCustomChoice {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FOCUS_CUSTOM_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return {
      minutes: finite(raw.minutes) ? clampMinutes(raw.minutes) : 45,
      plan: readPlan(raw.plan) ?? POMODORO,
    };
  } catch {
    return { minutes: 45, plan: POMODORO };
  }
}

export function saveFocusCustomChoice(choice: Partial<FocusCustomChoice>): void {
  try {
    window.localStorage.setItem(FOCUS_CUSTOM_STORAGE_KEY, JSON.stringify({ ...readFocusCustomChoice(), ...choice }));
  } catch {
    // The dialog opens with the defaults next time.
  }
}

/* ── Cat scope preference ─────────────────────────────────────────────── */

const scopeListeners = new Set<() => void>();
let scope: FocusCatScope | null = null;

function readScope(): FocusCatScope {
  if (scope) return scope;
  try {
    scope = window.localStorage.getItem(FOCUS_CAT_SCOPE_STORAGE_KEY) === "session" ? "session" : "always";
  } catch {
    scope = "always";
  }
  return scope;
}

export function setFocusCatScope(next: FocusCatScope): void {
  scope = next;
  try {
    window.localStorage.setItem(FOCUS_CAT_SCOPE_STORAGE_KEY, next);
  } catch {
    // Applies for this launch.
  }
  scopeListeners.forEach((listener) => listener());
}

export function useFocusCatScope(): FocusCatScope {
  return useSyncExternalStore((listener) => {
    scopeListeners.add(listener);
    return () => scopeListeners.delete(listener);
  }, readScope, () => "always");
}

/**
 * What the cat may do now. Re-renders only when the answer changes (a phase
 * boundary or a new session), so the main window does not tick every second.
 */
export function useFocusCatEffect(): FocusCatEffect {
  const { active } = useFocusSessionState();
  const catScope = useFocusCatScope();
  const [now, setNow] = useState(() => Date.now());
  const effect = focusCatEffect(active, catScope, now);
  useEffect(() => {
    if (effect.changesAt === null) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, effect.changesAt - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [effect.changesAt]);
  useEffect(() => {
    setNow(Date.now());
  }, [active, catScope]);
  return effect;
}

export function resetFocusSessionForTests(): void {
  state = null;
  scope = null;
  listeners.forEach((listener) => listener());
  scopeListeners.forEach((listener) => listener());
}
