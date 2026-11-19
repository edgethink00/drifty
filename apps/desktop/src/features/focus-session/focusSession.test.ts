// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  endFocusSession,
  focusCatEffect,
  focusPhaseAt,
  noteFocusSessionIntervention,
  readFocusSessionState,
  POMODORO_LONG,
  readFocusCustomChoice,
  resetFocusSessionForTests,
  saveFocusCustomChoice,
  sessionPhases,
  validPomodoroPlan,
  skipFocusBreak,
  startFocusSession,
  type FocusSession,
} from "./focusSession";
import { focusSessionBands } from "./focusSessionBands";
import { toNativeFocusSession } from "./focusSessionBridge";

const MINUTE = 60_000;
const START = new Date(2026, 10, 17, 14, 0).getTime();

function pomodoro(): FocusSession {
  return { id: "s", mode: "pomodoro", startedAt: START, endsAt: START + 115 * MINUTE, focusSecondsAtStart: 0, alerts: 0, closes: 0 };
}

beforeEach(() => {
  window.localStorage.clear();
  resetFocusSessionForTests();
});

describe("focus session phases", () => {
  it("lays a pomodoro out as four 25-minute rounds with three 5-minute breaks", () => {
    const phases = sessionPhases("pomodoro", START, START + 115 * MINUTE);
    expect(phases.map((phase) => phase.kind + phase.round + ":" + (phase.end - phase.start) / MINUTE)).toEqual([
      "focus1:25", "break1:5", "focus2:25", "break2:5", "focus3:25", "break3:5", "focus4:25",
    ]);
  });

  it("cuts the phases where a session ended early", () => {
    const phases = sessionPhases("pomodoro", START, START + 115 * MINUTE, START + 40 * MINUTE);
    expect(phases.map((phase) => phase.kind + phase.round)).toEqual(["focus1", "break1", "focus2"]);
    expect(phases[phases.length - 1]?.end).toBe(START + 40 * MINUTE);
  });
});

describe("pomodoro plans", () => {
  it("runs the longer plan and a custom plan with their own lengths", () => {
    const long = startFocusSession({ mode: "pomodoro", minutes: 50, plan: POMODORO_LONG, now: START });
    expect(long.endsAt - START).toBe(230 * MINUTE);
    const custom = startFocusSession({ mode: "pomodoro", minutes: 40, plan: { focusMinutes: 40, breakMinutes: 8, rounds: 3 }, now: START });
    expect(custom.endsAt - START).toBe((3 * 40 + 2 * 8) * MINUTE);
    expect(focusPhaseAt(custom, START + 41 * MINUTE)).toMatchObject({ kind: "break", round: 1, rounds: 3, end: START + 48 * MINUTE });
  });

  it("refuses a plan past the limits instead of starting something else", () => {
    expect(validPomodoroPlan({ focusMinutes: 50, breakMinutes: 10, rounds: 8 })).toEqual({ focusMinutes: 50, breakMinutes: 10, rounds: 8 });
    expect(validPomodoroPlan({ focusMinutes: 25, breakMinutes: 5, rounds: 9 })).toBeNull();
    expect(validPomodoroPlan({ focusMinutes: 4, breakMinutes: 5, rounds: 4 })).toBeNull();
    expect(validPomodoroPlan({ focusMinutes: 60, breakMinutes: 0, rounds: 4 })).toBeNull();
    expect(validPomodoroPlan({ focusMinutes: 30, breakMinutes: 10, rounds: 6 })).toEqual({ focusMinutes: 30, breakMinutes: 10, rounds: 6 });
  });

  it("keeps a running session's plan and skipped break across a reload", () => {
    startFocusSession({ mode: "pomodoro", minutes: 50, plan: POMODORO_LONG, now: START });
    skipFocusBreak(START + 52 * MINUTE);
    resetFocusSessionForTests();
    const session = readFocusSessionState().active!;
    expect(session.plan).toEqual(POMODORO_LONG);
    expect(focusPhaseAt(session, START + 53 * MINUTE)).toMatchObject({ kind: "focus", round: 2, start: START + 52 * MINUTE });
  });

  it("remembers the last custom choice for the dialog", () => {
    expect(readFocusCustomChoice()).toEqual({ minutes: 45, plan: { focusMinutes: 25, breakMinutes: 5, rounds: 4 } });
    saveFocusCustomChoice({ minutes: 70 });
    saveFocusCustomChoice({ plan: { focusMinutes: 40, breakMinutes: 8, rounds: 3 } });
    expect(readFocusCustomChoice()).toEqual({ minutes: 70, plan: { focusMinutes: 40, breakMinutes: 8, rounds: 3 } });
  });
});

