import type { DisplayLanguage } from "../localization/languageCatalog";
import { shiftIsoDate, type ProductivityDuration } from "@drifty/domain";
import type { WeekDayRow } from "../dashboard/weekCalendar";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import { buildShareCardData, buildShareWeekCardData } from "../share/shareCard";
import type { ShareCardModalCard } from "../share/ShareCardModal";
import type { UnifiedShareStoryId } from "../share/shareCardUnifiedSvg";
import type { LeaderboardPeriod } from "./leaderboardService";
import { getLeaderboardWindowStartDay } from "./leaderboardWindow";

/**
 * The leaderboard has daily focus/neutral/drift totals and the member's rank,
 * but no category totals or intraday blocks, so it offers the rank and focus
 * stories and leaves out Categories. The exact placement (#6 / 50) leads only
 * when the board already shows the member's rank; otherwise it would open on a
 * locked card, so it goes last as on the dashboard. The weekly card covers the
 * weekly rank window, which is what lets it carry the weekly placement.
 */
const DAY_STORIES_AFTER_PLACE: readonly UnifiedShareStoryId[] = ["R2", "C1", "R1c", "F1", "X5"];
const WEEK_STORIES_AFTER_PLACE: readonly UnifiedShareStoryId[] = ["WR1", "W5", "X5"];

/**
 * Without the daily series the focus stories would claim zero, so only the
 * place-rank story is offered; it reads the live rank alone.
 */
export function leaderboardShareStoryIds(card: ShareCardModalCard, hasRank: boolean, hasSeries = true): readonly UnifiedShareStoryId[] {
  const [place, rest] = card.kind === "day"
    ? ["R4", DAY_STORIES_AFTER_PLACE] as const
    : ["WR4", WEEK_STORIES_AFTER_PLACE] as const;
  if (!hasSeries) return [place];
  return hasRank ? [place, ...rest] : [...rest, place];
}

type BuildLeaderboardShareCardInput = {
  readonly language?: DisplayLanguage;
  readonly period: LeaderboardPeriod;
  /** Logical today; the leaderboard windows end on this day. */
  readonly windowEndDay: string;
  readonly dailyProductivity: readonly DailyProductivityPoint[];
};

/**
 * Builds the share card for the period on screen. Daily shares today's card;
 * weekly and monthly share the rolling seven-day window the weekly rank covers,
 * since there is no monthly card. Matching the leaderboard window lets the card
 * show the live rank instead of an estimate.
 */
export function buildLeaderboardShareCard({ period, windowEndDay, dailyProductivity, language = "en" }: BuildLeaderboardShareCardInput): ShareCardModalCard {
  const byDay = new Map(dailyProductivity.map((point) => [point.day, point]));
  const pointFor = (day: string): DailyProductivityPoint => byDay.get(day) ?? { day, focus: 0, drift: 0, neutral: 0 };

  if (period === "daily") {
    const today = pointFor(windowEndDay);
    const yesterday = byDay.get(shiftIsoDate(windowEndDay, -1));
    return {
      kind: "day",
      data: buildShareCardData({
        language: language === "ko" ? "en" : language,
        day: windowEndDay,
        totalSeconds: pointTotal(today),
        categoryTotals: [],
        productivityTotals: productivityTotals([today]),
        flowBlocks: [],
        deltaSeconds: yesterday ? today.focus - yesterday.focus : null,
        isCurrentPeriod: true,
      }),
    };
  }

  const startDay = getLeaderboardWindowStartDay(windowEndDay, "weekly");
  const days = enumerateDays(startDay, windowEndDay).map(pointFor);
  const previousDays = enumerateDays(shiftIsoDate(startDay, -7), shiftIsoDate(startDay, -1));
  const hasPrevious = previousDays.some((day) => byDay.has(day));
  const previousFocus = previousDays.reduce((sum, day) => sum + (byDay.get(day)?.focus ?? 0), 0);
  const focus = days.reduce((sum, point) => sum + point.focus, 0);
  return {
    kind: "week",
    data: buildShareWeekCardData({
      language: language === "ko" ? "en" : language,
      startDay,
      endDay: windowEndDay,
      totalSeconds: days.reduce((sum, point) => sum + pointTotal(point), 0),
      categoryTotals: [],
      productivityTotals: productivityTotals(days),
      weekRows: days.map(toWeekRow),
      calendarEvents: new Map(),
      deltaSeconds: hasPrevious ? focus - previousFocus : null,
      isCurrentPeriod: true,
      comparisonDay: windowEndDay,
    }),
  };
}

function pointTotal(point: DailyProductivityPoint): number {
  return Math.max(0, point.focus) + Math.max(0, point.neutral) + Math.max(0, point.drift);
}

function productivityTotals(points: readonly DailyProductivityPoint[]): ProductivityDuration[] {
  const totals = {
    focus: points.reduce((sum, point) => sum + Math.max(0, point.focus), 0),
    neutral: points.reduce((sum, point) => sum + Math.max(0, point.neutral), 0),
    drift: points.reduce((sum, point) => sum + Math.max(0, point.drift), 0),
  };
  const total = totals.focus + totals.neutral + totals.drift;
  return (["focus", "neutral", "drift"] as const).map((productivity) => ({
    productivity,
    totalSeconds: totals[productivity],
    segments: 0,
    ratio: total > 0 ? totals[productivity] / total : 0,
  }));
}

function toWeekRow(point: DailyProductivityPoint): WeekDayRow {
  const date = new Date(`${point.day}T12:00:00`);
  return {
    day: point.day,
    dayName: date.toLocaleDateString("en-US", { weekday: "long" }),
    dayNumber: String(date.getDate()),
    totalSeconds: pointTotal(point),
    focusSeconds: Math.max(0, point.focus),
    focusScore: 0,
    slices: [],
    productivitySlices: [],
  };
}

function enumerateDays(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  for (let day = startDay; day <= endDay && days.length < 40; day = shiftIsoDate(day, 1)) days.push(day);
  return days;
}
