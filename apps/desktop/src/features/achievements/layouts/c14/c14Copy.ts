import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";

function parse(day: string): Date | null {
  const [year, month, date] = day.split("-").map(Number);
  return year && month && date ? new Date(year, month - 1, date, 12) : null;
}

/** True when any of these days falls in an earlier year, so its tick needs room for the year. */
export function anyEarlierYear(days: readonly string[], today = new Date()): boolean {
  return days.some((day) => parse(day)?.getFullYear() !== today.getFullYear());
}

/** "Nov 21" this year, "Nov 21, 2025" before: the rail's ticks and the opened record. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const date = parse(day);
  if (!date) return day;
  const options: Intl.DateTimeFormatOptions = date.getFullYear() === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(date);
}

/** "40th", "40번째", "40.": which time an earned day was. */
export function ordinal(count: number, t: Translate, language: DisplayLanguage): string {
  const rule = language === "en" ? new Intl.PluralRules("en", { type: "ordinal" }).select(count) : "other";
  const key = (["one", "two", "few"].includes(rule) ? "achievements.c14.nth." + rule : "achievements.c14.nth.other") as TranslationKey;
  return t(key, { count });
}

export function earlierText(count: number, t: Translate): string {
  return count === 1 ? t("achievements.c14.earlierOne") : t("achievements.c14.earlier", { count });
}
