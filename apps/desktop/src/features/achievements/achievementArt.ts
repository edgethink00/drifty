import { localeForDisplayLanguage } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { AchievementGroup, AchievementId } from "./achievementCatalog";

export type AchievementArtState = "earned" | "locked" | "concealed";

/** The figure an achievement is known by: its goal, written the way a clock or a counter would show it. */
export type AchievementMark = { readonly text: string; readonly unit?: string };

export type AchievementArtProps = {
  readonly id: AchievementId;
  readonly group: AchievementGroup;
  readonly state: AchievementArtState;
  /** False at the smallest size, where fine detail would only blur. */
  readonly detail: boolean;
  readonly mark: AchievementMark;
  /** The day it was last earned, as MM.DD. */
  readonly day: string | null;
};

const MARKS: Record<Exclude<AchievementId, "weekendShift">, AchievementMark> = {
  firstFlow: { text: "25", unit: "m" },
  flow90: { text: "90", unit: "m" },
  flow180: { text: "3", unit: "h" },
  focusDay8h: { text: "8", unit: "h" },
  earlyStart: { text: "5:00" },
  nightOwl: { text: "2:00" },
  streak7: { text: "7" },
  streak30: { text: "30" },
  focus100h: { text: "100", unit: "h" },
  driftDay: { text: "50", unit: "%" },
  noDriftDay: { text: "0", unit: "m" },
  comeback: { text: "4", unit: "h" },
};

export const CONCEALED_MARK: AchievementMark = { text: "?" };

export function achievementMark(id: AchievementId, language: DisplayLanguage): AchievementMark {
  if (id !== "weekendShift") return MARKS[id];
  // Saturday and Sunday as the language abbreviates them; 3 January 2026 is a Saturday.
  const weekday = new Intl.DateTimeFormat(localeForDisplayLanguage(language), { weekday: "narrow" });
  return { text: weekday.format(new Date(2026, 0, 3, 12)) + "·" + weekday.format(new Date(2026, 0, 4, 12)) };
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
