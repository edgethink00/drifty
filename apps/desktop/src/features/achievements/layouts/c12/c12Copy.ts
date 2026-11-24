import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import type { AchievementGroup } from "../../achievementCatalog";
import {
  achievementDay,
  formatAchievementDay,
  medalName,
  raritySentence,
  rarityTierName,
  shownRarity,
} from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for a ledger column or a history chip. */
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
  const key = (["one", "two", "few"].includes(rule) ? "achievements.c12.nth." + rule : "achievements.c12.nth.other") as TranslationKey;
  return t(key, { count });
}

export function groupLabel(group: AchievementGroup, t: Translate): string {
  return t(("achievements.group." + group) as TranslationKey);
}

/** "×57" for a repeat earned more than once; nothing otherwise. */
export function timesMark(item: AchievementItem): string | null {
  const earned = item.earned;
  return earned && item.definition.repeatable && earned.count > 1 ? "×" + earned.count : null;
}

/** The ledger's right edge: the latest day for an earned one. */
export function rowDay(item: AchievementItem, language: DisplayLanguage): string | null {
  const day = achievementDay(item);
  return day ? shortDay(day, language) : null;
}

/** "57th time · November 20", or "Earned November 20" for a first or one-off. */
export function whenLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const earned = item.earned;
  if (!earned) return null;
  const day = formatAchievementDay(achievementDay(item) ?? earned.firstDay, language);
  return item.definition.repeatable && earned.count > 1
    ? t("achievements.c12.nthTime", { nth: ordinal(earned.count, t, language) }) + " · " + day
    : t("achievements.dialog.earnedOn", { date: day });
}

/** The tier it joins with rarity; without rarity only the medal metal, and nothing about rarity. */
export function tierLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const rarity = shownRarity(item);
  if (!rarity) return medalName(item, t);
  return t("achievements.c12.tier", { tier: rarityTierName(item, rarity, t) }) + " · " + raritySentence(rarity, t, language, "card");
}
