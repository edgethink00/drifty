// @vitest-environment jsdom
import type { PointerEvent as ReactPointerEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBoardResize, type BoardResizeEdge } from "./useBoardResize";

// A four-column board 976px wide with 16px gaps: a column is 232px, a half-width widget 480px.
function board() {
  const grid = document.createElement("div");
  grid.style.columnGap = "16px";
  grid.style.gridAutoRows = "112px";
  Object.defineProperty(grid, "clientWidth", { value: 976 });
  const cell = document.createElement("div");
  cell.dataset.boardKey = "list";
  Object.defineProperty(cell, "offsetWidth", { value: 480 });
  Object.defineProperty(cell, "offsetHeight", { value: 240 });
  const handle = document.createElement("span");
  cell.append(handle);
  grid.append(cell);
  document.body.append(grid);
  return { grid, handle };
}

function pointer(type: string, clientX: number) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, clientX, clientY: 400 });
  window.dispatchEvent(event);
}

function drag(edge: BoardResizeEdge, toX: number) {
  const { grid, handle } = board();
  const onCommit = vi.fn();
  // Half width is two columns, full width four; past three columns it lands on full.
  const snap = (_key: string, columns: number) => (columns >= 3 ? "4x2" : "2x2");
  const { result } = renderHook(() => useBoardResize({ gridRef: { current: grid }, columns: 4, snap, beforeChange: () => undefined, onCommit }));
  const press = { button: 0, pointerId: 1, clientX: 600, clientY: 400, currentTarget: handle, preventDefault: () => undefined, stopPropagation: () => undefined } as unknown as ReactPointerEvent<HTMLElement>;
  act(() => result.current.beginResize(press, "list", "width", "2x2", edge));
  act(() => pointer("pointermove", toX));
  act(() => pointer("pointerup", toX));
  return onCommit;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("useBoardResize", () => {
  it("widens a right-column widget as its left edge is dragged left (owner decision 2026-10-22)", () => {
    expect(drag("start", 300)).toHaveBeenCalledWith("list", "4x2", "start");
    // Dragged right, the left edge narrows it, and half width is already the least.
    expect(drag("start", 900)).not.toHaveBeenCalled();
  });

  it("widens a left-column widget as its right edge is dragged right, and not left", () => {
    expect(drag("end", 900)).toHaveBeenCalledWith("list", "4x2", "end");
    expect(drag("end", 300)).not.toHaveBeenCalled();
  });

  it("changes size only well past the halfway line, so a resting hand never flips it", () => {
    // 248px past the start is exactly halfway to full width (three columns): it stays half.
    expect(drag("end", 848)).not.toHaveBeenCalled();
    // A fifth of a column further, it goes full.
    expect(drag("end", 900)).toHaveBeenCalledWith("list", "4x2", "end");
  });
});

