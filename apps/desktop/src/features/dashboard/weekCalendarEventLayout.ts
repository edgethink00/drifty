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

// A card renders its time line, then its detail line, only when it is tall
// enough for them; a line that does not fit would squeeze the app name or the
// identity strip, or be clipped. The lines are sized in rem
// (features/dashboard/week-dashboard.css: name 0.75rem at line-height 1.12, time
// 0.75rem and detail 0.6875rem at 1.1em), so they grow with the root font size,
// which tokens-base.css steps up from 16px to 17, 18 and 19px on wide windows.
// The chrome around them is fixed px. scripts/qa/week-calendar-identity-layout.test.mjs
// checks these sums against browser layout at every root size (16-19px), in
// Chromium and WebKit.
export const WEEK_CALENDAR_BASE_ROOT_FONT_SIZE_PX = 16;
const NAME_LINE_REM = 0.84;
const TIME_LINE_REM = 0.825;
const DETAIL_LINE_REM = 0.75625;
// Ungrouped card: 1px border and 5px padding above the name, 1px gaps between
// lines, a 1px border below. The last line must end at least 3px above that
// border (most of the 5px bottom padding), which at a 16px root is 38px for
// name + time and 51px with the detail.
const UNGROUPED_CHROME_ABOVE_PX = 1 + 5;
const UNGROUPED_LINE_GAP_PX = 1;
const UNGROUPED_CHROME_BELOW_PX = 3 + 1;
// Grouped card: 1px border, 1px padding and the 18px identity strip above the
// time line (the name is visually hidden), no gaps, and the whole 2px padding
// and 1px border below, so flexbox never compresses the strip below its tile
// height. At a 16px root that is 37px for strip + time and 49px with the detail.
const GROUPED_CHROME_ABOVE_PX = 1 + 1 + 18;
const GROUPED_CHROME_BELOW_PX = 2 + 1;

/** Smallest card heights (px) at which the time line, and then the detail line,
 *  fit at the given root font size. */
export type WeekCalendarEventLineFitHeights = {
  readonly groupedTime: number;
  readonly groupedDetail: number;
  readonly ungroupedTime: number;
  readonly ungroupedDetail: number;
};

export function weekCalendarEventLineFitHeights(rootFontSizePx: number): WeekCalendarEventLineFitHeights {
  const rem = Number.isFinite(rootFontSizePx) && rootFontSizePx > 0
    ? rootFontSizePx
    : WEEK_CALENDAR_BASE_ROOT_FONT_SIZE_PX;
  const groupedTime = GROUPED_CHROME_ABOVE_PX + TIME_LINE_REM * rem + GROUPED_CHROME_BELOW_PX;
  const ungroupedTime = UNGROUPED_CHROME_ABOVE_PX
    + NAME_LINE_REM * rem
    + UNGROUPED_LINE_GAP_PX
    + TIME_LINE_REM * rem
    + UNGROUPED_CHROME_BELOW_PX;
  return {
    groupedTime,
    groupedDetail: groupedTime + DETAIL_LINE_REM * rem,
    ungroupedTime,
    ungroupedDetail: ungroupedTime + UNGROUPED_LINE_GAP_PX + DETAIL_LINE_REM * rem,
  };
}

export type WeekIdentityStripPlan = {
  readonly visibleCount: number;
  readonly hiddenCount: number;
  /** Largest tile size (13–18px) at which this strip fits its column; 18 means
   *  the regular size, smaller values are applied per strip via CSS vars. */
  readonly tilePx: number;
  readonly gapPx: number;
};

/** The model caps identity icons at this count; narrower columns show fewer. */
export const WEEK_IDENTITY_STRIP_MAX_ICONS = 4;

// Identity strip geometry (see week-dashboard.css). The chrome around the
// strip inside a day column is 1px+6px column insets (WeekDashboard.tsx),
// 6px+6px event padding, 1px+1px borders and the ~11px category-dot grid
// column. The "+N" chip is roughly 22px for one digit and 27px for two.
const IDENTITY_STRIP_HORIZONTAL_CHROME_PX = 32;
const IDENTITY_TILE_BASE_PX = 18;
const IDENTITY_TILE_MIN_PX = 13;
const IDENTITY_GAP_BASE_PX = 3;
const IDENTITY_GAP_TIGHT_PX = 2;
/** Narrow columns drop icons into the "+N" chip down to two; only when even
 *  two icons + chip cannot fit at full size does the tile size shrink. */
