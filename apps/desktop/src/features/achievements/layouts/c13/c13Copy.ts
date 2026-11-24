import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { achievementDay, rarityIsNotable, rarityTierName, shownRarity } from "../../achievementCopy";
import { progressText, remainingText } from "../../achievementProgress";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for the right edge of a row. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

export function sharePercent(share: number, language: DisplayLanguage): string {
  return new Intl.NumberFormat(localeForDisplayLanguage(language), { style: "percent", maximumFractionDigits: 0 }).format(share);
}

/** "57th", "57번째", "57.": which time an earned day was. */
export function ordinal(count: number, t: Translate, language: DisplayLanguage): string {
  const rule = language === "en" ? new Intl.PluralRules("en", { type: "ordinal" }).select(count) : "other";
  const key = (["one", "two", "few"].includes(rule) ? "achievements.c13.nth." + rule : "achievements.c13.nth.other") as TranslationKey;
  return t(key, { count });
}

/** The one fact at a row's right edge: the day for earned, what is left for one under way, else nothing. */
export function rowFact(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  if (item.earned) return shortDay(achievementDay(item) ?? item.earned.firstDay, language);
  if (item.definition.hidden || !progressText(item, t, language)) return null;
  return remainingText(item, t, language);
}

export type MetaPart = { readonly key: string; readonly text: string; readonly tone?: "new" | "notable" | "times" };

/** The quiet run after the condition: new mark, times, tier with share when rarity is known, then the group. */
export function rowMeta(item: AchievementItem, t: Translate, language: DisplayLanguage, { fresh = false, group = true } = {}): MetaPart[] {
  const parts: MetaPart[] = [];
  if (fresh) parts.push({ key: "new", text: t("achievements.newArrival"), tone: "new" });
  const count = item.earned?.count ?? 0;
  if (item.earned && item.definition.repeatable && count > 1) parts.push({ key: "times", text: "×" + count, tone: "times" });
  const rarity = shownRarity(item);
  if (rarity) {
    parts.push({
      key: "rarity",
      text: t("achievements.c13.tierShare", { tier: rarityTierName(item, rarity, t), percent: formatRarityPercent(rarity.percent, language) }),
      tone: rarityIsNotable(item, rarity) ? "notable" : undefined,
    });
  }
  if (group) parts.push({ key: "group", text: t(("achievements.group." + item.definition.group) as TranslationKey) });
  return parts;
}
