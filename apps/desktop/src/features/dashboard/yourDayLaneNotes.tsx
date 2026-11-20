import { useMemo, type CSSProperties, type ReactNode } from "react";
import { logicalMinuteOfDay } from "@drifty/domain";
import type { WeekCalendarEvent } from "./weekCalendar";
import { clearsShortBar, LONE_BLOCK_SHARE } from "./weekCardBlocks";
import type { ActivityInspectorLabel } from "../activity-labels/activityInspectorLabel";
import { useLocalization } from "../localization/LocalizationContext";
import type { PhoneFlowCell } from "../phone-time/phoneFlowCells";
import { phoneTimeDurationLabel } from "../phone-time/phoneTimeFormat";

/*
 * The notes column beside Your Day's hours-down chart: each block's name and length beside its
 * time, sized by that time. It shares the lane's blocks, cell highlight and activity
 * (YourDayCardLane.tsx); your-day-notes.css sets its type and cards. Cards of a window that is
 * still open, whose AI name is on its way, carry a "Naming" chip until the window is named.
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
  /** In a window still open and not named yet: its AI name is on its way. */
  readonly pending?: boolean;
  /** Other activities folded into or continuing this block that its name does not cover ("+2"). */
  readonly more?: number;
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
  readonly startOfDayMinutes: number;
  readonly phoneCellsByMinute?: ReadonlyMap<number, PhoneFlowCell>;
  /** The chip and its hover note for cards whose AI name is on its way; without it they show none. */
  readonly naming?: { readonly chip: string; readonly note: string };
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

/** A run of back-to-back cards that are each too short to show, drawn as one card. */
export type LaneRunPlace = {
  readonly items: readonly LaneItem[];
  /** The run's longest card in its most common colour: its name, icon and colour stand for the run. */
  readonly lead: LaneItem;
  readonly top: number;
  readonly height: number;
  readonly minutes: number;
  /** Activities the lead's name does not cover ("+5"). */
  readonly more: number;
};

/**
 * Cards left out for being under one line (laneCardPlaces) that follow each other with no gap
 * leave the lane blank beside a busy stretch of the chart: on a real day six 15-minute pieces
 * between 8 and 9:30 PM drew no card at all. Two or more of them in a row whose time together
 * reaches one line become one card over that time, named after the longest piece with "+N".
 */
export function laneShortRuns(places: readonly LaneCardPlace[]): LaneRunPlace[] {
  const runs: LaneRunPlace[] = [];
  let current: LaneCardPlace[] = [];
  const flush = () => {
    if (current.length >= 2) {
      const first = current[0]!;
      const last = current[current.length - 1]!;
      const height = last.top + last.height - first.top;
      if (height >= LANE_ONE_LINE_PX) {
        const items = current.map((place) => place.item);
        const toneMinutes = new Map<string, number>();
        for (const item of items) toneMinutes.set(item.tone, (toneMinutes.get(item.tone) ?? 0) + drawnMinutes(item));
        const tone = [...toneMinutes].sort((a, b) => b[1] - a[1])[0]![0];
        const lead = items.filter((item) => item.tone === tone).sort((a, b) => drawnMinutes(b) - drawnMinutes(a))[0]!;
        runs.push({
          items, lead, top: first.top, height,
          minutes: last.item.drawnBottom - first.item.drawnTop,
          more: items.length - 1 + items.reduce((sum, item) => sum + (item.more ?? 0), 0),
        });
      }
    }
    current = [];
  };
  for (const place of places) {
    const hidden = place.height - place.contentOffset < LANE_ONE_LINE_PX;
    const previous = current[current.length - 1];
    if (!hidden) { flush(); continue; }
    if (previous && place.item.drawnTop > previous.item.drawnBottom) flush();
    current.push(place);
  }
  flush();
  return runs;
}

/** Give each phone block one line at the first painted cell with room beside it. */
function phoneNotePlaces(
  cells: ReadonlyMap<number, PhoneFlowCell> | undefined,
  cards: readonly LaneCardPlace[],
  height: number,
  startOfDayMinutes: number,
) {
  if (!cells?.size || height < LANE_ONE_LINE_PX) return [];
  const visibleCards = cards.filter((card) => card.height >= LANE_ONE_LINE_PX);
  const candidates = [...cells.values()].map((cell) => ({
    cell,
    top: logicalMinuteOfDay(cell.minuteOfDay, startOfDayMinutes) / DAY_MINUTES * height,
  })).sort((a, b) => a.top - b.top);
  const placed = new Set<number>();
  const notes: typeof candidates = [];
  let availableTop = 0;
  for (const note of candidates) {
    const { cell, top } = note;
    const bottom = top + LANE_ONE_LINE_PX;
    if (placed.has(cell.blockIndex) || top < availableTop || bottom > height) continue;
    if (visibleCards.some((card) => top < card.top + card.height && card.top < bottom)) continue;
    notes.push(note);
    placed.add(cell.blockIndex);
    availableTop = bottom;
  }
  return notes;
}

