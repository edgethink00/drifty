import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { localeForDisplayLanguage } from "../../../../lib/formatting";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import { HELD_MEDALS } from "../../achievementCollection";
import { formatAchievementDay } from "../../achievementCopy";
import type { AchievementHistoryEntry } from "../../achievementHistory";
import type { AchievementItem } from "../../useAchievements";

type MedalProps = {
  readonly item: AchievementItem;
  /** The small image, for marks under about 3rem. */
  readonly small?: boolean;
  readonly className?: string;
};

export function C10Medal({ item, small = false, className = "c10-medal" }: MedalProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    <span className={className} data-stage={stage} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

/** "Nov 21" this year, "Nov 21, 2025" before: short enough for a tile or a list. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

export type SummaryRow = { readonly key: string; readonly label: string; readonly count: number };

export function tierRows(counts: readonly { readonly tier: number; readonly count: number }[], t: Translate): SummaryRow[] {
  return counts.map(({ tier, count }) => ({ key: "tier-" + tier, label: t(("achievements.tier." + tier) as TranslationKey), count }));
}

const MEDAL_LABELS: Readonly<Record<typeof HELD_MEDALS[number], TranslationKey>> = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
};

export function medalRows(counts: readonly { readonly medal: typeof HELD_MEDALS[number]; readonly count: number }[], t: Translate): SummaryRow[] {
  return counts.map(({ medal, count }) => ({ key: "medal-" + medal, label: t(MEDAL_LABELS[medal]), count }));
}

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1) / DAY_MS;
}

function isoMonthStart(year: number, monthIndex: number): string {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return date.toISOString().slice(0, 10);
}

type StripDot = { readonly day: string; readonly ordinal: number; readonly left: number; readonly lane: number };

/** A column is as many days as it takes to clear one dot's width, so neighbouring days stack instead of covering each other. */
const COLUMN_MIN_PX = 10;
const FALLBACK_COLUMN_DAYS = 7;
const MIN_MONTHS = 3;
const MAX_MONTHS = 12;

type YearStripProps = {
  readonly entries: readonly AchievementHistoryEntry[];
  /** The day drawn lit (the newest, or the new one on a card). */
  readonly litDay?: string;
  /** Opens a day; without it the dots are drawn only. */
  readonly onOpenDay?: (day: string) => void;
  /** The caption, given how many months the strip spans. */
  readonly label: (months: number) => string;
  readonly today?: Date;
};

/**
 * The kept record as one line with a tick at each month, from the month of
 * the oldest kept day (at least three months, at most twelve) to this one:
 * every day is a dot placed by date, days too close to clear each other
 * stacked upward, so a busy stretch grows taller instead of covering itself. The
 * strip is a pointer shortcut and a picture: the list beside it carries the
 * same days for the keyboard and screen readers.
 */
export function YearStrip({ entries, litDay, onOpenDay, label, today = new Date() }: YearStripProps) {
  const { effectiveLanguage: language, t } = useLocalization();
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    setWidth(track.offsetWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setWidth(track.offsetWidth));
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  const newest = entries[0]?.day;
  const todayIso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
  const endIso = newest && newest > todayIso ? newest : todayIso;
  const [endYear = 1970, endMonth = 1] = endIso.split("-").map(Number);
  const [oldYear = endYear, oldMonth = endMonth] = (entries[entries.length - 1]?.day ?? endIso).split("-").map(Number);
  const monthCount = Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, (endYear - oldYear) * 12 + endMonth - oldMonth + 1));
  const startIso = isoMonthStart(endYear, endMonth - monthCount);
  const endExclusive = isoMonthStart(endYear, endMonth);
  const start = dayNumber(startIso);
  const span = dayNumber(endExclusive) - start;

  const months = useMemo(() => {
    const format = new Intl.DateTimeFormat(localeForDisplayLanguage(language), { month: "short", timeZone: "UTC" });
    return Array.from({ length: monthCount }, (_, index) => {
      const iso = isoMonthStart(endYear, endMonth - monthCount + index);
      return { iso, left: ((dayNumber(iso) - start) / span) * 100, name: format.format(new Date(iso + "T12:00:00Z")) };
    });
  }, [endMonth, endYear, language, monthCount, span, start]);

  const dots = useMemo(() => {
    const columnDays = width > 0 ? Math.max(1, Math.ceil((COLUMN_MIN_PX / width) * span)) : FALLBACK_COLUMN_DAYS;
    const filled = new Map<number, number>();
    const inRange = entries.filter(({ day }) => day >= startIso && day < endExclusive);
    return [...inRange].reverse().map(({ day, ordinal }): StripDot => {
      const column = Math.floor((dayNumber(day) - start) / columnDays);
      const lane = filled.get(column) ?? 0;
      filled.set(column, lane + 1);
      const centre = Math.min(span, column * columnDays + columnDays / 2);
      return { day, ordinal, left: (centre / span) * 100, lane };
    });
  }, [endExclusive, entries, span, start, startIso, width]);

  const lanesUsed = dots.reduce((most, dot) => Math.max(most, dot.lane + 1), 1);

  return (
    <div className="c10-strip">
      <p className="c10-strip__label">{label(monthCount)}</p>
      <div ref={trackRef} className="c10-strip__track" aria-hidden="true" data-months={monthCount} style={{ "--c10-lanes": Math.max(3, lanesUsed) } as CSSProperties}>
        {months.map((month) => (
          <span key={month.iso} className="c10-strip__month" style={{ left: month.left + "%" }}>
            <span className="c10-strip__month-name">{month.name}</span>
          </span>
        ))}
        {dots.map((dot) => {
          const tip = t("achievements.c10.nth", { count: dot.ordinal }) + " · " + formatAchievementDay(dot.day, language);
          const style = { left: dot.left + "%", "--c10-lane": dot.lane } as CSSProperties;
          return onOpenDay ? (
            <button
              key={dot.day}
              type="button"
              tabIndex={-1}
              className="c10-strip__dot"
              data-lit={dot.day === litDay ? "true" : undefined}
              data-tip={tip}
              style={style}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onOpenDay(dot.day)}
            />
          ) : (
            <span key={dot.day} className="c10-strip__dot" data-lit={dot.day === litDay ? "true" : undefined} style={style} />
          );
        })}
      </div>
    </div>
  );
}