const IDENTITY_MIN_VISIBLE_ICONS = 2;

/** The chip's own font and min-width scale down with the tiles (CSS clamp), so
 *  shrunk strips reserve less room for it than full-size ones. */
function identityMoreChipWidthPx(hiddenCount: number, shrunk: boolean): number {
  if (shrunk) return hiddenCount >= 10 ? 24 : 19;
  return hiddenCount >= 10 ? 27 : 22;
}

function identityStripWidthPx(visibleCount: number, hiddenCount: number, tilePx: number, gapPx: number): number {
  const iconsWidth = visibleCount * tilePx + (visibleCount - 1) * gapPx;
  if (hiddenCount === 0) return iconsWidth;
  return iconsWidth + gapPx + identityMoreChipWidthPx(hiddenCount, tilePx < IDENTITY_TILE_BASE_PX);
}

/** How many identity icons (plus a recomputed "+N") fit in a day column, and
 *  the largest 13–18px tile size that fills the chosen strip into the width.
 *  With no usable width measurement, falls back to the model's own cap so
 *  behaviour matches the pre-measurement rendering. */
export function planWeekIdentityStrip(
  identityCount: number,
  modelHiddenCount: number,
  dayColumnWidth: number | null,
): WeekIdentityStripPlan {
  const fallback: WeekIdentityStripPlan = {
    visibleCount: identityCount,
    hiddenCount: modelHiddenCount,
    tilePx: IDENTITY_TILE_BASE_PX,
    gapPx: IDENTITY_GAP_BASE_PX,
  };
  if (identityCount === 0) return fallback;
  if (dayColumnWidth === null || !Number.isFinite(dayColumnWidth) || dayColumnWidth <= IDENTITY_STRIP_HORIZONTAL_CHROME_PX) {
    return fallback;
  }

  // Pick the icon count with regular-size metrics, keeping the two-icon floor.
  const availableWidth = dayColumnWidth - IDENTITY_STRIP_HORIZONTAL_CHROME_PX;
  const minVisibleCount = Math.min(IDENTITY_MIN_VISIBLE_ICONS, identityCount);
  let visibleCount = minVisibleCount;
  for (let candidate = identityCount; candidate > minVisibleCount; candidate -= 1) {
    const hiddenCount = modelHiddenCount + (identityCount - candidate);
    if (identityStripWidthPx(candidate, hiddenCount, IDENTITY_TILE_BASE_PX, IDENTITY_GAP_BASE_PX) <= availableWidth) {
      visibleCount = candidate;
      break;
    }
  }
  const hiddenCount = modelHiddenCount + (identityCount - visibleCount);

  if (identityStripWidthPx(visibleCount, hiddenCount, IDENTITY_TILE_BASE_PX, IDENTITY_GAP_BASE_PX) <= availableWidth) {
    return { visibleCount, hiddenCount, tilePx: IDENTITY_TILE_BASE_PX, gapPx: IDENTITY_GAP_BASE_PX };
  }

  // Shrink continuously: the largest tile at which the strip still fits, so a
  // strip that is only a few pixels over loses those pixels, not a full tier.
  const gapPx = IDENTITY_GAP_TIGHT_PX;
  for (let tilePx = IDENTITY_TILE_BASE_PX - 1; tilePx > IDENTITY_TILE_MIN_PX; tilePx -= 1) {
    if (identityStripWidthPx(visibleCount, hiddenCount, tilePx, gapPx) <= availableWidth) {
      return { visibleCount, hiddenCount, tilePx, gapPx };
    }
  }
  return { visibleCount, hiddenCount, tilePx: IDENTITY_TILE_MIN_PX, gapPx };
}

export function buildWeekCalendarEventLayout(
  event: WeekCalendarEvent,
  calendarHourHeight: number,
  rootFontSizePx: number = WEEK_CALENDAR_BASE_ROOT_FONT_SIZE_PX,
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
  const lineFitHeights = weekCalendarEventLineFitHeights(rootFontSizePx);
  const isCompactEvent = event.isShort
    || eventHeight < (event.isGroupedCluster ? lineFitHeights.groupedTime : lineFitHeights.ungroupedTime)
    || event.laneCount > 2;
  const showsIdentityStrip = event.isGroupedCluster && !isTinyEvent;
  const showsInlineDetail = !isCompactEvent
    && event.sessionCount <= 1
    && eventHeight >= (showsIdentityStrip ? lineFitHeights.groupedDetail : lineFitHeights.ungroupedDetail);

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
