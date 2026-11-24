import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";

function parse(day: string): Date | null {
  const [year, month, date] = day.split("-").map(Number);
  return year && month && date ? new Date(year, month - 1, date, 12) : null;
}

export type RailLabel = { readonly text: string; readonly kind: "year" | "month" | "day" };

/**
 * Labels for the rail's ticks, newest first: a tick names its month only when
 * it starts one ("11월 22일 · 18일 · 17일"), and its year only before this one.
 */
export function railLabels(days: readonly string[], language: DisplayLanguage, today = new Date()): RailLabel[] {
  const dayOnly = new Intl.DateTimeFormat(localeForDisplayLanguage(language), { day: "numeric" });
  return days.map((day, index) => {
    const date = parse(day);
    const earlierYear = date !== null && date.getFullYear() !== today.getFullYear();
    if (!date || index === 0 || days[index - 1]?.slice(0, 7) !== day.slice(0, 7)) {
      return { text: shortDay(day, language, today), kind: earlierYear ? "year" : "month" };
    }
    return { text: dayOnly.format(date), kind: "day" };
  });
}

/** A tick's date in full, for a tick whose neighbour's label had to give way and took the month with it. */
export function fullLabel(day: string, language: DisplayLanguage, today = new Date()): RailLabel {
  const date = parse(day);
  const earlierYear = date !== null && date.getFullYear() !== today.getFullYear();
  return { text: shortDay(day, language, today), kind: earlierYear ? "year" : "month" };
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
