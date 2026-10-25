import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { layoutTeamBoard } from "./teamBoardModel";

/**
 * Drag a board widget by the card itself (owner decision 2026-10-20): the
 * card lifts and follows the pointer while its place stays as an outlined
 * slot, and the other widgets slide out of the way as it passes, so the board
 * shows the order it will keep. On release the card settles into its slot.
 * Pointer events, as the category cards' reorder uses: the desktop shell's own
 * file drop handling swallows HTML drag events on Windows. Holding near the
 * scroller's edge scrolls it; Escape puts everything back.
 *
 * Every change of place (a drag, the arrow keys, a resize, a removal) slides
 * the widgets from where they were to where they land.
 *
 * Held steady (2026-10-20): the lifted card follows the pointer frame by frame
 * on its own transform, so moving it never redraws the board, and the board
 * finishes one slide before it makes the next change.
 *
 * Where it lands (2026-10-22): the board tries the card at every place in the
 * order and keeps the one that puts its slot under the pointer, or nearest to
 * it. On a board of mixed widths, putting the card before the widget under the
 * pointer could leave it where it was or let a neighbour slide under the
 * pointer and swap back every slide; a slot already under the pointer stays,
 * and a new place must bring the slot clearly nearer. The scroller scrolls at
 * its edge only once the pointer has been away from both edges.
 */
export type BoardSortableItem = { readonly key: string; readonly size: string };