/** Each card sits at its exact time and is as tall as that time on the chart's scale; zoom
 *  changes only the density. Names wrap within that height rather than enlarging the card;
 *  only a card too short for one line is raised to it, where the lane has room (laneCardPlaces). */
export function LaneNotes({ items, interact, duration, height, startOfDayMinutes, phoneCellsByMinute, icon, naming }: LaneNotesProps) {
  const { effectiveLanguage, t } = useLocalization();
  const sorted = useMemo(() => byTime(items), [items]);
  const places = useMemo(() => laneCardPlaces(sorted, height), [sorted, height]);
  const runs = useMemo(() => laneShortRuns(places), [places]);
  const phoneNotes = useMemo(() => phoneNotePlaces(phoneCellsByMinute,
    [...places, ...runs.map((run) => ({ item: run.lead, top: run.top, height: run.height, contentOffset: 0, borrowing: false }))],
    height, startOfDayMinutes),
  [phoneCellsByMinute, places, runs, height, startOfDayMinutes]);
  return <>
    {places.map(({ item, top, height: cardHeight, contentOffset, borrowing }) => {
      const textHeight = cardHeight - contentOffset;
      const chip = item.pending ? naming : undefined;
      return <button key={item.event.id} type="button"
        className={"your-day-entry your-day-anchored-card" + shortCardClass(textHeight)
          + (borrowing ? " your-day-anchored-card--borrowing" : "")
          + (contentOffset > 0 ? " your-day-anchored-card--offset" : "")}
        style={{ "--event-tone": item.tone, top, height: cardHeight, ...(contentOffset > 0 ? { "--lane-content-offset": contentOffset + "px" } : {}) } as CardStyle}
        aria-label={item.hoverTitle + (chip ? "\n" + chip.note : "")}
        title={chip?.note}
        data-event-id={item.event.id}
        data-start-minute={item.drawnTop}
        data-duration-minutes={drawnMinutes(item)}
        data-work-label-origin={item.origin}
        data-naming={chip ? true : undefined}
        {...interact([rangeOf(item)], item.openMinute)}>
        <span className="your-day-notes__line">
          {icon(item, "your-day-icon")}
          <span className={nameClass(item)}
            style={{ WebkitLineClamp: Math.max(1, Math.floor((textHeight - 8) / 16)) }}>
            {item.title}
          </span>
          {item.more ? <span className="your-day-more">+{item.more}</span> : null}
          {chip ? <span className="your-day-naming-chip">{chip.chip}</span> : null}
          <span className="your-day-length">{duration(drawnMinutes(item))}</span>
        </span>
      </button>;
    })}
    {runs.map((run) => (
      <button key={"run:" + run.items[0]!.event.id} type="button"
        className={"your-day-entry your-day-anchored-card your-day-run-card" + shortCardClass(run.height)}
        style={{ "--event-tone": run.lead.tone, top: run.top, height: run.height } as CardStyle}
        aria-label={run.items.map((item) => item.hoverTitle).join("\n")}
        data-event-id={run.lead.event.id}
        data-start-minute={run.items[0]!.drawnTop}
        data-duration-minutes={run.minutes}
        data-run-count={run.items.length}
        {...interact(run.items.map(rangeOf), run.lead.openMinute)}>
        <span className="your-day-notes__line">
          {icon(run.lead, "your-day-icon")}
          <span className={nameClass(run.lead)}
            style={{ WebkitLineClamp: Math.max(1, Math.floor((run.height - 8) / 16)) }}>
            {run.lead.title}
          </span>
          <span className="your-day-more">+{run.more}</span>
          <span className="your-day-length">{duration(run.minutes)}</span>
        </span>
      </button>
    ))}
    {phoneNotes.map(({ cell, top }) => (
      <div key={cell.blockIndex} className="your-day-phone-note" style={{ top }}>
        <span className="flow-phone-swatch" aria-hidden="true" />
        <span className="your-day-phone-note__label">{t("dashboard.today.phoneTime")}</span>
        <span className="your-day-length">
          {t("dashboard.today.phoneTimeAbout", { duration: phoneTimeDurationLabel(cell.block, effectiveLanguage) })}
        </span>
      </div>
    ))}
  </>;
}