describe("skipping a break", () => {
  it("starts the next round at once when the break is skipped", () => {
    startFocusSession({ mode: "pomodoro", minutes: 25, now: START });
    const atBreak = START + 26 * MINUTE;
    expect(skipFocusBreak(atBreak)).toBe(2);
    const session = readFocusSessionState().active!;
    expect(focusPhaseAt(session, atBreak)).toMatchObject({ kind: "focus", round: 2, start: atBreak, end: atBreak + 25 * MINUTE });
    expect(session.startedAt).toBe(START);
    expect(session.endsAt - START).toBe(111 * MINUTE);
  });

  it("keeps the menu bar's copy inside the session after a skip", () => {
    startFocusSession({ mode: "pomodoro", minutes: 25, now: START });
    skipFocusBreak(START + 26 * MINUTE);
    const native = toNativeFocusSession(readFocusSessionState().active)!;
    expect(native.phases[0]?.startMs).toBe(START);
    native.phases.forEach((phase, index) => {
      expect(phase.endMs).toBeGreaterThan(phase.startMs);
      if (index > 0) expect(phase.startMs).toBeGreaterThanOrEqual(native.phases[index - 1]!.endMs);
    });
    expect(native.phases[native.phases.length - 1]?.endMs).toBe(native.endsAtMs);
  });

  it("does nothing to skip outside a break", () => {
    startFocusSession({ mode: "pomodoro", minutes: 25, now: START });
    expect(skipFocusBreak(START + MINUTE)).toBeNull();
  });
});

describe("what a session lets the cat do", () => {
  it("makes a focus phase strict, past quiet hours and with alerts on", () => {
    const effect = focusCatEffect(pomodoro(), "always", START + 10 * MINUTE);
    expect(effect).toMatchObject({ phase: "focus", catAllowed: true, alertsForced: true, delayCapSeconds: 30, quietHoursBypassed: true });
    expect(effect.changesAt).toBe(START + 25 * MINUTE);
  });

  it("rests the cat during a pomodoro break, whatever the scope", () => {
    for (const scope of ["always", "session"] as const) {
      expect(focusCatEffect(pomodoro(), scope, START + 27 * MINUTE)).toMatchObject({ phase: "break", catAllowed: false, alertsForced: false });
    }
  });

  it("leaves the cat as it was outside a session unless the user chose sessions only", () => {
    expect(focusCatEffect(null, "always", START)).toMatchObject({ phase: null, catAllowed: true, alertsForced: false, delayCapSeconds: null });
    expect(focusCatEffect(null, "session", START)).toMatchObject({ phase: null, catAllowed: false });
    expect(focusCatEffect(pomodoro(), "session", START + 116 * MINUTE)).toMatchObject({ phase: null, catAllowed: false });
  });
});

describe("running and ending a session", () => {
  it("counts interventions only while focusing and summarizes the focus gained", () => {
    startFocusSession({ mode: "pomodoro", minutes: 25, now: START, focusSecondsNow: 1_000 });
    noteFocusSessionIntervention("alert", START + 5 * MINUTE);
    noteFocusSessionIntervention("close", START + 6 * MINUTE);
    noteFocusSessionIntervention("alert", START + 27 * MINUTE);
    const summary = endFocusSession({ now: START + 115 * MINUTE, focusSecondsNow: 1_000 + 91 * 60 });
    expect(summary).toMatchObject({ mode: "pomodoro", endedEarly: false, focusSeconds: 91 * 60, alerts: 1, closes: 1, plannedSeconds: 115 * 60 });
    expect(readFocusSessionState().history).toEqual([{
      id: summary?.id,
      mode: "pomodoro",
      startedAt: START,
      endedAt: START + 115 * MINUTE,
      plan: { focusMinutes: 25, breakMinutes: 5, rounds: 4 },
    }]);
  });

  it("runs a single block for up to a day", () => {
    expect(startFocusSession({ mode: "single", minutes: 24 * 60, now: START }).endsAt - START).toBe(24 * 60 * MINUTE);
    expect(startFocusSession({ mode: "single", minutes: 30 * 60, now: START }).endsAt - START).toBe(24 * 60 * MINUTE);
  });

  it("never claims more focus than the time the session ran", () => {
    startFocusSession({ mode: "single", minutes: 50, now: START, focusSecondsNow: 0 });
    const summary = endFocusSession({ now: START + 20 * MINUTE, focusSecondsNow: 3 * 60 * 60 });
    expect(summary).toMatchObject({ endedEarly: true, focusSeconds: 20 * 60 });
  });
});

describe("day session phases", () => {
  it("draws a pomodoro's focus rounds on its logical day, leaving the breaks as gaps", () => {
    const bands = focusSessionBands([{ id: "s", mode: "pomodoro", startedAt: START, endedAt: START + 115 * MINUTE }], "2026-11-17", 0);
    expect(bands.map((band) => [band.top, band.bottom])).toEqual([[840, 865], [870, 895], [900, 925], [930, 955]]);
  });

  it("leaves out sessions from other days", () => {
    expect(focusSessionBands([{ id: "s", mode: "single", startedAt: START, endedAt: START + 50 * MINUTE }], "2026-11-16", 0)).toEqual([]);
  });
});
