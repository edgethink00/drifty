import { localeForDisplayLanguage } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { Translate } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import { achievementBadgeStage, type AchievementBadgeStage } from "./achievementBadge";
import { achievementTier, formatRarityBasis, formatRarityPercent, type AchievementRarity } from "./achievementRarity";
import type { AchievementItem } from "./useAchievements";

export function achievementName(item: AchievementItem, t: Translate): string {
  return item.definition.hidden && !item.earned
    ? t("achievements.hiddenName")
    : t(("achievements." + item.definition.id + ".name") as TranslationKey);
}

export function achievementCondition(item: AchievementItem, t: Translate): string {
  return item.definition.hidden && !item.earned
    ? t("achievements.hiddenCondition")
    : t(("achievements." + item.definition.id + ".condition") as TranslationKey);
}

export function formatAchievementDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "long", day: "numeric" }
    : { year: "numeric", month: "long", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

/** The day an earned achievement points to: the latest time for repeatable ones, else the day it was reached. */
export function achievementDay(item: AchievementItem): string | null {
  if (!item.earned) return null;
  return item.definition.repeatable ? item.earned.lastDay : item.earned.firstDay;
}

export function timesLabel(count: number, t: Translate): string {
  return count === 1 ? t("achievements.once") : t("achievements.times", { count });
}

export function daysLabel(count: number, t: Translate): string {
  return count === 1 ? t("achievements.dayOne") : t("achievements.days", { count });
}

const MEDAL_NAMES: Partial<Record<AchievementBadgeStage, TranslationKey>> = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ring",
};

export function medalName(item: AchievementItem, t: Translate): string | null {
  const key = item.earned ? MEDAL_NAMES[achievementBadgeStage(item)] : undefined;
  return key ? t(key) : null;
}

/** Rarity that may be shown: none without a share of users, and none for a hidden achievement until it is earned. */
export function shownRarity(item: AchievementItem): AchievementRarity | null {
  if (!item.rarity) return null;
  return item.definition.hidden && !item.earned ? null : item.rarity;
}

/**
 * Below this share a rarity reads better as "N of M people" than as a
 * percentage. The same share the list sets in gold, so "only N of M" is said
 * of exactly the achievements that look rare.
 */
const FEW_HOLDERS_BELOW_PERCENT = 10;

/** People in the sample who hold the achievement; the person reading it is always one of them. */
export function rarityHolders(rarity: AchievementRarity): number {
  return Math.max(1, Math.round((rarity.percent / 100) * rarity.basisCount));
}

export function rarityReadsAsFew(rarity: AchievementRarity): boolean {
  return rarity.percent < FEW_HOLDERS_BELOW_PERCENT;
}

export function raritySentence(rarity: AchievementRarity, t: Translate, language: DisplayLanguage, place: "tab" | "card"): string {
  if (rarityReadsAsFew(rarity)) {
    return t(place === "tab" ? "achievements.rarity.few" : "achievements.rarity.cardFew", {
      count: formatRarityBasis(rarityHolders(rarity), language),
      basis: formatRarityBasis(rarity.basisCount, language),
    });
  }
  return t(place === "tab" ? "achievements.rarity.detail" : "achievements.rarity.cardShare", {
    percent: formatRarityPercent(rarity.percent, language),
  });
}

export function rarityTierName(item: AchievementItem, rarity: AchievementRarity, t: Translate): string {
  return t(("achievements.tier." + achievementTier(item.definition, rarity)) as TranslationKey);
}

/** Rare, very rare and legendary achievements set their tier in gold; common ones stay quiet. */
export function rarityIsNotable(item: AchievementItem, rarity: AchievementRarity): boolean {
  return achievementTier(item.definition, rarity) >= 3;
}
