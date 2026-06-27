import type { WeekCalendarEvent } from "./weekCalendar";

export type WeekCalendarEventLayout = {
  readonly eventHeight: number;
  readonly hidesInlineText: boolean;
  readonly isCompactEvent: boolean;
  readonly isMicroEvent: boolean;
  readonly isTinyEvent: boolean;
  readonly showsIdentityStrip: boolean;
  readonly showsInlineDetail: boolean;
};

const MICRO_EVENT_MAX_ACTIVE_MINUTES = 3;
const TINY_EVENT_MAX_ACTIVE_MINUTES = 10;
const MICRO_EVENT_HEIGHT_PX = 6;
const TINY_EVENT_HEIGHT_PX = 12;

export function buildWeekCalendarEventLayout(
  event: WeekCalendarEvent,
  calendarHourHeight: number,
): WeekCalendarEventLayout {
  const rawEventHeight = (event.durationMinutes / 60) * calendarHourHeight;
  const isMicroEvent = event.activeDurationMinutes <= MICRO_EVENT_MAX_ACTIVE_MINUTES;
  const isTinyEvent = event.activeDurationMinutes <= TINY_EVENT_MAX_ACTIVE_MINUTES;
  const hidesInlineText = isMicroEvent;
  const shortEventMinHeight = event.isGroupedCluster ? 18 : 10;
  const shortEventMaxHeight = event.isGroupedCluster ? 26 : 24;
  const eventHeight = isMicroEvent
    ? MICRO_EVENT_HEIGHT_PX
    : isTinyEvent
      ? TINY_EVENT_HEIGHT_PX
      : event.isShort
        ? Math.max(
            shortEventMinHeight,
            Math.min(shortEventMaxHeight, Math.round(8 + Math.sqrt(event.durationMinutes) * 4)),
          )
        : Math.max(28, rawEventHeight - 4);
  const isCompactEvent = event.isShort
    || eventHeight < 36
    || event.laneCount > 2;
  const showsIdentityStrip = event.isGroupedCluster && !isTinyEvent;
  const showsInlineDetail = !isCompactEvent && event.sessionCount <= 1;

  return {
    eventHeight,
    hidesInlineText,
    isCompactEvent,
    isMicroEvent,
    isTinyEvent,
    showsIdentityStrip,
    showsInlineDetail,
  };
}
