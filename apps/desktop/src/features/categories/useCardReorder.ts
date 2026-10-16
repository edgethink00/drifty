import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/**
 * Drag a card to a new place in a list. Pointer events rather than HTML drag
 * and drop: the desktop shell's own file drop handling swallows HTML drag
 * events on Windows. While a card moves, the cards it passes slide out of its
 * way; on release the list order changes once. Holding near the list's top
 * or bottom edge scrolls it.
 */
export type CardReorderDrag = {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly dy: number;
  readonly height: number;
};

type Measure = { readonly top: number; readonly height: number };

type Gesture = {
  readonly pointerId: number;
  readonly id: string;
  readonly startY: number;
  readonly startScroll: number;
  readonly threshold: number;
  started: boolean;
  clientY: number;
};

const EDGE = 40;
const EDGE_SPEED = 9;

export function useCardReorder({
  listRef,
  scrollRef,
  ids,
  cardSelector,
  onMove,
}: {
  readonly listRef: RefObject<HTMLElement | null>;
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** The draggable cards' ids, in list order. */
  readonly ids: readonly string[];
  /** The card element for an id. */
  readonly cardSelector: (id: string) => string;
  readonly onMove: (id: string, to: number) => void;
}) {
  const [drag, setDragState] = useState<CardReorderDrag | null>(null);
  const dragRef = useRef<CardReorderDrag | null>(null);
  const setDrag = (next: CardReorderDrag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const gesture = useRef<Gesture | null>(null);
  const measures = useRef<Measure[]>([]);
  const frame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ ids, onMove, cardSelector });
  latest.current = { ids, onMove, cardSelector };

  const scrollTop = useCallback(() => scrollRef.current?.scrollTop ?? 0, [scrollRef]);

  const update = useCallback(() => {
    const current = gesture.current;
    if (!current?.started) return;
    const list = measures.current;
    const from = latest.current.ids.indexOf(current.id);
    const own = list[from];
    if (!own || from < 0) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const raw = current.clientY - current.startY + (scrollTop() - current.startScroll);
    const dy = Math.max(first.top - own.top, Math.min(last.top + last.height - own.top - own.height, raw));
    const center = own.top + own.height / 2 + dy;
    let to = 0;
    list.forEach((item, index) => {
      if (index !== from && item.top + item.height / 2 < center) to += 1;
    });
    setDrag({ id: current.id, from, to, dy, height: own.height });
     
  }, [scrollTop]);

  const tick = useCallback(() => {
    frame.current = null;
    const current = gesture.current;
    const scroller = scrollRef.current;
    if (!current?.started || !scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const step = current.clientY < bounds.top + EDGE ? -EDGE_SPEED : current.clientY > bounds.bottom - EDGE ? EDGE_SPEED : 0;
    if (step !== 0) {
      scroller.scrollTop += step;
      update();
    }
    frame.current = window.requestAnimationFrame(tick);
  }, [scrollRef, update]);

  const start = useCallback(() => {
    const current = gesture.current;
    const listElement = listRef.current;
    if (!current || !listElement) return;
    const offset = scrollTop();
    measures.current = latest.current.ids.map((id) => {
      const element = listElement.querySelector<HTMLElement>(latest.current.cardSelector(id));
      const rect = element?.getBoundingClientRect();
      return { top: (rect?.top ?? 0) + offset, height: rect?.height ?? 0 };
    });
    current.started = true;
    suppressClick.current = true;
    update();
    if (frame.current === null) frame.current = window.requestAnimationFrame(tick);
  }, [listRef, scrollTop, tick, update]);

  const finish = useCallback((commit: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
    const state = dragRef.current;
    setDrag(null);
    if (commit && current?.started && state && state.to !== state.from) latest.current.onMove(state.id, state.to);
    // The click that ends a drag must not open the card.
    window.setTimeout(() => { suppressClick.current = false; }, 0);
     
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.clientY = event.clientY;
      if (!current.started) {
        if (Math.abs(event.clientY - current.startY) < current.threshold) return;
        start();
        return;
      }
      event.preventDefault();
      update();
    };
    const up = (event: PointerEvent) => {
      if (gesture.current && event.pointerId === gesture.current.pointerId) finish(true);
    };
    const cancel = (event: PointerEvent) => {
      if (gesture.current && event.pointerId === gesture.current.pointerId) finish(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current?.started) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [finish, start, update]);

  /** Starts a gesture: at once from a grip, after a few pixels from a whole card. */
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, id: string, threshold = 0) => {
    if (event.button !== 0 || gesture.current) return;
    if (threshold === 0) event.preventDefault();
    gesture.current = { pointerId: event.pointerId, id, startY: event.clientY, startScroll: scrollTop(), threshold, started: false, clientY: event.clientY };
    if (threshold === 0) start();
  };

  /** Where a card sits while another moves: the moving card follows the pointer, the ones it passed make room. */
  const styleFor = (id: string): CSSProperties | undefined => {
    if (!drag) return undefined;
    const index = ids.indexOf(id);
    if (id === drag.id) return { transform: "translateY(" + drag.dy + "px)", zIndex: 3, transition: "none" };
    const shift = drag.from < drag.to && index > drag.from && index <= drag.to
      ? -drag.height
      : drag.from > drag.to && index >= drag.to && index < drag.from ? drag.height : 0;
    return { transform: shift ? "translateY(" + shift + "px)" : undefined, transition: "transform 160ms cubic-bezier(0.2, 0, 0, 1)" };
  };

  return {
    drag,
    beginDrag,
    styleFor,
    /** True for the click that ends a drag, which must not open the card. */
    consumeClick: () => suppressClick.current,
  };
}
