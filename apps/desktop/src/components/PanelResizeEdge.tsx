import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import "./panel-resize-edge.css";

/** Pointer travel under this many pixels ends as a click, not a drag. */
const CLICK_SLOP_PX = 4;
/** Arrow keys move a free edge by this much; with Shift, three times as far. */
const KEY_STEP_REM = 1;

/**
 * Two states only: the panel is open or folded to its rail. Dragging the edge
 * past `snapRem` from the panel's left side flips it there and then, so the
 * panel snaps under the pointer the way a macOS split view does.
 */
export type PanelEdgeToggle = {
  readonly kind: "toggle";
  readonly snapRem: number;
};

/**
 * A free width between `minRem` and `maxRem`. Under half the minimum the
 * panel collapses; dragging back out opens it under the pointer again.
 * `reserveRem` is the room the panel leaves its neighbour in the same row.
 */
export type PanelEdgeResize = {
  readonly kind: "resize";
  readonly minRem: number;
  readonly maxRem: number;
  readonly reserveRem: number;
  /** The saved width, or null while the panel keeps its responsive default. */
  readonly valueRem: number | null;
  /** Paint a width while the pointer is down, without a React render; null restores the default. */
  readonly onPreview: (rem: number | null) => void;
  /** Keep a width (null returns to the default). */
  readonly onCommit: (rem: number | null) => void;
};

type PanelResizeEdgeProps = {
  /** The id of the panel this edge sizes. */
  readonly controls: string;
  readonly label: string;
  /** Shown on hover: what a click or drag will do. */
  readonly hint?: string;
  readonly className?: string;
  readonly collapsed: boolean;
  readonly panel: () => HTMLElement | null;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly mode: PanelEdgeToggle | PanelEdgeResize;
};

type Drag = {
  readonly pointerId: number;
  readonly startX: number;
  readonly origin: number;
  readonly pxPerRem: number;
  readonly maxRem: number;
  readonly startRem: number | null;
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

function setResizing(cursor: string | null) {
  const root = document.documentElement;
  if (cursor) root.dataset.panelResizing = cursor;
  else delete root.dataset.panelResizing;
}

/**
 * The draggable edge on a panel's right side, following the WAI-ARIA window
 * splitter: a focusable separator that a pointer drags or clicks and the
 * keyboard moves with the arrows, Home, End and Enter.
 */
export function PanelResizeEdge({ controls, label, hint, className, collapsed, panel, onCollapsedChange, mode }: PanelResizeEdgeProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const [share, setShare] = useState<number | null>(null);
  const resizable = mode.kind === "resize";

  // A free edge reports where it sits as a share of its row, as a splitter does.
  useLayoutEffect(() => {
    if (!resizable) return undefined;
    const element = panel();
    if (!element) return undefined;
    const measure = () => {
      const row = element.parentElement?.getBoundingClientRect().width ?? 0;
      const width = element.getBoundingClientRect().width;
      setShare(row > 0 ? Math.round((width / row) * 100) : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [resizable, panel]);

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
      if (!released) return;
      // A click opens a folded panel; a two-state edge also folds an open one.
      if (collapsed) onCollapsedChange(false);
      else if (!resizable) onCollapsedChange(true);
      return;
    }
    if (mode.kind === "resize" && !current.collapsed && current.widthRem !== null) mode.onCommit(current.widthRem);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = panel();
    if (!element) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pxPerRem = screenPxPerRem(element.parentElement ?? element);
    const box = element.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      origin: box.left,
      pxPerRem,
      maxRem: mode.kind === "resize" ? resizeLimit(mode, element, pxPerRem) : 0,
      startRem: mode.kind === "resize" ? mode.valueRem : null,
      moved: false,
      collapsed,
      widthRem: null,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
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
        onCollapsedChange(fold);
      }
      return;
    }
    const fold = reach < mode.minRem / 2;
    if (fold !== current.collapsed) {
      current.collapsed = fold;
      onCollapsedChange(fold);
    }
    if (fold) {
      // Folded away mid-drag: it reopens at the width it had before this drag.
      if (current.widthRem !== null) mode.onPreview(current.startRem);
      current.widthRem = null;
      return;
    }
    const width = clamp(reach, mode.minRem, current.maxRem);
    if (width !== current.widthRem) {
      current.widthRem = width;
      mode.onPreview(width);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = panel();
    if (!element) return;
    const { key } = event;
    if (key === "Enter") {
      event.preventDefault();
      onCollapsedChange(!collapsed);
      return;
    }
    if (mode.kind === "toggle") {
      const fold = key === "ArrowLeft" || key === "Home" ? true : key === "ArrowRight" || key === "End" ? false : null;
      if (fold === null) return;
      event.preventDefault();
      if (fold !== collapsed) onCollapsedChange(fold);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const pxPerRem = screenPxPerRem(element.parentElement ?? element);
    const max = resizeLimit(mode, element, pxPerRem);
    if (collapsed) {
      if (key === "ArrowLeft" || key === "Home") return;
      onCollapsedChange(false);
      if (key === "End") mode.onCommit(max);
      return;
    }
    const width = element.getBoundingClientRect().width / pxPerRem;
    if (key === "Home") { mode.onCommit(mode.minRem); return; }
    if (key === "End") { mode.onCommit(max); return; }
    const step = (event.shiftKey ? 3 : 1) * KEY_STEP_REM * (key === "ArrowLeft" ? -1 : 1);
    // Past the minimum the panel folds, as dragging past it does.
    if (step < 0 && width <= mode.minRem + 0.01) { onCollapsedChange(true); return; }
    mode.onCommit(clamp(width + step, mode.minRem, max));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-controls={controls}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={collapsed ? 0 : resizable ? share ?? 50 : 100}
      tabIndex={0}
      title={dragging ? undefined : hint}
      className={["panel-resize-edge", className].filter(Boolean).join(" ")}
      data-mode={mode.kind}
      data-collapsed={collapsed ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => { if (event.pointerId === drag.current?.pointerId) finish(true); }}
      onPointerCancel={(event) => { if (event.pointerId === drag.current?.pointerId) finish(false); }}
      onLostPointerCapture={(event) => { if (event.pointerId === drag.current?.pointerId) finish(false); }}
      onDoubleClick={mode.kind === "resize" && !collapsed ? () => mode.onCommit(null) : undefined}
      onKeyDown={onKeyDown}
    />
  );
}
