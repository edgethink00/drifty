import { isoWeekday, type TeamMemberDayRow, type TeamMemberDetailModel } from "./teamFocusModel";

/** At most seven columns, including quiet and future days; a month opens on its latest elapsed week. */
export function memberCalendarPages(rows: readonly TeamMemberDayRow[]): readonly (readonly TeamMemberDayRow[])[] {
  if (rows.length <= 7) return rows.length > 0 ? [rows] : [];
  const pages: TeamMemberDayRow[][] = [];
  for (const row of rows) {
    if (pages.length === 0 || isoWeekday(row.day) === 1) pages.push([]);
    pages[pages.length - 1]!.push(row);
  }
  return pages;
}

export function currentMemberCalendarPage(pages: readonly (readonly TeamMemberDayRow[])[]): number {
  const today = pages.findIndex((rows) => rows.some((row) => row.isToday));
  if (today >= 0) return today;
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    if (pages[index]?.some((row) => !row.isFuture)) return index;
  }
  return 0;
}

/** Expand the normal workday to contain every shared block. Never silently clip early/late work. */
export function memberCalendarHours(rows: readonly TeamMemberDayRow[]): { start: number; end: number } {
  const blocks = rows.flatMap((row) => row.blocks ?? []);
  return {
    start: Math.max(0, Math.min(8, ...blocks.map((block) => Math.floor(block.start_minute / 60)))),
    end: Math.min(24, Math.max(19, ...blocks.map((block) => Math.ceil(block.end_minute / 60)))),
  };
}

/** Elapsed focus in each clock hour, divided exactly at hour boundaries. Only the blocks scope can supply this. */
export function memberFocusRhythm(model: TeamMemberDetailModel): readonly number[] {
  const seconds = Array<number>(24).fill(0);
  if (!model.blocksVisible) return seconds;
  for (const day of model.dayRows) {
    if (day.isFuture) continue;
    for (const block of day.blocks ?? []) {
      for (let hour = Math.max(0, Math.floor(block.start_minute / 60)); hour < Math.min(24, Math.ceil(block.end_minute / 60)); hour += 1) {
        seconds[hour]! += Math.max(0, Math.min(block.end_minute, (hour + 1) * 60) - Math.max(block.start_minute, hour * 60)) * 60;
      }
    }
  }
  return seconds;
}

/** Project colors are user-selectable; choose readable text after Week's surface tint. */
export function memberCalendarForeground(tone: string, surface: string, tint: number): string {
  const rgb = (hex: string) => /^#[\da-f]{6}$/i.test(hex.trim())
    ? [1, 3, 5].map((offset) => Number.parseInt(hex.trim().slice(offset, offset + 2), 16) / 255) : null;
  const color = rgb(tone);
  const base = rgb(surface);
  if (!color || !base) return "var(--text)";
  const weight = Math.max(0, Math.min(1, tint));
  const luminance = color.map((channel, index) => channel * (1 - weight) + base[index]! * weight)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#000000";
}
