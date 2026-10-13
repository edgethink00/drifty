import { formatLocalizedCompactDurationFromSeconds } from "../../../lib/formatting";
import type { DisplayLanguage } from "../../localization/languagePreference";
import { slotClock, type ReadValueFormat } from "./readModel";

/** Dates and values as Your read writes them. */

const HOUR = 3600;

export function durationLabel(seconds: number, language: DisplayLanguage): string {
  if (seconds < 60) return language === "ko" ? "0분" : "0m";
  return formatLocalizedCompactDurationFromSeconds(seconds, language);
}

export function signedDuration(seconds: number, language: DisplayLanguage): string {
  if (Math.abs(seconds) < 60) return "±0";
  return (seconds > 0 ? "+" : "−") + durationLabel(Math.abs(seconds), language);
}

export function formatValue(value: number, format: ReadValueFormat, language: DisplayLanguage): string {
  if (format === "clock") return slotClock(value);
  if (format === "percent") return Math.round(value * 100) + "%";
  return durationLabel(value, language);
}

export function tickLabel(value: number, format: ReadValueFormat, language: DisplayLanguage): string {
  if (format === "clock") return slotClock(value);
  if (format === "percent") return Math.round(value * 100) + "%";
  if (value === 0) return "0";
  return language === "ko" ? value / HOUR + "시간" : value / HOUR + "h";
}

function parseDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function shiftDate(iso: string, days: number): string {
  const date = parseDate(iso);
  date.setDate(date.getDate() + days);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export function weekRangeLabel(start: string, end: string, language: DisplayLanguage): string {
  const from = parseDate(start);
  const to = parseDate(end);
  if (language === "ko") {
    return from.getMonth() === to.getMonth()
      ? (from.getMonth() + 1) + "월 " + from.getDate() + "–" + to.getDate() + "일"
      : (from.getMonth() + 1) + "월 " + from.getDate() + "일–" + (to.getMonth() + 1) + "월 " + to.getDate() + "일";
  }
  const month = (date: Date) => date.toLocaleDateString("en-US", { month: "short" });
  return from.getMonth() === to.getMonth()
    ? month(from) + " " + from.getDate() + "–" + to.getDate()
    : month(from) + " " + from.getDate() + "–" + month(to) + " " + to.getDate();
}

export function dayLabel(iso: string, language: DisplayLanguage, style: "weekday" | "date" | "day" = "weekday"): string {
  const date = parseDate(iso);
  const locale = language === "ko" ? "ko-KR" : "en-US";
  if (style === "weekday") return date.toLocaleDateString(locale, { weekday: "short" });
  if (style === "day") return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
}