export type BoardDragState = {
  readonly key: string;
  /** Where the lifted card starts in the window; it then follows the pointer on its own (liftedTransform). */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type Gesture = {
  readonly pointerId: number;
  readonly target: HTMLElement;
  readonly key: string;
  readonly startX: number;
  readonly startY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly scroller: HTMLElement | null;
  started: boolean;
  clientX: number;
  clientY: number;
  /** No widget makes way before this time, while the last change is still sliding. */
  quietUntil: number;
  /** The pointer has been away from the scroller's edges, so holding at an edge now scrolls it. */
  armed: boolean;
};

/** Pixels the pointer moves before a press becomes a drag, so a click on the title stays a click. */
const THRESHOLD = 4;
/** Holding within this many pixels of the scroller's edge scrolls it, faster nearer the edge. */
const EDGE = 64;
const EDGE_MAX_SPEED = 18;
const SLIDE_MS = 220;
const EASE = String(SLIDE_MS) + "ms cubic-bezier(0.2, 0, 0, 1)";
/** A widget slides to its new place and, when its size changed, grows or shrinks to it on the same curve. */
const SLIDE = "transform " + EASE + ", width " + EASE + ", height " + EASE;
const SETTLE_MS = 260;
/** How much nearer to the pointer, in pixels, a new place must bring the card's slot before the board changes. */
export const DROP_HYSTERESIS = 24;
/**
 * Sideways distance counts half: a card dragged up or down is headed for
 * another row, while which column it takes in a row follows from the packing.
 */
const SIDEWAYS_WEIGHT = 0.5;

/** The lifted card's place in the window, as its transform. */
export function liftedTransform(left: number, top: number): string {
  return "translate3d(" + String(Math.round(left)) + "px, " + String(Math.round(top)) + "px, 0)";
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let element = node.parentElement; element; element = element.parentElement) {
    const { overflowY } = window.getComputedStyle(element);
    if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight) return element;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/** Moves a key to where another one is, as the list was: past it going down, before it going up. */
export function sortedPast(order: readonly string[], key: string, over: string): string[] {
  const next = order.filter((entry) => entry !== key);
  next.splice(order.indexOf(over), 0, key);
  return next;
}

/** The board's grid in pixels: its columns, a column's width, a row's height and the gaps between them. */
export type BoardGridMetrics = { readonly columns: number; readonly column: number; readonly row: number; readonly gapX: number; readonly gapY: number };

function spanOf(size: string): { readonly w: number; readonly h: number } {
  const [w, h] = size.split("x").map(Number);
  return { w: w ?? 1, h: h ?? 1 };
}

/**
 * The order that puts the dragged widget's slot under a point of the grid (in
 * pixels from its top left), or nearest to it, or null to keep the order: when
 * its slot already holds the point, or no place brings it DROP_HYSTERESIS
 * nearer. Among equally near places the one fewest steps away wins.
 */
export function bestDropOrder(order: readonly string[], key: string, sizes: ReadonlyMap<string, string>, grid: BoardGridMetrics, x: number, y: number, hysteresis = DROP_HYSTERESIS): string[] | null {
  const span = spanOf(sizes.get(key) ?? "1x1");
  const w = Math.min(span.w, grid.columns);
  const width = w * grid.column + (w - 1) * grid.gapX;
  const height = span.h * grid.row + (span.h - 1) * grid.gapY;
  const distanceFor = (candidate: readonly string[]) => {
    const place = layoutTeamBoard(candidate.map((entry) => ({ key: entry, size: sizes.get(entry) ?? "1x1" })), grid.columns, 1).placements.find((entry) => entry.key === key);
    if (!place) return Number.POSITIVE_INFINITY;
    const left = (place.col - 1) * (grid.column + grid.gapX);
    const top = (place.row - 1) * (grid.row + grid.gapY);
    const dx = Math.max(left - x, 0, x - (left + width));
    const dy = Math.max(top - y, 0, y - (top + height));
    return Math.hypot(dx * SIDEWAYS_WEIGHT, dy);
  };
  const now = distanceFor(order);
  if (now === 0) return null;
  const from = order.indexOf(key);
  const rest = order.filter((entry) => entry !== key);
  let best: { readonly order: string[]; readonly distance: number; readonly steps: number } | null = null;
  for (let index = 0; index <= rest.length; index += 1) {
    if (index === from) continue;
    const candidate = [...rest.slice(0, index), key, ...rest.slice(index)];
    const distance = distanceFor(candidate);
    const steps = Math.abs(index - from);
    if (!best || distance < best.distance - 0.5 || (Math.abs(distance - best.distance) <= 0.5 && steps < best.steps)) best = { order: candidate, distance, steps };
  }
  return best && best.distance <= now - hysteresis ? best.order : null;
}

/** The grid's columns, cell sizes and gaps as laid out now (one column on a narrow window). */
function gridMetrics(grid: HTMLElement): BoardGridMetrics {
  const style = window.getComputedStyle(grid);
  const columns = Math.max(1, style.gridTemplateColumns.split(" ").filter(Boolean).length);
  const gapX = Number.parseFloat(style.columnGap) || 0;
  const gapY = Number.parseFloat(style.rowGap) || 0;
  const row = Number.parseFloat(style.gridAutoRows) || 1;
  return { columns, column: (grid.clientWidth - gapX * (columns - 1)) / columns, row, gapX, gapY };
}

export function useBoardSortable({ gridRef, items, onCommit }: {
  readonly gridRef: RefObject<HTMLElement | null>;
  /** The widgets on the board, in order. */
  readonly items: readonly BoardSortableItem[];
  /** The order the board keeps after a drag. */
  readonly onCommit: (order: readonly string[]) => void;
}) {
  const keys = items.map((item) => item.key);
  const [preview, setPreview] = useState<readonly string[] | null>(null);
  const [drag, setDrag] = useState<BoardDragState | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [flipTick, setFlipTick] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  /** The lifted card, moved directly as the pointer moves. */
  const liftedRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<readonly string[] | null>(null);
  const snapshot = useRef<Map<string, DOMRect> | null>(null);
  const frame = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const latest = useRef({ items, onCommit });
  latest.current = { items, onCommit };

  // The order on screen: the preview while dragging (keys that left dropped, new ones last), else the board's.
  const order = preview ? [...preview.filter((key) => keys.includes(key)), ...keys.filter((key) => !preview.includes(key))] : keys;

  /** Where every widget is now, so the next layout can slide from it. */
  const capture = useCallback((override?: { readonly key: string; readonly rect: DOMRect }) => {
    const grid = gridRef.current;
    if (!grid) return;
    const rects = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-board-key]").forEach((element) => {
      const key = element.dataset.boardKey;
      if (key) rects.set(key, element.getBoundingClientRect());
    });
    if (override) rects.set(override.key, override.rect);
    snapshot.current = rects;
  }, [gridRef]);

  const layoutKey = order.join(",") + "|" + items.map((item) => item.key + ":" + item.size).join(",");
  useLayoutEffect(() => {
    const first = snapshot.current;
    snapshot.current = null;
    const grid = gridRef.current;
    if (!first || !grid || reducedMotion()) return;
    const moving: { readonly element: HTMLElement; readonly width: number | null; readonly height: number | null }[] = [];
    grid.querySelectorAll<HTMLElement>("[data-board-key]").forEach((element) => {
      const before = first.get(element.dataset.boardKey ?? "");
      if (!before) return;
      element.style.transition = "none";
      element.style.transform = "";
      element.style.width = "";
      element.style.height = "";
      const after = element.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      const resized = Math.abs(before.width - after.width) >= 1 || Math.abs(before.height - after.height) >= 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !resized) {
        element.style.transition = "";
        return;
      }
      element.style.transform = "translate(" + String(dx) + "px, " + String(dy) + "px)";
      // A resized widget starts at its old size, so it grows or shrinks instead of jumping to the new one.
      if (resized) {
        element.style.width = String(before.width) + "px";
        element.style.height = String(before.height) + "px";
      }
      moving.push({ element, width: resized ? after.width : null, height: resized ? after.height : null });
    });
    if (moving.length === 0) return;
    void grid.offsetHeight;
    for (const { element, width, height } of moving) {
      element.style.transition = SLIDE;
      element.style.transform = "";
      if (width !== null && height !== null) {
        element.style.width = String(width) + "px";
        element.style.height = String(height) + "px";
      }
      const done = (event: TransitionEvent) => {
        if (event.target !== element) return;
        // A resized widget finishes on its size; one that only moved, on its slide.
        if (width !== null ? event.propertyName === "transform" : event.propertyName !== "transform") return;
        element.style.transition = "";
        element.style.width = "";
        element.style.height = "";
        element.removeEventListener("transitionend", done);
      };
      element.addEventListener("transitionend", done);
    }
  }, [layoutKey, flipTick, gridRef]);

  /** Puts the lifted card under the pointer. */
  const place = useCallback(() => {
    const current = gesture.current;
    const lifted = liftedRef.current;
    if (current && lifted) lifted.style.transform = liftedTransform(current.clientX - current.offsetX, current.clientY - current.offsetY);
  }, []);

  /** Moves the card to the place that puts its slot under the pointer, once the board has settled from the last change. */
  const judge = useCallback(() => {
    const current = gesture.current;
    if (!current?.started) return;
    const now = window.performance.now();
    if (now < current.quietUntil) return;
    const grid = gridRef.current;
    if (!grid) return;
    const order = previewRef.current ?? latest.current.items.map((item) => item.key);
    const sizes = new Map(latest.current.items.map((item) => [item.key, item.size] as const));
    const origin = grid.getBoundingClientRect();
    const next = bestDropOrder(order, current.key, sizes, gridMetrics(grid), current.clientX - origin.left, current.clientY - origin.top);
    if (!next) return;
    current.quietUntil = now + SLIDE_MS;
    capture();
    previewRef.current = next;
    setPreview(next);
  }, [capture, gridRef]);

  /** Every frame of a drag: the card under the pointer, the scroller at its edge, and the board making way. */
  const tick = useCallback(() => {
    frame.current = null;
    const current = gesture.current;
    if (!current?.started) return;
    place();
    const scroller = current.scroller;
    if (scroller) {
      const bounds = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const above = bounds.top + EDGE - current.clientY;
      const below = current.clientY - (bounds.bottom - EDGE);
      const reach = Math.max(above, below);
      // A drag that starts near an edge does not scroll until the pointer has been away from it.
      if (reach <= 0) current.armed = true;
      else if (current.armed) scroller.scrollTop += (below > above ? 1 : -1) * Math.ceil(EDGE_MAX_SPEED * Math.min(1, reach / EDGE) ** 2);
    }
    judge();
    frame.current = window.requestAnimationFrame(tick);
  }, [judge, place]);

  const finish = useCallback((commit: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
    document.documentElement.classList.remove("is-board-dragging");
    try {
      if (current?.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    } catch {
      // The handle may already have gone away.
    }
    if (!current?.started) return;
    const final = commit ? previewRef.current : null;
    // The card lands from where the pointer left it.
    capture({ key: current.key, rect: new DOMRect(current.clientX - current.offsetX, current.clientY - current.offsetY, current.width, current.height) });
    previewRef.current = null;
    setPreview(null);
    setDrag(null);
    setSettling(current.key);
    setFlipTick((value) => value + 1);
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setSettling(null), SETTLE_MS);
    const original = latest.current.items.map((item) => item.key);
    if (final && final.join(",") !== original.join(",")) latest.current.onCommit(final);
  }, [capture]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.clientX = event.clientX;
      current.clientY = event.clientY;
      if (!current.started) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < THRESHOLD) return;
        current.started = true;
        try {
          current.target.setPointerCapture?.(current.pointerId);
        } catch {
          // Window listeners still follow the pointer.
        }
        document.documentElement.classList.add("is-board-dragging");
        previewRef.current = latest.current.items.map((item) => item.key);
        setPreview(previewRef.current);
        setDrag({ key: current.key, left: current.clientX - current.offsetX, top: current.clientY - current.offsetY, width: current.width, height: current.height });
        if (frame.current === null) frame.current = window.requestAnimationFrame(tick);
      }
      event.preventDefault();
    };
    const up = (event: PointerEvent) => { if (gesture.current && event.pointerId === gesture.current.pointerId) finish(true); };
    const cancel = (event: PointerEvent) => { if (gesture.current && event.pointerId === gesture.current.pointerId) finish(false); };
    const blur = () => { if (gesture.current) finish(false); };
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
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      document.documentElement.classList.remove("is-board-dragging");
      gesture.current = null;
    };
  }, [finish, tick]);

  /** A press on a card's handle; it becomes a drag once the pointer moves a few pixels. */
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, key: string) => {
    const grid = gridRef.current;
    if (event.button !== 0 || gesture.current || !grid) return;
    const cell = Array.from(grid.querySelectorAll<HTMLElement>("[data-board-key]")).find((element) => element.dataset.boardKey === key);
    if (!cell) return;
    // No text selection while dragging by the title.
    event.preventDefault();
    const rect = cell.getBoundingClientRect();
    gesture.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      key,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      scroller: scrollParent(grid),
      started: false,
      clientX: event.clientX,
      clientY: event.clientY,
      quietUntil: 0,
      armed: false,
    };
  };

  return {
    /** The widgets' keys in the order on screen. */
    order,
    drag,
    /** For the lifted card, which the drag moves directly. */
    liftedRef,
    settling,
    beginDrag,
    /** Call before any other change of place, so the widgets slide to where they land. */
    animate: () => capture(),
  };
}
