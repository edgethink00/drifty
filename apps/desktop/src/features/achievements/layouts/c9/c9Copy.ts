import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import type { AchievementHoldings, AlmostThereEntry } from "../../achievementCollection";
import { nextMedal, remainingText } from "../../achievementProgress";

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for a column or a chip. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

export function percentText(share: number, language: DisplayLanguage): string {
  return new Intl.NumberFormat(localeForDisplayLanguage(language), { style: "percent", maximumFractionDigits: 0 }).format(share);
}

/** What is left of an almost-there goal: "1h to go" for one under way, "3 more for gold" for a medal. */
export function nearLeft(entry: AlmostThereEntry, t: Translate, language: DisplayLanguage): string {
  if (entry.kind === "unlock") return remainingText(entry.item, t, language) ?? "";
  const next = nextMedal(entry.item);
  return next ? t(next.key, { remaining: next.remaining }) : "";
}

const MEDAL_KEYS = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
} as const satisfies Record<string, TranslationKey>;

export type HeldPart = { readonly key: string; readonly name: string; readonly count: number; readonly notable: boolean };

/** The held-by-tier line as parts, empty tiers left out; by medal metal when rarity is unknown. */
export function heldParts(holdings: AchievementHoldings, t: Translate): HeldPart[] {
  if (holdings.kind === "rarity") {
    return holdings.tiers
      .filter(({ count }) => count > 0)
      .map(({ tier, count }) => ({ key: "tier-" + tier, name: t(("achievements.tier." + tier) as TranslationKey), count, notable: tier >= 3 }));
  }
  return holdings.medals
    .filter(({ count }) => count > 0)
    .map(({ medal, count }) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count, notable: medal !== "silver" }));
}
