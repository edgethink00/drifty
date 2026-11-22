import type { AchievementGroup, AchievementId } from "./achievementCatalog";

export type AchievementArtState = "earned" | "locked" | "concealed";

/** A short figure with an optional unit set smaller beside it. */
export type AchievementFigure = { readonly text: string; readonly unit?: string };

export type AchievementArtProps = {
  readonly id: AchievementId;
  readonly group: AchievementGroup;
  readonly state: AchievementArtState;
  /** False at the smallest size, where fine detail would only blur. */
  readonly detail: boolean;
  /** The goal, for marks that show what is still to reach. */
  readonly goal: AchievementFigure;
  /** The person's own figure from the day it was earned. */
  readonly record: AchievementFigure | null;
  /** The day it was earned in quarter hours (f, n, d or .), when kept. */
  readonly shape: string | null;
  /** How far toward the goal, or for an earned repeatable one toward its next milestone, 0 to 1. */
  readonly progress: number;
  /** Milestones reached so far (1, 5, 10, 25, 50, 100), 0 until earned. */
  readonly tier: number;
};

export const ACHIEVEMENT_GOALS: Record<AchievementId, AchievementFigure> = {
  firstFlow: { text: "25", unit: "m" },
  flow90: { text: "90", unit: "m" },
  flow180: { text: "3", unit: "h" },
  focusDay8h: { text: "8", unit: "h" },
  earlyStart: { text: "30", unit: "m" },
  nightOwl: { text: "30", unit: "m" },
  weekendShift: { text: "2", unit: "h" },
  streak7: { text: "7" },
  streak30: { text: "30" },
  focus100h: { text: "100", unit: "h" },
  driftDay: { text: "50", unit: "%" },
  noDriftDay: { text: "0", unit: "m" },
  comeback: { text: "4", unit: "h" },
};

export const CONCEALED_FIGURE: AchievementFigure = { text: "?" };

/** Hours under ten keep one decimal; under an hour it reads in minutes. */
export function durationFigure(seconds: number): AchievementFigure {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { text: String(minutes), unit: "m" };
  const hours = seconds / 3600;
  return hours < 10 ? { text: (Math.floor(hours * 10) / 10).toFixed(1), unit: "h" } : { text: String(Math.floor(hours)), unit: "h" };
}

const TURN = Math.PI * 2;

/** A point on the 100 × 100 badge grid, measured in turns clockwise from twelve o'clock. */
export function dialPoint(radius: number, turn: number): readonly [number, number] {
  const angle = turn * TURN - Math.PI / 2;
  return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)];
}

/** A clockwise arc between two turns, at most one full turn long. */
export function dialArc(radius: number, from: number, to: number): string {
  const span = Math.min(to - from, 0.9999);
  const start = dialPoint(radius, from);
  const end = dialPoint(radius, from + span);
  return "M" + start[0].toFixed(2) + " " + start[1].toFixed(2)
    + "A" + radius + " " + radius + " 0 " + (span > 0.5 ? 1 : 0) + " 1 " + end[0].toFixed(2) + " " + end[1].toFixed(2);
}
