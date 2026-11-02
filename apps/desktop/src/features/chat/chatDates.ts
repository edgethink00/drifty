/** Calendar arithmetic stays on this computer; a model never chooses a recipe's dates. */
export type ChatDateRange = { readonly from: string; readonly to: string };

export function localDay(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function calendarDay(date: Date, offset = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

export function calendarWeek(date: Date): Date {
  return calendarDay(date, -((date.getDay() + 6) % 7));
}

export function offsetTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  return localDay(date) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds())
    + (offset >= 0 ? "+" : "-") + pad(Math.floor(Math.abs(offset) / 60)) + ":" + pad(Math.abs(offset) % 60);
}

export function dateRange(from: Date, to: Date): ChatDateRange {
  return { from: offsetTimestamp(from), to: offsetTimestamp(to) };
}

export function rangeLabel(range: ChatDateRange): string {
  const first = range.from.slice(0, 10);
  // The end is exclusive, so Monday midnight belongs to the preceding week's label.
  const endDay = range.to.slice(0, 10);
  const previous = new Date(endDay + "T00:00:00Z");
  previous.setUTCDate(previous.getUTCDate() - 1);
  const last = /T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(range.to) ? previous.toISOString().slice(0, 10) : endDay;
  return first === last ? first : first + "–" + last;
}

/** Preserve the local clock through DST instead of subtracting 168 elapsed hours. */
export function previousWeekAt(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7, date.getHours(), date.getMinutes(), date.getSeconds());
}
