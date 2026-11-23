import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import { achievementDay, formatAchievementDay, medalName, shownRarity, timesLabel } from "../../achievementCopy";
import { nextMedal, progressShare } from "../../achievementProgress";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";

function dateOf(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1, 12);
}

function sameYear(day: string, today: Date): boolean {
  return dateOf(day).getFullYear() === today.getFullYear();
}

function format(day: string, language: DisplayLanguage, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(dateOf(day));
}

/** "11월 22일 토요일", with the year when it is not this year. */
export function journalDate(day: string, language: DisplayLanguage, today = new Date()): string {
  return format(day, language, sameYear(day, today)
    ? { weekday: "long", month: "long", day: "numeric" }
    : { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function journalMonth(day: string, language: DisplayLanguage, today = new Date()): string {
  return format(day, language, sameYear(day, today) ? { month: "long" } : { year: "numeric", month: "long" });
}

export function journalWeekday(day: string, language: DisplayLanguage): string {
  return format(day, language, { weekday: "short" });
}

export function journalDayNumber(day: string): string {
  return String(dateOf(day).getDate());
}

export function shortDay(day: string, language: DisplayLanguage): string {
  return format(day, language, { month: "short", day: "numeric" });
}

/** The day an earned achievement sits on in the journal. */
export function entryDay(item: AchievementItem): string {
  return achievementDay(item) ?? item.earned?.firstDay ?? "";
}

/** Earned achievements, latest day first; on the same day the weightier one first. */
export function journalEntries(items: readonly AchievementItem[]): AchievementItem[] {
  return items
    .filter((item) => item.earned)
    .sort((left, right) => entryDay(right).localeCompare(entryDay(left)) || right.definition.weight - left.definition.weight);
}

/** Not earned yet: closest to done first, hidden ones last. */
export function aheadEntries(items: readonly AchievementItem[]): AchievementItem[] {
  return items
    .filter((item) => !item.earned)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => Number(left.item.definition.hidden) - Number(right.item.definition.hidden)
      || progressShare(right.item) - progressShare(left.item)
      || left.index - right.index)
    .map(({ item }) => item);
}

/** What the person did that day, in the journal's voice. */
export function didLine(item: AchievementItem, t: Translate): string {
  return t(("achievements.c4.did." + item.definition.id) as TranslationKey);
}

/** "39번 · 처음 9월 25일" or "은메달"; the medal reads from the art for repeatable ones. */
export function recordLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string {
  const earned = item.earned;
  if (!earned) return "";
  if (!item.definition.repeatable) return [medalName(item, t), t("achievements.medal.once")].filter(Boolean).join(" · ");
  const parts = [timesLabel(earned.count, t)];
  if (earned.count > 1) parts.push(t("achievements.c4.since", { date: formatAchievementDay(earned.firstDay, language) }));
  return parts.join(" · ");
}

/** "이중 테까지 11번" for repeatable ones still short of the top medal. */
export function nextLine(item: AchievementItem, t: Translate): string | null {
  const next = nextMedal(item);
  return next ? t(next.key, { remaining: next.remaining }) : null;
}

export function rarityPercent(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const rarity = shownRarity(item);
  return rarity ? t("achievements.c4.percent", { percent: formatRarityPercent(rarity.percent, language) }) : null;
}

/** The medal art for an achievement; the small file below about 3rem. */
export function medalSource(item: AchievementItem, small: boolean): string | undefined {
  return achievementBadgeUrl(item.definition.id, achievementBadgeStage(item), small);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
