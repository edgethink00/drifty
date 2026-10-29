import { useMemo } from "react";
import type { DisplayLanguage } from "../localization/languageCatalog";
import { useLocalization } from "../localization/LocalizationContext";
import {
  formatLocalizedCompactDurationFromSeconds,
  formatLocalizedCompactHourLabel,
  formatLocalizedDayLabel,
  localeForDisplayLanguage,
} from "../../lib/formatting";

/** Hour range for "usual hours": "오전 9시–오후 12시", "1 – 4 PM", "13–16 Uhr". */
function formatHourRange(from: number, to: number, language: DisplayLanguage): string {
  if (language === "ko") {
    const half = (hour: number) => (hour < 12 || hour === 24 ? "오전" : "오후");
    const twelve = (hour: number) => (hour === 0 || hour === 24 ? 12 : hour > 12 ? hour - 12 : hour);
    // The range ends at the top of its last hour, so 9–12 stays in the morning.
    const endHalf = half(to - 1);
    return half(from) === endHalf
      ? half(from) + " " + twelve(from) + "–" + twelve(to) + "시"
      : half(from) + " " + twelve(from) + "시–" + endHalf + " " + twelve(to) + "시";
  }
  if (language === "en") {
    const half = (hour: number) => (hour < 12 || hour === 24 ? "AM" : "PM");
    const twelve = (hour: number) => (hour === 0 || hour === 24 ? 12 : hour > 12 ? hour - 12 : hour);
    const endHalf = half(to - 1);
    return half(from) === endHalf
      ? twelve(from) + " – " + twelve(to) + " " + endHalf
      : twelve(from) + " " + half(from) + " – " + twelve(to) + " " + endHalf;
  }
  if (language === "de") return from + "–" + to + " Uhr";
  return formatLocalizedCompactHourLabel(from, language) + "–" + formatLocalizedCompactHourLabel(to, language);
}

export function makeProjectDetailFormat(language: DisplayLanguage) {
  const locale = localeForDisplayLanguage(language);
  // The log's time column is narrow and numeric, so it reads in 24-hour time everywhere.
  const clockFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return {
    duration: (seconds: number) => formatLocalizedCompactDurationFromSeconds(Math.max(0, Math.round(seconds)), language),
    clock: (ms: number) => clockFormat.format(new Date(ms)),
    /** Compact "M/D", as the project charts label their days. */
    md: (day: string) => {
      const [, month, date] = day.split("-").map(Number);
      return Number.isFinite(month) && Number.isFinite(date) ? month + "/" + date : day;
    },
    weekday: (day: string) => weekdayFormat.format(new Date(day + "T12:00:00")),
    dayTitle: (day: string) => formatLocalizedDayLabel(day, language),
    hour: (hour: number) => formatLocalizedCompactHourLabel(hour, language),
    hourRange: (from: number, to: number) => formatHourRange(from, to, language),
    pct: (ratio: number) => Math.round(ratio * 100) + "%",
  };
}

export type ProjectDetailFormat = ReturnType<typeof makeProjectDetailFormat>;

export function useProjectDetailFormat(): ProjectDetailFormat {
  const { effectiveLanguage } = useLocalization();
  return useMemo(() => makeProjectDetailFormat(effectiveLanguage), [effectiveLanguage]);
}
