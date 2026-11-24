import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { achievementDay, timesLabel } from "../../achievementCopy";
import type { AlmostThereEntry } from "../../achievementCollection";
import { nextMedal, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for a tile or a history row. */
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
  const key = (["one", "two", "few"].includes(rule) ? "achievements.c7.nth." + rule : "achievements.c7.nth.other") as TranslationKey;
  return t(key, { count });
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
  return progress ? { kind: "progress", text: progress } : { kind: "none", text: t("achievements.c7.notYet") };
}

/** What an almost-there goal still asks: time or days for a locked one, times for the next metal. */
export function entryLeft(entry: AlmostThereEntry, t: Translate, language: DisplayLanguage): string {
  if (entry.kind === "medal") {
    const next = nextMedal(entry.item);
    return next ? t(next.key, { remaining: next.remaining }) : "";
  }
  return remainingText(entry.item, t, language) ?? "";
}
