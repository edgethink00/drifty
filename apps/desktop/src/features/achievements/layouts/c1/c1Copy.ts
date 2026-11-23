import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import { achievementDay, shownRarity, timesLabel } from "../../achievementCopy";
import { progressText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for a tile. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

export type TileStatus =
  | { readonly kind: "earned"; readonly day: string; readonly times: string | null }
  | { readonly kind: "progress"; readonly text: string }
  | { readonly kind: "none"; readonly text: string };

export function tileStatus(item: AchievementItem, t: Translate, language: DisplayLanguage): TileStatus {
  const earned = item.earned;
  if (earned) {
    const times = item.definition.repeatable && earned.count > 1 ? timesLabel(earned.count, t) : null;
    return { kind: "earned", day: shortDay(achievementDay(item) ?? earned.firstDay, language), times };
  }
  const progress = item.definition.hidden ? null : progressText(item, t, language);
  return progress ? { kind: "progress", text: progress } : { kind: "none", text: t("achievements.c1.notYet") };
}

/** The earned achievement fewest people have, when rarity may be shown at all. */
export function rarestEarned(items: readonly AchievementItem[]): AchievementItem | undefined {
  return items
    .filter((item) => item.earned && shownRarity(item) !== null)
    .sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
}
