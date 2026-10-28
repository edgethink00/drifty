import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { WeekCalendarEvent } from "./weekCalendar";
import { clearsShortBar, LONE_BLOCK_SHARE } from "./weekCardBlocks";
import type { ActivityInspectorLabel } from "../activity-labels/activityInspectorLabel";

/*
 * The notes column beside Your Day's hours-down chart: each block's name and length beside its
 * time, sized by that time. It shares the lane's blocks, cell highlight and activity
 * (YourDayCardLane.tsx); your-day-notes.css sets its type and cards.
 */

/** One drawn block, in logical minutes of the day. */
export type LaneItem = {
  readonly event: WeekCalendarEvent;
  readonly top: number;
  readonly bottom: number;
  /** Where the block is drawn: it ends where the next one starts, as in Week. */
  readonly drawnTop: number;
  readonly drawnBottom: number;
  readonly title: string;
  readonly description: string | null;
  readonly named: boolean;
  readonly origin: string | undefined;
  readonly tone: string;
  readonly timeLabel: string;
  /** The drawn time with a shared AM/PM written once: "9:30–11:00 AM". */
  readonly clockRange: string;
  readonly hoverTitle: string;
  /** The first minute of the card's own time, so its card opens rather than a run folded in before it. */
  readonly openMinute: number;
  /** The block's name as drawn (every block it holds), for the panel's log. */
  readonly label?: ActivityInspectorLabel | null;
};

export type LaneRange = { readonly start: number; readonly end: number };

/** Pointing at an entry lights these ranges' cells; clicking it opens the activity card at openAt. */
export type LaneInteract = (ranges: readonly LaneRange[], openAt: number) => {
  readonly onClick: (click: { readonly currentTarget: HTMLElement }) => void;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly "data-flow-highlighted": boolean;
};

export type LaneNotesProps = {
  readonly items: readonly LaneItem[];
  readonly interact: LaneInteract;
  readonly duration: (minutes: number) => string;
  readonly icon: (item: LaneItem, className: string) => ReactNode;
  /** The lane's height in pixels (0 before it is measured). */
  readonly height: number;
};

type CardStyle = CSSProperties & { "--event-tone": string; "--lane-content-offset"?: string };

const DAY_MINUTES = 24 * 60;

/** The height of one compact line with its border: the least a card needs to show its name. */
export const LANE_ONE_LINE_PX = 16;

/** Under 26px a card holds one compact 14px line; under 16px (with its border) not even that,
 *  so CSS leaves it out. The full label remains on the button. */
function shortCardClass(height: number) {
  if (height >= 26) return "";
  return " your-day-proportional-card--compact" + (height < LANE_ONE_LINE_PX ? " your-day-proportional-card--thin" : "");
}

const rangeOf = (item: LaneItem): LaneRange => ({ start: item.top, end: item.bottom });
const drawnMinutes = (item: LaneItem) => item.drawnBottom - item.drawnTop;
const byTime = (items: readonly LaneItem[]) => [...items].sort((a, b) => a.drawnTop - b.drawnTop);
const nameClass = (item: LaneItem) => "your-day-name" + (item.named ? "" : " your-day-name--app");
const clearsLoneBar = (item: LaneItem) => clearsShortBar(item.event.durationMinutes, item.event.activeDurationMinutes, LONE_BLOCK_SHARE);

/** Where one card is drawn, in pixels. contentOffset is the top of this card that the card above
 *  borrowed, so its own text starts below it. */
export type LaneCardPlace = {
  readonly item: LaneItem;
  readonly top: number;
  readonly height: number;
  readonly contentOffset: number;
  /** Drawn over the top of the next card to have a line of its own. */
  readonly borrowing: boolean;
};

/**
 * Card places in pixels, in time order. A card is as tall as its time on the chart's scale.
 * A card too short for one line that clears 40% of the short bar (6 minutes with 2 recorded,
 * LONE_BLOCK_SHARE) is raised to that line, its top staying at its start time:
 *  - where the lane below its start stays empty for it (up to the next card or the day's end);
 *  - otherwise by borrowing the top of the next card, when that card is tall enough to keep a
 *    line of its own below the borrowed part; its text then starts lower (owner choice
 *    2026-10-29, review option B).
 * Any other card keeps its time's height and CSS leaves it out. So a short activity between
 * long ones keeps its name, a lone minute stays out, and a run of short pieces stays as dense
 * as before: the first of two short cards in a row has only a short card below to borrow from.
 */
export function laneCardPlaces(sorted: readonly LaneItem[], height: number): LaneCardPlace[] {
  const px = (minute: number) => minute / DAY_MINUTES * height;
  const tops = sorted.map((item) => px(item.drawnTop));
  const nextTop = (index: number) => (index + 1 < sorted.length ? tops[index + 1] : height);
  const places: LaneCardPlace[] = sorted.map((item, index) => {
    const top = tops[index];
    const exact = px(item.drawnBottom) - top;
    const place = { item, top, height: exact, contentOffset: 0, borrowing: false };
    if (exact >= LANE_ONE_LINE_PX || !clearsLoneBar(item)) return place;
    return nextTop(index) - top >= LANE_ONE_LINE_PX ? { ...place, height: LANE_ONE_LINE_PX } : place;
  });
  for (let index = 0; height > 0 && index + 1 < places.length; index += 1) {
    const card = places[index];
    const next = places[index + 1];
    if (card.height >= LANE_ONE_LINE_PX || next.height < LANE_ONE_LINE_PX || !clearsLoneBar(card.item)) continue;
    const need = LANE_ONE_LINE_PX - (next.top - card.top);
    if (need <= 0 || next.height - next.contentOffset - need < LANE_ONE_LINE_PX) continue;
    places[index] = { ...card, height: LANE_ONE_LINE_PX, borrowing: true };
    places[index + 1] = { ...next, contentOffset: next.contentOffset + need };
  }
  return places;
}

/** Each card sits at its exact time and is as tall as that time on the chart's scale; zoom
 *  changes only the density. Names wrap within that height rather than enlarging the card;
 *  only a card too short for one line is raised to it, where the lane has room (laneCardPlaces). */
export function LaneNotes({ items, interact, duration, height, icon }: LaneNotesProps) {
  const sorted = useMemo(() => byTime(items), [items]);
  const places = useMemo(() => laneCardPlaces(sorted, height), [sorted, height]);
  return <>
    {places.map(({ item, top, height: cardHeight, contentOffset, borrowing }) => {
      const textHeight = cardHeight - contentOffset;
      return <button key={item.event.id} type="button"
        className={"your-day-entry your-day-anchored-card" + shortCardClass(textHeight)
          + (borrowing ? " your-day-anchored-card--borrowing" : "")
          + (contentOffset > 0 ? " your-day-anchored-card--offset" : "")}
        style={{ "--event-tone": item.tone, top, height: cardHeight, ...(contentOffset > 0 ? { "--lane-content-offset": contentOffset + "px" } : {}) } as CardStyle}
        aria-label={item.hoverTitle}
        data-event-id={item.event.id}
        data-start-minute={item.drawnTop}
        data-duration-minutes={drawnMinutes(item)}
        data-work-label-origin={item.origin}
        {...interact([rangeOf(item)], item.openMinute)}>
        <span className="your-day-notes__line">
          {icon(item, "your-day-icon")}
          <span className={nameClass(item)}
            style={{ WebkitLineClamp: Math.max(1, Math.floor((textHeight - 8) / 16)) }}>
            {item.title}
          </span>
          <span className="your-day-length">{duration(drawnMinutes(item))}</span>
        </span>
      </button>;
    })}
  </>;
}
