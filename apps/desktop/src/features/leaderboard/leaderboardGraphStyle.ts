export const LEADERBOARD_GRAPH_STYLES = [
  "off",
  "default",
  "flat",
  "solid",
  "thick",
  "bars",
  "warm",
  "sweep",
  "layered",
] as const;

export type LeaderboardGraphStyle = (typeof LEADERBOARD_GRAPH_STYLES)[number];

export const DEFAULT_LEADERBOARD_GRAPH_STYLE: LeaderboardGraphStyle = "off";

export const LEADERBOARD_GRAPH_STYLE_OPTIONS: readonly { value: LeaderboardGraphStyle; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "default", label: "Line + fill" },
  { value: "flat", label: "Line only" },
  { value: "solid", label: "Flat fill" },
  { value: "thick", label: "Thick line" },
  { value: "bars", label: "Bars + line" },
  { value: "warm", label: "Warm gold" },
  { value: "sweep", label: "Horizontal sweep" },
  { value: "layered", label: "Layered + average" },
];

export function isLeaderboardGraphStyle(value: string | null | undefined): value is LeaderboardGraphStyle {
  return value != null && (LEADERBOARD_GRAPH_STYLES as readonly string[]).includes(value);
}

export function parseLeaderboardGraphStyle(value: string | null | undefined): LeaderboardGraphStyle {
  return isLeaderboardGraphStyle(value) ? value : DEFAULT_LEADERBOARD_GRAPH_STYLE;
}

export type LeaderboardSparklinePoint = {
  readonly day: string;
  readonly focus: number;
};

export const SPARKLINE_VIEW_WIDTH = 240;
export const SPARKLINE_VIEW_HEIGHT = 38;

export function buildSparklineGeometry(values: readonly number[]): { readonly x: number; readonly y: number }[] {
  if (values.length < 2) return [];
  const clamped = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const max = Math.max(...clamped, 1);
  const pad = 2;
  const usable = SPARKLINE_VIEW_HEIGHT - pad * 2;
  return clamped.map((value, index) => ({
    x: ((index + 0.5) / clamped.length) * SPARKLINE_VIEW_WIDTH,
    y: SPARKLINE_VIEW_HEIGHT - (value / max) * usable - pad,
  }));
}

const KOREAN_WEEKDAY_LETTERS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const ENGLISH_WEEKDAY_LETTERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const SPANISH_WEEKDAY_LETTERS = ["D", "L", "M", "X", "J", "V", "S"] as const;

export function sparklineWeekdayLetter(day: string, language: "en" | "ko" | "es"): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  if (language === "ko") return KOREAN_WEEKDAY_LETTERS[date.getDay()] ?? "";
  if (language === "es") return SPANISH_WEEKDAY_LETTERS[date.getDay()] ?? "";
  return ENGLISH_WEEKDAY_LETTERS[date.getDay()] ?? "";
}
