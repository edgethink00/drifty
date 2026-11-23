import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { AchievementItem } from "../../useAchievements";

export type LookMonth = {
  readonly key: string;
  readonly label: string;
  /** Found in this month, earliest first. */
  readonly items: readonly AchievementItem[];
};

const MIN_MONTHS = 3;

function dayDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1, 12);
}

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/**
 * The months from the first found achievement up to this one (at least
 * MIN_MONTHS, at most `maxMonths`), each holding what was first earned in it.
 * Achievements from before the first month shown are only counted (`before`).
 */
export function monthsOfLook(
  items: readonly AchievementItem[],
  language: DisplayLanguage,
  maxMonths = 12,
  today = new Date(),
): { months: LookMonth[]; before: number } {
  const found = items
    .filter((item) => item.earned)
    .map((item) => ({ item, date: dayDate(item.earned?.firstDay ?? "") }))
    .sort((left, right) => left.date.getTime() - right.date.getTime() || right.item.definition.weight - left.item.definition.weight);
  const thisMonth = monthIndex(today);
  const firstMonth = found.length > 0 ? monthIndex(found[0].date) : thisMonth;
  const count = Math.max(MIN_MONTHS, Math.min(maxMonths, thisMonth - firstMonth + 1));
  const startMonth = thisMonth - (count - 1);

  const monthFormat = new Intl.DateTimeFormat(localeForDisplayLanguage(language), { month: "short" });
  const months = Array.from({ length: count }, (_, index) => {
    const from = new Date(today.getFullYear(), today.getMonth() - (count - 1) + index, 1);
    return {
      key: from.getFullYear() + "-" + (from.getMonth() + 1),
      label: monthFormat.format(from),
      items: found.filter(({ date }) => monthIndex(date) === startMonth + index).map(({ item }) => item),
    };
  });
  return { months, before: found.filter(({ date }) => monthIndex(date) < startMonth).length };
}
