import type { CSSProperties } from "react";
import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import { achievementDay, achievementName, shownRarity } from "../../achievementCopy";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementId } from "../../achievementCatalog";
import { mutedBadgeHex } from "../../render3d/palette";
import type { AchievementItem } from "../../useAchievements";

/** Held by fewer than this share of users, an achievement counts as rare: its share turns gold and the summary counts it. */
export const RARE_BELOW_PERCENT = 10;

/** A progress bar filled in the enamel colour of the medal it leads to, as Search Console fills its bars in its badges' colour. */
export function medalTint(id: AchievementId): CSSProperties {
  return { "--c15-bar-fill": mutedBadgeHex(id) } as CSSProperties;
}

/** What the back of an earned medal carries: its name and the day it was first earned, with the year ("2026년 9월 28일"). */
export function medalEngraving(item: AchievementItem, t: Translate, language: DisplayLanguage): string[] {
  const earned = item.earned;
  if (!earned) return [];
  const [year, month, date] = earned.firstDay.split("-").map(Number);
  const day = year && month && date
    ? new Intl.DateTimeFormat(localeForDisplayLanguage(language), { year: "numeric", month: "long", day: "numeric" }).format(new Date(year, month - 1, date, 12))
    : earned.firstDay;
  return [achievementName(item, t), day];
}

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for the right edge of a row. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
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
