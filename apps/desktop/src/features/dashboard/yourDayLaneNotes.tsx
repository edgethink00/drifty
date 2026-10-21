import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { WeekCalendarEvent } from "./weekCalendar";
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

type ToneStyle = CSSProperties & { "--event-tone": string };

const DAY_MINUTES = 24 * 60;

/** Under 26px a card holds one compact 14px line; under 16px (with its border) not even that,
 *  so CSS leaves it out. The full label remains on the button. */
function shortCardClass(height: number) {
  if (height >= 26) return "";
  return " your-day-proportional-card--compact" + (height < 16 ? " your-day-proportional-card--thin" : "");
}

const rangeOf = (item: LaneItem): LaneRange => ({ start: item.top, end: item.bottom });
const drawnMinutes = (item: LaneItem) => item.drawnBottom - item.drawnTop;
const byTime = (items: readonly LaneItem[]) => [...items].sort((a, b) => a.drawnTop - b.drawnTop);
const nameClass = (item: LaneItem) => "your-day-name" + (item.named ? "" : " your-day-name--app");
const tone = (item: LaneItem): ToneStyle => ({ "--event-tone": item.tone });

/** Each card sits at its exact time and is as tall as that time on the chart's scale; zoom
 *  changes only the density. Names wrap within that height rather than enlarging the card. */
export function LaneNotes({ items, interact, duration, height, icon }: LaneNotesProps) {
  const sorted = useMemo(() => byTime(items), [items]);
  return <>
    {sorted.map((item) => {
      const top = item.drawnTop / DAY_MINUTES * height;
      const cardHeight = item.drawnBottom / DAY_MINUTES * height - top;
      return <button key={item.event.id} type="button"
        className={"your-day-entry your-day-anchored-card" + shortCardClass(cardHeight)}
        style={{ ...tone(item), top, height: cardHeight }}
        aria-label={item.hoverTitle}
        data-event-id={item.event.id}
        data-start-minute={item.drawnTop}
        data-duration-minutes={drawnMinutes(item)}
        data-work-label-origin={item.origin}
        {...interact([rangeOf(item)], item.openMinute)}>
        <span className="your-day-notes__line">
          {icon(item, "your-day-icon")}
          <span className={nameClass(item)}
            style={{ WebkitLineClamp: Math.max(1, Math.floor((cardHeight - 8) / 16)) }}>
            {item.title}
          </span>
          <span className="your-day-length">{duration(drawnMinutes(item))}</span>
        </span>
      </button>;
    })}
  </>;
}
