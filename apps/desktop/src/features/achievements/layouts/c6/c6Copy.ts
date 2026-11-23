import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import {
  achievementDay,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { progressShare, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";

export function earnedDay(item: AchievementItem, language: DisplayLanguage): string {
  return item.earned ? formatAchievementDay(achievementDay(item) ?? item.earned.firstDay, language) : "";
}

export type TileStatus =
  | { readonly kind: "earned"; readonly text: string }
  | { readonly kind: "progress"; readonly text: string; readonly share: number }
  | { readonly kind: "none"; readonly text: string };

/** The one line under a gallery medal: how often or when, how far along, or not yet. */
export function tileStatus(item: AchievementItem, t: Translate, language: DisplayLanguage): TileStatus {
  const { earned } = item;
  if (earned) {
    const text = item.definition.repeatable && earned.count > 1 ? timesLabel(earned.count, t) : earnedDay(item, language);
    return { kind: "earned", text };
  }
  const progress = item.progress;
  if (!item.definition.hidden && progress && progress.current > 0 && progress.current < progress.target) {
    return { kind: "progress", text: remainingText(item, t, language) ?? "", share: progressShare(item) };
  }
  return { kind: "none", text: t("achievements.c6.notYet") };
}

/** When and how often, as one sentence. */
export function recordSentence(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const { earned } = item;
  if (!earned) return null;
  if (item.definition.repeatable && earned.count > 1) {
    return t("achievements.c6.repeatRecord", { count: earned.count, date: formatAchievementDay(earned.lastDay, language) });
  }
  return t("achievements.dialog.earnedOn", { date: earnedDay(item, language) });
}

export type RarityLine = { readonly sentence: string; readonly tier: string; readonly notable: boolean };

export function rarityLine(item: AchievementItem, t: Translate, language: DisplayLanguage, place: "tab" | "card"): RarityLine | null {
  const rarity = shownRarity(item);
  if (!rarity) return null;
  return {
    sentence: raritySentence(rarity, t, language, place),
    tier: rarityTierName(item, rarity, t),
    notable: rarityIsNotable(item, rarity),
  };
}

/** The card's line under the name when no rarity can be shown: the day and the metal. */
export function earnedLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string {
  return [recordSentence(item, t, language), medalName(item, t)].filter(Boolean).join(" · ");
}
