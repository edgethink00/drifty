import type { WeekCalendarEvent } from "./weekCalendar";
import { WEEK_CALENDAR_DEFAULT_HOUR_HEIGHT_PX } from "./weekDashboardAxisScale";

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
  // The micro/tiny pixel heights below are fixed because they are sized to fit
  // the identity icons. They were tuned against the baseline hour height, so
  // when the axis is compressed under that baseline each fixed floor spans more
  // minutes of the timeline than it did at 100% and short blocks overrun their
  // time slot, colliding with neighbours. Rather than shrink the pixels, widen
  // the minute thresholds by the same compression ratio: more short blocks fall
  // into the smaller fixed heights, easing the crowding. At the baseline height
  // the ratio is 1, so this is a no-op at 100%.
  //
  // Grouped clusters are exempt: they carry the identity strip, get their own
  // taller short-height floor below, and are summaries rather than the loose
  // short blocks this collapse targets. Scaling their threshold would sweep
  // clusters up to ~13 active minutes into the tiny bucket at the default 75%
  // axis and hide their identity icons entirely, so keep their thresholds at
  // the unscaled baseline (matching pre-compression behaviour).
  const axisCompressionRatio =
    event.isGroupedCluster || calendarHourHeight <= 0
      ? 1
      : WEEK_CALENDAR_DEFAULT_HOUR_HEIGHT_PX / calendarHourHeight;
  const microThresholdMinutes = MICRO_EVENT_MAX_ACTIVE_MINUTES * axisCompressionRatio;
  const tinyThresholdMinutes = TINY_EVENT_MAX_ACTIVE_MINUTES * axisCompressionRatio;
  const rawEventHeight = (event.durationMinutes / 60) * calendarHourHeight;
  const isMicroEvent = event.activeDurationMinutes <= microThresholdMinutes;
  const isTinyEvent = event.activeDurationMinutes <= tinyThresholdMinutes;
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
