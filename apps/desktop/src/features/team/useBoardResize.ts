import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/**
 * Drag a board widget's edge to size it (owner decision 2026-10-21): the
 * bottom edge changes its height a row at a time, as Rize's widgets do, and
 * on a widget that reads well both half and full width the side edge (or the
 * corner) moves it between those two. That edge is the one with room to grow
 * (owner decision 2026-10-22): the right one, except for a half-width widget
 * in the right column, whose left edge widens it. The widget takes each size
 * it reaches at once, so the board shows where everything will be while the
 * pointer is still down; the other widgets slide out of the way. Escape puts
 * it back.
 */
export type BoardResizeAxis = "height" | "width" | "both";
/** Which side edge a width or corner handle sits on. */
export type BoardResizeEdge = "start" | "end";

export type BoardResizeState = { readonly key: string; readonly size: string; readonly axis: BoardResizeAxis; readonly edge: BoardResizeEdge; readonly startSize: string };

const RESIZING_CLASSES = ["is-board-resizing", "is-board-resizing--height", "is-board-resizing--width", "is-board-resizing--both", "is-board-resizing--both-start"];
/**
 * How far past the halfway line, in columns or rows, the pointer must go before
 * the widget takes the next size (2026-10-22): without it a hand resting on the
 * line flipped the widget between two sizes many times a second.
 */
export const BOARD_RESIZE_HYSTERESIS = 0.2;

/** A fraction of columns or rows held toward the size the widget has, so it changes only well past the halfway line. */
export function heldToward(fraction: number, current: number, margin = BOARD_RESIZE_HYSTERESIS): number {
  return fraction > current ? Math.max(current, fraction - margin) : Math.min(current, fraction + margin);
}

/** A board size id's columns and rows ("4x2"). */
function spanOf(size: string): { readonly w: number; readonly h: number } {
  const [w, h] = size.split("x").map(Number);
  return { w: w ?? 0, h: h ?? 0 };
}

type Gesture = {
  readonly pointerId: number;
  readonly target: HTMLElement;
  readonly key: string;
  readonly axis: BoardResizeAxis;
  readonly edge: BoardResizeEdge;
  readonly startX: number;
  readonly startY: number;
  /** The widget's box when the press began, in pixels. */
  readonly startWidth: number;
  readonly startHeight: number;
  readonly startSize: string;
  readonly column: number;
  readonly row: number;
  readonly gap: number;
  size: string;
};

export function useBoardResize({ gridRef, columns, snap, beforeChange, onCommit }: {
  readonly gridRef: RefObject<HTMLElement | null>;
  readonly columns: number;
  /** The size a widget lands on for a width and height in columns and rows (fractions while between them). */
  readonly snap: (key: string, columns: number, rows: number, axis: BoardResizeAxis) => string | null;
  /** Called before the board changes, so the widgets can slide from where they were. */
  readonly beforeChange: () => void;
  readonly onCommit: (key: string, size: string, edge: BoardResizeEdge) => void;
}) {
  const [resizing, setResizing] = useState<BoardResizeState | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ snap, beforeChange, onCommit });
  latest.current = { snap, beforeChange, onCommit };

  const finish = useCallback((commit: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    document.documentElement.classList.remove(...RESIZING_CLASSES);
    if (!current) return;
    try {
      if (current.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    } catch {
      // The handle may already be gone.
    }
    // Committed, the board already shows the new size; given up, it slides back.
    if (!commit && current.size !== current.startSize) latest.current.beforeChange();
    setResizing(null);
    if (commit && current.size !== current.startSize) latest.current.onCommit(current.key, current.size, current.edge);
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      // A left-edge handle grows the widget as the pointer moves left.
      const dx = (event.clientX - current.startX) * (current.edge === "start" ? -1 : 1);
      const width = current.axis === "height" ? current.startWidth : current.startWidth + dx;
      const height = current.axis === "width" ? current.startHeight : current.startHeight + event.clientY - current.startY;
      const now = spanOf(current.size);
      const columns = heldToward((width + current.gap) / (current.column + current.gap), now.w);
      const rows = heldToward((height + current.gap) / (current.row + current.gap), now.h);
      const next = latest.current.snap(current.key, columns, rows, current.axis);
      if (!next || next === current.size) return;
      latest.current.beforeChange();
      current.size = next;
      setResizing({ key: current.key, size: next, axis: current.axis, edge: current.edge, startSize: current.startSize });
    };
    const up = (event: PointerEvent) => { if (gesture.current && event.pointerId === gesture.current.pointerId) finish(true); };
    const cancel = (event: PointerEvent) => { if (gesture.current && event.pointerId === gesture.current.pointerId) finish(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !gesture.current) return;
      event.preventDefault();
      event.stopPropagation();
      // Back to the size the press began with.
      if (gesture.current.size !== gesture.current.startSize) {
        latest.current.beforeChange();
        gesture.current.size = gesture.current.startSize;
      }
      finish(false);
    };
    const blur = () => { if (gesture.current) finish(false); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
      document.documentElement.classList.remove(...RESIZING_CLASSES);
      gesture.current = null;
    };
  }, [finish]);

  /** A press on a widget's edge handle; edge says which side a width or corner handle is on. */
  const beginResize = (event: ReactPointerEvent<HTMLElement>, key: string, axis: BoardResizeAxis, size: string, edge: BoardResizeEdge = "end") => {
    const grid = gridRef.current;
    if (event.button !== 0 || gesture.current || !grid) return;
    const cell = Array.from(grid.querySelectorAll<HTMLElement>("[data-board-key]")).find((element) => element.dataset.boardKey === key);
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    const style = window.getComputedStyle(grid);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const row = Number.parseFloat(style.gridAutoRows) || 1;
    const column = (grid.clientWidth - gap * (columns - 1)) / columns;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window listeners still follow the pointer.
    }
    document.documentElement.classList.add("is-board-resizing", "is-board-resizing--" + axis + (axis === "both" && edge === "start" ? "-start" : ""));
    gesture.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      key,
      axis,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: cell.offsetWidth,
      startHeight: cell.offsetHeight,
      startSize: size,
      column,
      row,
      gap,
      size,
    };
    setResizing({ key, size, axis, edge, startSize: size });
  };

  return { resizing, beginResize };
}

