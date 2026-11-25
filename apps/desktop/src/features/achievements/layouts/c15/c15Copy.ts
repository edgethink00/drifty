import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { achievementDay, shownRarity } from "../../achievementCopy";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";

/** Held by fewer than this share of users, an achievement counts as rare: its share turns gold and the summary counts it. */
export const RARE_BELOW_PERCENT = 10;

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for the right edge of a row. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

/** "40th", "40번째", "40.": which time an earned day was. */
export function ordinal(count: number, t: Translate, language: DisplayLanguage): string {
  const rule = language === "en" ? new Intl.PluralRules("en", { type: "ordinal" }).select(count) : "other";
  const key = (["one", "two", "few"].includes(rule) ? "achievements.c15.nth." + rule : "achievements.c15.nth.other") as TranslationKey;
  return t(key, { count });
}

/**
 * The one strong fact on a row's right edge: the share of users who hold it
 * when rarity is known, in plain numbers with no tier names; otherwise ×count over the latest day for a
 * repeat, or the day it was earned. Nothing for a locked one without rarity.
 */
export type RowFact = {
  readonly figure: string;
  readonly word: string;
  readonly kind: "rarity" | "count" | "day";
  /** Rare ones (under RARE_BELOW_PERCENT) set their figure in gold. */
  readonly notable: boolean;
};

export function rowFact(item: AchievementItem, t: Translate, language: DisplayLanguage): RowFact | null {
  const rarity = shownRarity(item);
  if (rarity) {
    return {
      figure: t("achievements.c15.percent", { percent: formatRarityPercent(rarity.percent, language) }),
      word: t("achievements.c15.whoHas"),
      kind: "rarity",
      notable: rarity.percent < RARE_BELOW_PERCENT,
    };
  }
  const earned = item.earned;
  if (!earned) return null;
  const day = shortDay(achievementDay(item) ?? earned.firstDay, language);
  if (item.definition.repeatable && earned.count > 1) return { figure: "×" + earned.count, word: day, kind: "count", notable: false };
  return { figure: day, word: t("achievements.stat.earnedOn"), kind: "day", notable: false };
}

/** Repeat milestones drawn on the opened row's track, evenly spaced. */
export const TRACK_MARKS = [1, 5, 10, 25, 50, 100] as const;

/** Where a count sits on the evenly spaced track, 0–1: between two marks it moves in proportion. */
export function trackPosition(count: number): number {
  const last = TRACK_MARKS.length - 1;
  if (count >= TRACK_MARKS[last]) return 1;
  if (count <= TRACK_MARKS[0]) return 0;
  const index = TRACK_MARKS.findIndex((mark, at) => count >= mark && count < TRACK_MARKS[at + 1]);
  const from = TRACK_MARKS[index];
  const to = TRACK_MARKS[index + 1];
  return (index + (count - from) / (to - from)) / last;
}
