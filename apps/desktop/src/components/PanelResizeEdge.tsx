import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import "./panel-resize-edge.css";

/** Pointer travel under this many pixels ends as a click, not a drag. */
const CLICK_SLOP_PX = 4;
/** Arrow keys move a free edge by this much; with Shift, three times as far. */
const KEY_STEP_REM = 1;
/** Widths this close to a limit count as at it. */
const LIMIT_EPSILON_REM = 0.01;
/** A second click this soon after a toggle is the rest of a double-click, not another toggle. */
const DOUBLE_CLICK_MS = 400;

/**
 * Two states only: the panel is open or folded to its rail. Dragging the edge
 * past `snapRem` from the panel's left side flips it there and then, so the
 * panel snaps under the pointer the way a macOS split view does; a click
 * flips it as well.
 */
export type PanelEdgeToggle = {
  readonly kind: "toggle";
  readonly snapRem: number;
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * A free width between `minRem` and `maxRem`; the panel never folds, it
 * stops at the minimum. `reserveRem` is the room it leaves its neighbour in
 * the same row.
 */
export type PanelEdgeResize = {
  readonly kind: "resize";
  readonly minRem: number;
  readonly maxRem: number;
  readonly reserveRem: number;
  /** Paint a width while the pointer is down, without a React render. */
  readonly onPreview: (rem: number) => void;
  /** Keep a width (null returns to the default). */
  readonly onCommit: (rem: number | null) => void;
};

type PanelResizeEdgeProps = {
  /** The id of the panel this edge sizes. */
  readonly controls: string;
  readonly label: string;
  readonly className?: string;
  readonly panel: () => HTMLElement | null;
  readonly mode: PanelEdgeToggle | PanelEdgeResize;
};

type Limit = "min" | "max" | null;

type Drag = {
  readonly pointerId: number;
  readonly startX: number;
  readonly origin: number;
  readonly pxPerRem: number;
  readonly maxRem: number;
  moved: boolean;
  collapsed: boolean;
  widthRem: number | null;
};

/**
 * Screen pixels per rem at the panel. The type scale grows the root font with
 * the window, and the browser review preview zooms the whole page, so a width
 * measured on screen is turned into rem through both.
 */
function screenPxPerRem(reference: HTMLElement): number {
  const rootPx = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  const box = reference.getBoundingClientRect();
  const scale = reference.offsetWidth > 0 && box.width > 0 ? box.width / reference.offsetWidth : 1;
  return rootPx * scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function resizeLimit(mode: PanelEdgeResize, panel: HTMLElement, pxPerRem: number): number {
  const row = panel.parentElement?.getBoundingClientRect().width ?? 0;
  if (row <= 0) return mode.maxRem;
  return clamp(row / pxPerRem - mode.reserveRem, mode.minRem, mode.maxRem);
}

function limitOf(widthRem: number, minRem: number, maxRem: number): Limit {
  if (widthRem <= minRem + LIMIT_EPSILON_REM) return "min";
  if (widthRem >= maxRem - LIMIT_EPSILON_REM) return "max";
  return null;
}

/** At a limit the cursor points the one way the edge can still go. */
function resizeCursor(limit: Limit): string {
  return limit === "min" ? "e-resize" : limit === "max" ? "w-resize" : "col-resize";
}

function setResizing(cursor: string | null) {
  const root = document.documentElement;
  if (cursor) root.dataset.panelResizing = cursor;
  else delete root.dataset.panelResizing;
}

/** The knob shows where the pointer is along the edge; the CSS keeps it clear of the ends. */
function placeGrip(event: PointerEvent<HTMLDivElement>) {
  const y = event.nativeEvent.offsetY;
  if (Number.isFinite(y)) event.currentTarget.style.setProperty("--panel-edge-grip-y", Math.round(y) + "px");
}

/**
 * The draggable edge on a panel's right side, following the WAI-ARIA window
 * splitter: a focusable separator that a pointer drags and the keyboard moves
 * with the arrows, Home and End (and, on a two-state edge, Enter).
 */
export function PanelResizeEdge({ controls, label, className, panel, mode }: PanelResizeEdgeProps) {
  const drag = useRef<Drag | null>(null);
  const lastToggle = useRef(Number.NEGATIVE_INFINITY);
  const [dragging, setDragging] = useState(false);
  const [measured, setMeasured] = useState<{ readonly share: number; readonly limit: Limit } | null>(null);
  const resizable = mode.kind === "resize";
  const minRem = mode.kind === "resize" ? mode.minRem : 0;
  const maxRem = mode.kind === "resize" ? mode.maxRem : 0;
  const reserveRem = mode.kind === "resize" ? mode.reserveRem : 0;

  // A free edge reports where it sits as a share of its row, as a splitter
  // does, and whether it rests at a limit.
  useLayoutEffect(() => {
    if (!resizable) return undefined;
    const element = panel();
    if (!element) return undefined;
    const measure = () => {
      const row = element.parentElement?.getBoundingClientRect().width ?? 0;
      const width = element.getBoundingClientRect().width;
      const pxPerRem = screenPxPerRem(element.parentElement ?? element);
      const max = row > 0 ? clamp(row / pxPerRem - reserveRem, minRem, maxRem) : maxRem;
      setMeasured({ share: row > 0 ? Math.round((width / row) * 100) : 50, limit: width > 0 ? limitOf(width / pxPerRem, minRem, max) : null });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [resizable, panel, minRem, maxRem, reserveRem]);

  useEffect(() => () => {
    if (drag.current) setResizing(null);
  }, []);

  // A release ends a click or a drag; a cancelled pointer keeps what it dragged but is never a click.
  const finish = (released: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(false);
    setResizing(null);
    if (!current.moved) {
      // Only a two-state edge does something on a click, and a double-click
      // flips it once instead of folding and opening it again.
      if (!released || mode.kind !== "toggle") return;
      const now = performance.now();
      if (now - lastToggle.current < DOUBLE_CLICK_MS) return;
      lastToggle.current = now;
      mode.onCollapsedChange(!mode.collapsed);
      return;
    }
    if (mode.kind === "resize" && current.widthRem !== null) mode.onCommit(current.widthRem);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = panel();
    if (!element) return;
    event.preventDefault();
    placeGrip(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pxPerRem = screenPxPerRem(element.parentElement ?? element);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      origin: element.getBoundingClientRect().left,
      pxPerRem,
      maxRem: mode.kind === "resize" ? resizeLimit(mode, element, pxPerRem) : 0,
      moved: false,
      collapsed: mode.kind === "toggle" && mode.collapsed,
      widthRem: null,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    placeGrip(event);
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!current.moved) {
      if (Math.abs(event.clientX - current.startX) < CLICK_SLOP_PX) return;
      current.moved = true;
      setDragging(true);
      setResizing(mode.kind === "resize" ? "col-resize" : "ew-resize");
    }
    const reach = (event.clientX - current.origin) / current.pxPerRem;
    if (mode.kind === "toggle") {
      const fold = reach < mode.snapRem;
      if (fold !== current.collapsed) {
        current.collapsed = fold;
        mode.onCollapsedChange(fold);
      }
      return;
    }
    const width = clamp(reach, mode.minRem, current.maxRem);
    setResizing(resizeCursor(limitOf(width, mode.minRem, current.maxRem)));
    if (width !== current.widthRem) {
      current.widthRem = width;
      mode.onPreview(width);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = panel();
    if (!element) return;
    const { key } = event;
    if (mode.kind === "toggle") {
      const fold = key === "Enter" ? !mode.collapsed
        : key === "ArrowLeft" || key === "Home" ? true : key === "ArrowRight" || key === "End" ? false : null;
      if (fold === null) return;
      event.preventDefault();
      if (fold !== mode.collapsed) mode.onCollapsedChange(fold);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const pxPerRem = screenPxPerRem(element.parentElement ?? element);
    const max = resizeLimit(mode, element, pxPerRem);
    if (key === "Home") { mode.onCommit(mode.minRem); return; }
    if (key === "End") { mode.onCommit(max); return; }
    const width = element.getBoundingClientRect().width / pxPerRem;
    const step = (event.shiftKey ? 3 : 1) * KEY_STEP_REM * (key === "ArrowLeft" ? -1 : 1);
    mode.onCommit(clamp(width + step, mode.minRem, max));
  };

  const collapsed = mode.kind === "toggle" && mode.collapsed;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-controls={controls}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={mode.kind === "toggle" ? (collapsed ? 0 : 100) : measured?.share ?? 50}
      tabIndex={0}
      className={["panel-resize-edge", className].filter(Boolean).join(" ")}
      data-mode={mode.kind}
      data-collapsed={collapsed ? "true" : undefined}
      data-limit={resizable ? measured?.limit ?? undefined : undefined}
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => { if (event.pointerId === drag.current?.pointerId) finish(true); }}
      onPointerCancel={(event) => { if (event.pointerId === drag.current?.pointerId) finish(false); }}
      onLostPointerCapture={(event) => { if (event.pointerId === drag.current?.pointerId) finish(false); }}
      onDoubleClick={mode.kind === "resize" ? () => mode.onCommit(null) : undefined}
      onKeyDown={onKeyDown}
    />
  );
}
