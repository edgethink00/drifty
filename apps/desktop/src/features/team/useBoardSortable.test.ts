import { describe, expect, it } from "vitest";

import { bestDropOrder, type BoardGridMetrics } from "./useBoardSortable";

// Four 232px columns and 112px rows with 16px gaps: a column step is 248px, a row step 128px.
const GRID: BoardGridMetrics = { columns: 4, column: 232, row: 112, gapX: 16, gapY: 16 };
const SIZES = new Map([["numbers", "4x1"], ["table", "4x3"], ["donut", "2x2"], ["list", "2x2"], ["bars", "4x2"]]);
// numbers in row 1, the table in rows 2–4, the donut and the list side by side in rows 5–6, the bars in rows 7–8.
const ORDER = ["numbers", "table", "donut", "list", "bars"];
const row = (r: number) => (r - 1) * 128;

describe("bestDropOrder", () => {
  it("keeps the order while the dragged widget's slot is under the pointer", () => {
    expect(bestDropOrder(ORDER, "list", SIZES, GRID, 700, row(5) + 60)).toBeNull();
  });

  it("moves a half-width widget beside the other one into the left place, and back", () => {
    const left = bestDropOrder(ORDER, "list", SIZES, GRID, 200, row(5) + 60);
    expect(left).toEqual(["numbers", "table", "list", "donut", "bars"]);
    expect(bestDropOrder(left!, "list", SIZES, GRID, 700, row(5) + 60)).toEqual(ORDER);
  });

  it("takes a half-width widget up a row over the right of a full-width one and keeps it there (2026-10-22)", () => {
    // Before: inserting it ahead of the table let the donut slide under the pointer and the two swapped every slide.
    const up = bestDropOrder(ORDER, "list", SIZES, GRID, 780, row(2) + 74);
    expect(up).toEqual(["numbers", "list", "table", "donut", "bars"]);
    expect(bestDropOrder(up!, "list", SIZES, GRID, 780, row(2) + 74)).toBeNull();
  });

  it("brings a full-width widget above a row of half-width ones it is dropped on (2026-10-22)", () => {
    // Before: it went ahead of the list in the order but the half-width pair stayed together above it.
    expect(bestDropOrder(ORDER, "bars", SIZES, GRID, 700, row(6) + 60)).toEqual(["numbers", "table", "bars", "donut", "list"]);
  });

  it("waits until the slot would be clearly nearer than it is", () => {
    // Just past the list's bottom edge, in the gap above the bars: no change.
    expect(bestDropOrder(ORDER, "list", SIZES, GRID, 700, row(7) + 4)).toBeNull();
  });

  it("takes a half-width widget below a full-width one, leaving its neighbour's place beside it open", () => {
    // Dropped on the lower half of the bars, the donut goes after them; the list stays in row 5 on its own.
    expect(bestDropOrder(ORDER, "donut", SIZES, GRID, 300, row(8) + 80)).toEqual(["numbers", "table", "list", "bars", "donut"]);
  });
});

