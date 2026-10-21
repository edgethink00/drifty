import { describe, expect, it } from "vitest";
import { buildFlowTimeRows, flowRowUnitMinutes, sliceFlowCell } from "./flowChartRows";
import { buildFlowHoverOverlaySegments } from "./flowHoverOverlay";

describe("display rows over the original four-minute cells", () => {
  it.each([10, 20, 30, 60] as const)("covers the complete day once with %i-minute rows", (rowMinutes) => {
    const rows = buildFlowTimeRows(rowMinutes, 4);
    expect(rows).toHaveLength(1440 / rowMinutes);
    const paintedBySource = new Map<number, number>();
    for (const row of rows) {
      expect(row.slices.reduce((total, slice) => total + slice.endMinute - slice.startMinute, 0)).toBe(rowMinutes);
      expect(row.slices.reduce((total, slice) => total + slice.columnSpan, 0)).toBe(rowMinutes / flowRowUnitMinutes(rowMinutes, 4));
      for (const slice of row.slices) {
        expect(slice.sourceMinute % 4).toBe(0);
        expect(slice.startMinute).toBeGreaterThanOrEqual(row.startMinute);
        expect(slice.endMinute).toBeLessThanOrEqual(row.startMinute + rowMinutes);
        paintedBySource.set(slice.sourceMinute, (paintedBySource.get(slice.sourceMinute) ?? 0) + slice.endMinute - slice.startMinute);
      }
    }
    expect(paintedBySource.size).toBe(360);
    expect([...paintedBySource.values()].every(minutes => minutes === 4)).toBe(true);
    const lastRow = rows[rows.length - 1];
    expect(lastRow.slices[lastRow.slices.length - 1].endMinute).toBe(1440);
  });

  it("keeps both halves of :28–:32 attached to the same four-minute source", () => {
    expect(sliceFlowCell(28, 4, 30)).toEqual([
      { sourceMinute: 28, startMinute: 28, endMinute: 30, rowIndex: 0, columnOffset: 14, columnSpan: 1 },
      { sourceMinute: 28, startMinute: 30, endMinute: 32, rowIndex: 1, columnOffset: 0, columnSpan: 1 },
    ]);
    expect(buildFlowHoverOverlaySegments({ blocks: [{ minuteOfDay: 268 }] }, 4, 240, 30)).toEqual([
      { hourIndex: 0, rowIndex: 14, rowSpan: 1 },
      { hourIndex: 1, rowIndex: 0, rowSpan: 1 },
    ]);
  });

  it("joins a hover run across midnight while preserving its split rows", () => {
    const group = { blocks: [1436, 0, 4].map(minuteOfDay => ({ minuteOfDay })) };
    expect(buildFlowHoverOverlaySegments(group, 4, 240, 10)).toEqual([
      { hourIndex: 119, rowIndex: 3, rowSpan: 2 },
      { hourIndex: 120, rowIndex: 0, rowSpan: 4 },
    ]);
  });
});
