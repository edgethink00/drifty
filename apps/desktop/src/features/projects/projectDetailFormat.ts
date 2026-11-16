import { useMemo } from "react";
import type { DisplayLanguage } from "../localization/languageCatalog";
import { useLocalization } from "../localization/LocalizationContext";
import {
  formatLocalizedCompactDurationFromSeconds,
  formatLocalizedCompactHourLabel,
  formatLocalizedCompactTimeRange,
  formatLocalizedDayLabel,
  formatLocalizedTimeLabel,
  localeForDisplayLanguage,
} from "../../lib/formatting";

/** Hour range for "usual hours": "오전 9시 – 오후 12시", "1–4 PM", "13–16 Uhr". */
/* Each end of a range holds together, so where a figure tile is too narrow
   for "오전 10시 – 오후 1시" the range breaks after its dash, never inside an end. */
const NBSP = " ";

function formatHourRange(from: number, to: number, language: DisplayLanguage): string {
  if (language === "ko") {
    const half = (hour: number) => (hour < 12 || hour === 24 ? "오전" : "오후");
    const twelve = (hour: number) => (hour === 0 || hour === 24 ? 12 : hour > 12 ? hour - 12 : hour);
    // The range ends at the top of its last hour, so 9–12 stays in the morning.
    const endHalf = half(to - 1);
    return half(from) === endHalf
      ? half(from) + " " + twelve(from) + "–" + twelve(to) + "시"
      : half(from) + NBSP + twelve(from) + "시" + NBSP + "– " + endHalf + NBSP + twelve(to) + "시";
  }
  if (language === "en") {
    const half = (hour: number) => (hour < 12 || hour === 24 ? "AM" : "PM");
    const twelve = (hour: number) => (hour === 0 || hour === 24 ? 12 : hour > 12 ? hour - 12 : hour);
    const endHalf = half(to - 1);
    return half(from) === endHalf
      ? twelve(from) + "–" + twelve(to) + " " + endHalf
      : twelve(from) + NBSP + half(from) + NBSP + "– " + twelve(to) + NBSP + endHalf;
  }
  if (language === "de") return from + "–" + to + " Uhr";
  return formatLocalizedCompactHourLabel(from, language) + "–" + formatLocalizedCompactHourLabel(to, language);
}

export function makeProjectDetailFormat(language: DisplayLanguage) {
  const locale = localeForDisplayLanguage(language);
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return {
    duration: (seconds: number) => formatLocalizedCompactDurationFromSeconds(Math.max(0, Math.round(seconds)), language),
    clock: (ms: number) => formatLocalizedTimeLabel(new Date(ms), language),
    /** The log's time column, written like every other time range in the app. */
    clockRange: (startMs: number, endMs: number) => formatLocalizedCompactTimeRange(new Date(startMs), new Date(endMs), language),
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
