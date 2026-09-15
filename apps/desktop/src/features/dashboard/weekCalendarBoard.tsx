import { useRef, type ReactNode, type RefObject, type WheelEvent } from "react";

/** Split-axis week calendar: weekday labels sit on a horizontal board, timeline scrolls vertically. */
export function handleWeekCalendarBoardWheel(
  event: { deltaX: number; deltaY: number; target: EventTarget | null },
  board: HTMLElement | null,
  scroller: HTMLElement | null,
): void {
  if (!board || !scroller) return;
  const onScroller = event.target instanceof Node && scroller.contains(event.target);
  if (onScroller) {
    if (event.deltaX !== 0 && board.scrollWidth > board.clientWidth) {
      board.scrollLeft += event.deltaX;
    }
    return;
  }
  if (event.deltaY !== 0) scroller.scrollTop += event.deltaY;
}

export function WeekCalendarBoard({
  children,
  scrollerRef,
}: {
  children: ReactNode;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={boardRef}
      className="week-v2-calendar__board"
      onWheel={(event: WheelEvent<HTMLDivElement>) => {
        handleWeekCalendarBoardWheel(event, boardRef.current, scrollerRef.current);
      }}
    >
      {children}
    </div>
  );
}
