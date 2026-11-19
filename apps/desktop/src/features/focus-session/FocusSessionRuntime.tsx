import { useEffect, useRef, useState } from "react";
import { ModalPresence } from "../../components/ModalPresence";
import { showNativeCompanionMilestone } from "../companion/watcherBridge";
import { useLocalization } from "../localization/LocalizationContext";
import {
  POMODORO,
  POMODORO_LONG,
  endFocusSession,
  focusPhaseAt,
  readFocusSessionState,
  recordFocusBaseline,
  saveFocusCustomChoice,
  skipFocusBreak,
  startFocusSession,
  useFocusSessionState,
  type FocusSessionMode,
  type FocusSessionSummary,
  type PomodoroPlan,
} from "./focusSession";
import { buildFocusBreakCard, buildFocusRoundCard, buildFocusSummaryCard } from "./focusSessionCards";
import { FocusSessionCustomDialog } from "./FocusSessionCustomDialog";
import { FOCUS_SESSION_TRAY_EVENTS, listenToFocusSessionCardChoice, listenToShellEvent, publishNativeFocusSession } from "./focusSessionBridge";

/** A phase change is announced only when it happened just now, not on a late reload. */
const ANNOUNCE_WINDOW_MS = 90_000;
const ANNOUNCED_STORAGE_KEY = "drifty.focusSession.announced.v1";

function alreadyAnnounced(key: string): boolean {
  try {
    if (window.localStorage.getItem(ANNOUNCED_STORAGE_KEY) === key) return true;
    window.localStorage.setItem(ANNOUNCED_STORAGE_KEY, key);
  } catch {
    // Announce at most once per launch instead.
  }
  return false;
}

/**
 * The running session's side effects, mounted once in the main window: the
 * focus baseline, the end on time, the break and round cards, the summary
 * card, the menu bar's copy and the menu bar's start and end choices.
 */
export function FocusSessionRuntime({ focusSecondsToday }: { readonly focusSecondsToday: number | null }) {
  const { effectiveLanguage, t } = useLocalization();
  const { active, summary } = useFocusSessionState();
  const focusRef = useRef(focusSecondsToday);
  focusRef.current = focusSecondsToday;
  const copyRef = useRef({ language: effectiveLanguage, t });
  copyRef.current = { language: effectiveLanguage, t };
  const [customMode, setCustomMode] = useState<FocusSessionMode | null>(null);

  useEffect(() => {
    if (active && active.focusSecondsAtStart === null && typeof focusSecondsToday === "number") {
      recordFocusBaseline(active.id, focusSecondsToday);
    }
  }, [active, focusSecondsToday]);

  // The menu bar shows what the renderer runs, including after a relaunch.
  useEffect(() => {
    void publishNativeFocusSession(active).catch((error: unknown) => {
      console.warn("Could not update the menu bar focus session", error);
    });
  }, [active]);

  // End on time, and announce each pomodoro boundary as it passes.
  useEffect(() => {
    if (!active) return undefined;
    let timer: number | undefined;
    const tick = () => {
      const now = Date.now();
      const current = readFocusSessionState().active;
      if (!current || current.id !== active.id) return;
      if (now >= current.endsAt) {
        endFocusSession({ now, focusSecondsNow: focusRef.current });
        return;
      }
      const phase = focusPhaseAt(current, now);
      if (phase && current.mode === "pomodoro" && now - phase.start < ANNOUNCE_WINDOW_MS && phase.start > current.startedAt) {
        const key = current.id + ":" + phase.kind + ":" + phase.round;
        if (!alreadyAnnounced(key)) announcePhase(phase.kind, phase.round, phase.rounds, phase.end, current.plan ?? POMODORO);
      }
      const next = phase ? phase.end : current.endsAt;
      timer = window.setTimeout(tick, Math.max(250, next - now + 50));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!summary || Date.now() - summary.endedAt > ANNOUNCE_WINDOW_MS) return;
    if (alreadyAnnounced(summary.id + ":done")) return;
    announceSummary(summary);
  }, [summary]);

  // Menu bar choices.
  useEffect(() => {
    const start = (minutes: number) => () => {
      startFocusSession({ mode: "single", minutes, focusSecondsNow: focusRef.current });
    };
    const startPomodoro = (plan: PomodoroPlan) => () => {
      startFocusSession({ mode: "pomodoro", minutes: plan.focusMinutes, plan, focusSecondsNow: focusRef.current });
    };
    const stops = [
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.start30, start(30)),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.start60, start(60)),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.start120, start(120)),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.start240, start(240)),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.startCustom, () => setCustomMode("single")),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.startPomodoro, startPomodoro(POMODORO)),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.startPomodoro50, startPomodoro(POMODORO_LONG)),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.startPomodoroCustom, () => setCustomMode("pomodoro")),
      listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.end, () => endFocusSession({ focusSecondsNow: focusRef.current })),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  // The break card's "Skip break" starts the next round at once, so that
  // round's own card would only repeat the tap.
  useEffect(() => {
    const skip = () => {
      const round = skipFocusBreak();
      const current = readFocusSessionState().active;
      if (round !== null && current) alreadyAnnounced(current.id + ":focus:" + round);
    };
    const stops = [listenToFocusSessionCardChoice(skip), listenToShellEvent(FOCUS_SESSION_TRAY_EVENTS.skipBreak, skip)];
    return () => stops.forEach((stop) => stop());
  }, []);

  /** A break or the next round; endsAt is when that phase ends (focusSessionCards.ts). */
  function announcePhase(kind: "focus" | "break", round: number, rounds: number, endsAt: number, plan: PomodoroPlan) {
    const { language, t: translate } = copyRef.current;
    const event = kind === "break"
      ? buildFocusBreakCard({ round, rounds, breakMinutes: plan.breakMinutes, endsAt, language, translate })
      : buildFocusRoundCard({ round, rounds, endsAt, language, translate });
    void showNativeCompanionMilestone(event).catch((error: unknown) => {
      console.warn("Could not show the focus session card", error);
    });
  }

  function announceSummary(done: FocusSessionSummary) {
    const { language, t: translate } = copyRef.current;
    void showNativeCompanionMilestone(buildFocusSummaryCard(done, language, translate)).catch((error: unknown) => {
      console.warn("Could not show the focus session summary", error);
    });
  }

  return (
    <ModalPresence>
      {customMode ? (
        <FocusSessionCustomDialog
          mode={customMode}
          onClose={() => setCustomMode(null)}
          onStart={(choice) => {
            if (choice.mode === "single") {
              saveFocusCustomChoice({ minutes: choice.minutes });
              startFocusSession({ mode: "single", minutes: choice.minutes, focusSecondsNow: focusRef.current });
            } else {
              saveFocusCustomChoice({ plan: choice.plan });
              startFocusSession({ mode: "pomodoro", minutes: choice.plan.focusMinutes, plan: choice.plan, focusSecondsNow: focusRef.current });
            }
            setCustomMode(null);
          }}
        />
      ) : null}
    </ModalPresence>
  );
}
