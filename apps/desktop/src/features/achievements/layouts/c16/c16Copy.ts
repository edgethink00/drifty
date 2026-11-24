import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import { achievementDay, achievementCondition, formatAchievementDay, timesLabel } from "../../achievementCopy";
import { remainingText } from "../../achievementProgress";
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

/** Which part of the list a row sits in; it decides the one fact at the row's right edge. */
export type RowPart = "almost" | "earned" | "notYet" | "hidden";

export type RowFact = { readonly kind: "day" | "left" | "condition"; readonly text: string } | null;

/** The single fact a row carries on its right: the day for earned, what is left for almost there, the goal for not yet. */
export function rowFact(item: AchievementItem, part: RowPart, t: Translate, language: DisplayLanguage): RowFact {
  if (part === "hidden") return null;
  if (part === "earned") {
    const text = countAndDay(item, t, language);
    return text ? { kind: "day", text } : null;
  }
  if (part === "almost") {
    const left = remainingText(item, t, language);
    return left ? { kind: "left", text: left } : null;
  }
  return { kind: "condition", text: achievementCondition(item, t) };
}

export type HistoryMonth = { readonly key: string; readonly label: string; readonly days: readonly string[] };

/** Kept days, newest first, gathered under their month: "11월" or "Nov", with the year once it is not this one. */
export function historyMonths(days: readonly string[], language: DisplayLanguage, today = new Date()): HistoryMonth[] {
  const months: { key: string; label: string; days: string[] }[] = [];
  const locale = localeForDisplayLanguage(language);
  for (const day of days) {
    const key = day.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.key === key) {
      last.days.push(day);
      continue;
    }
    const [year, month] = key.split("-").map(Number);
    const options: Intl.DateTimeFormatOptions = year === today.getFullYear() ? { month: "short" } : { year: "numeric", month: "short" };
    const label = year && month ? new Intl.DateTimeFormat(locale, options).format(new Date(year, month - 1, 15, 12)) : key;
    months.push({ key, label, days: [day] });
  }
  return months;
}

/** An earned row's right edge: "39 times · Nov 22" for a repeat, just the day otherwise. */
export function countAndDay(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const day = achievementDay(item);
  if (!item.earned || !day) return null;
  const count = item.earned.count;
  return item.definition.repeatable && count > 1
    ? timesLabel(count, t) + " · " + shortDay(day, language)
    : shortDay(day, language);
}

/** "Earned November 20", or "57th time · November 20" for a repeat. */
export function whenLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const earned = item.earned;
  const day = achievementDay(item);
  if (!earned || !day) return null;
  const date = formatAchievementDay(day, language);
  return item.definition.repeatable && earned.count > 1
    ? t("achievements.dialog.timesNth", { count: earned.count }) + " · " + date
    : t("achievements.dialog.earnedOn", { date });
}
