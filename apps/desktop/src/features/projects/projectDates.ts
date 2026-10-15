import { shiftIsoDate } from "@drifty/domain";
import type { useLocalization } from "../localization/LocalizationContext";

type Translate = ReturnType<typeof useLocalization>["t"];

/** The Projects list's window ("Latest 7 days"), which the delete confirmation also counts. */
export const PROJECT_LIBRARY_WINDOW_DAYS = 7;

/**
 * A project's last active day as people say it: today, yesterday, "3 days
 * ago" within the week, otherwise a short date (with the year only when it
 * differs from today's).
 */
export function formatProjectLastActivity(day: string | undefined, today: string, language: "en" | "ko", t: Translate): string {
  if (!day) return "—";
  if (day === today) return t("projects.day.today");
  if (day === shiftIsoDate(today, -1)) return t("projects.day.yesterday");
  for (let back = 2; back < 7; back += 1) {
    if (day === shiftIsoDate(today, -back)) return t("projects.day.daysAgo", { count: back });
  }
  const parsed = new Date(day + "T12:00:00");
  if (Number.isNaN(parsed.getTime())) return "—";
  const options: Intl.DateTimeFormatOptions = day.slice(0, 4) === today.slice(0, 4)
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", options).format(parsed);
}
