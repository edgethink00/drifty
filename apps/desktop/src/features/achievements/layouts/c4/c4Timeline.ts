import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { AchievementItem } from "../../useAchievements";

export type TimelineLane = "up" | "down";

export type TimelinePlace = {
  readonly item: AchievementItem;
  /** Centre of the medal along the year, 0–100. */
  readonly x: number;
  readonly lane: TimelineLane;
  /** Label box, as a share of the axis, kept inside it. */
  readonly labelLeft: number;
  readonly labelWidth: number;
  readonly align: "start" | "center" | "end";
};

export type TimelineMonth = { readonly key: string; readonly label: string; readonly start: number; readonly width: number };

/** Medals keep at least this much of the axis between them, labels at most this much width. */
const EDGE = 4;
const MIN_GAP = 9;
const LABEL_MAX = 22;

function dayDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1, 12);
}

/**
 * The past `monthCount` months as an axis, each found achievement placed at the
 * day it was first earned. Medals too close together are pushed apart, and their
 * labels take turns above and below so they do not run into each other.
 * Achievements first earned before the axis starts are only counted (`before`).
 */
export function placeOnYear(
  items: readonly AchievementItem[],
  language: DisplayLanguage,
  monthCount = 12,
  today = new Date(),
): { places: TimelinePlace[]; months: TimelineMonth[]; before: number } {
  const start = new Date(today.getFullYear(), today.getMonth() - (monthCount - 1), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const span = end.getTime() - start.getTime();
  const share = (date: Date) => Math.max(0, Math.min(100, ((date.getTime() - start.getTime()) / span) * 100));

  const earned = items.filter((item) => item.earned);
  const inRange = earned.filter((item) => dayDate(item.earned?.firstDay ?? "").getTime() >= start.getTime());
  const sorted = inRange
    .map((item) => ({ item, raw: share(dayDate(item.earned?.firstDay ?? "")) }))
    .sort((left, right) => left.raw - right.raw || right.item.definition.weight - left.item.definition.weight);
  const count = sorted.length;
  const gap = count > 1 ? Math.min(MIN_GAP, (100 - EDGE * 2) / (count - 1)) : 0;
  const xs = sorted.map(({ raw }) => Math.max(EDGE, Math.min(100 - EDGE, raw)));
  for (let index = 1; index < count; index += 1) xs[index] = Math.max(xs[index], xs[index - 1] + gap);
  for (let index = count - 1; index >= 0; index -= 1) xs[index] = Math.min(xs[index], index === count - 1 ? 100 - EDGE : xs[index + 1] - gap);

  const lanes: TimelineLane[] = [];
  const last: Record<TimelineLane, number> = { up: -Infinity, down: -Infinity };
  xs.forEach((x, index) => {
    const lane: TimelineLane = x - last.down >= LABEL_MAX ? "down" : x - last.up >= LABEL_MAX ? "up" : x - last.down >= x - last.up ? "down" : "up";
    lanes[index] = lane;
    last[lane] = x;
  });

  const places = sorted.map(({ item }, index) => {
    const x = xs[index];
    const lane = lanes[index];
    // Each label owns the stretch between the midpoints to its neighbours in the same lane.
    let low = 0;
    let high = 100;
    for (let other = 0; other < count; other += 1) {
      if (other === index || lanes[other] !== lane) continue;
      if (xs[other] < x) low = Math.max(low, (xs[other] + x) / 2 + 0.5);
      else high = Math.min(high, (xs[other] + x) / 2 - 0.5);
    }
    const labelWidth = Math.max(1, Math.min(LABEL_MAX, high - low));
    const centred = x - labelWidth / 2;
    const left = Math.max(low, Math.min(high - labelWidth, centred));
    const align = left > centred + 0.01 ? "start" : left < centred - 0.01 ? "end" : "center";
    return { item, x, lane, labelLeft: left, labelWidth, align } as const;
  });

  const monthFormat = new Intl.DateTimeFormat(localeForDisplayLanguage(language), { month: "short" });
  const months = Array.from({ length: monthCount }, (_, index) => {
    const from = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const to = new Date(start.getFullYear(), start.getMonth() + index + 1, 1);
    return {
      key: from.getFullYear() + "-" + (from.getMonth() + 1),
      label: monthFormat.format(from),
      start: share(from),
      width: share(to) - share(from),
    };
  });
  return { places, months, before: earned.length - inRange.length };
}
