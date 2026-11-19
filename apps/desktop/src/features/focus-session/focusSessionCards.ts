import { formatLocalizedCompactDurationFromSeconds, formatStartOfDayOptionLabel, localeForDisplayLanguage } from "../../lib/formatting";
import type { CompanionPillMilestoneEvent } from "../companion/CompanionPillMoment";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { Translate } from "../localization/translate";
import { sessionPhases, type FocusSessionSummary } from "./focusSession";

function clockLabel(timestamp: number, language: DisplayLanguage): string {
  const date = new Date(timestamp);
  return formatStartOfDayOptionLabel(date.getHours() * 60 + date.getMinutes(), localeForDisplayLanguage(language));
}

/**
 * The Companion cards of a focus session (owner review 2026-11-19/20). The
 * menu bar and the title bar already show the time left and the round, so a
 * card only marks the change: a break is a teal card with its one choice,
 * Skip break; the next round is the same card in the accent with no choice.
 * The round dots are the only progress mark.
 */
export function buildFocusBreakCard(options: {
  readonly round: number;
  readonly rounds: number;
  readonly breakMinutes: number;
  /** When the break ends and the next round starts. */
  readonly endsAt: number;
  readonly language: DisplayLanguage;
  readonly translate: Translate;
  readonly now?: number;
}): CompanionPillMilestoneEvent {
  const now = options.now ?? Date.now();
  return {
    kind: "milestone",
    id: "focus-break-" + now,
    milestoneKind: "session",
    tier: 1,
    title: options.translate("focus.card.breakTitle", { minutes: options.breakMinutes }),
    subtitle: options.translate("focus.card.breakBody", { time: clockLabel(options.endsAt, options.language) }),
    destination: null,
    frame: "card",
    tone: "rest",
    progress: { done: options.round, total: options.rounds },
    choices: [{ id: "focusSkipBreak", label: options.translate("focus.card.choiceSkip") }],
    generatedAt: new Date(now).toISOString(),
  };
}

export function buildFocusRoundCard(options: {
  readonly round: number;
  readonly rounds: number;
  /** When this round ends. */
  readonly endsAt: number;
  readonly language: DisplayLanguage;
  readonly translate: Translate;
  readonly now?: number;
}): CompanionPillMilestoneEvent {
  const now = options.now ?? Date.now();
  return {
    kind: "milestone",
    id: "focus-round-" + now,
    milestoneKind: "session",
    tier: 1,
    title: options.translate("focus.card.roundTitle", { round: options.round, rounds: options.rounds }),
    subtitle: options.translate("focus.card.roundBody", { time: clockLabel(options.endsAt, options.language) }),
    destination: null,
    frame: "card",
    progress: { done: options.round, total: options.rounds },
    generatedAt: new Date(now).toISOString(),
  };
}

/**
 * One line of result and a way to today, as the same card as a break (owner
 * review 2026-11-18/20): the focus time is the figure beside the title,
 * written like every other duration in the app; the line under it says what
 * the session was; "오늘 보기" is its one action.
 */
export function buildFocusSummaryCard(done: FocusSessionSummary, language: DisplayLanguage, translate: Translate, now = Date.now()): CompanionPillMilestoneEvent {
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(Math.max(60, seconds), language);
  const elapsed = (done.endedAt - done.startedAt) / 1000;
  const total = duration(done.endedEarly ? elapsed : done.plannedSeconds);
  const anchor = done.anchorAt ?? done.startedAt;
  const rounds = sessionPhases(done.mode, anchor, done.startedAt + done.plannedSeconds * 1000, done.endedAt, done.plan)
    .filter((phase) => phase.kind === "focus").length;
  const parts = [done.mode === "pomodoro"
    ? translate("focus.card.doneRounds", { rounds, total })
    : done.endedEarly
      ? translate("focus.card.endedEarly", { elapsed: total })
      : translate("focus.card.doneSingle", { total })];
  if (done.alerts > 0) parts.push(translate("focus.card.doneAlerts", { count: done.alerts }));
  if (done.closes > 0) parts.push(translate("focus.card.doneCloses", { count: done.closes }));
  return {
    kind: "milestone",
    id: "focus-done-" + done.id,
    milestoneKind: "session",
    tier: done.endedEarly ? 1 : 2,
    title: translate("focus.card.doneTitle"),
    subtitle: parts.join(" · "),
    destination: "dashboard",
    frame: "card",
    statSeconds: done.focusSeconds,
    statLabel: translate("focus.card.statLabel"),
    generatedAt: new Date(now).toISOString(),
  };
}
