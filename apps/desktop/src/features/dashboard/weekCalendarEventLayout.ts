import type { WeekCalendarEvent } from "./weekCalendar";

export type WeekCalendarEventLayout = {
  readonly eventHeight: number;
  readonly hidesInlineText: boolean;
  readonly isCompactEvent: boolean;
  readonly showsIdentityStrip: boolean;
  readonly showsInlineDetail: boolean;
};

export function buildWeekCalendarEventLayout(
  event: WeekCalendarEvent,
  calendarHourHeight: number,
): WeekCalendarEventLayout {
  const rawEventHeight = (event.durationMinutes / 60) * calendarHourHeight;
  const hidesInlineText = event.durationMinutes < 10;
  const shortEventMinHeight = event.isGroupedCluster || hidesInlineText ? 22 : 10;
  const shortEventMaxHeight = event.isGroupedCluster ? 30 : 26;
  const eventHeight = event.isShort
    ? Math.max(
        shortEventMinHeight,
        Math.min(shortEventMaxHeight, Math.round(8 + Math.sqrt(event.durationMinutes) * 4)),
      )
    : Math.max(28, rawEventHeight - 4);
  const isCompactEvent = event.isShort
    || eventHeight < 36
    || event.laneCount > 2;
  const showsIdentityStrip = event.isGroupedCluster || hidesInlineText;
  const showsInlineDetail = !isCompactEvent && event.sessionCount <= 1;

  return {
    eventHeight,
    hidesInlineText,
    isCompactEvent,
    showsIdentityStrip,
    showsInlineDetail,
  };
}
