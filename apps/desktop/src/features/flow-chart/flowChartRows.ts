import type { FlowIntervalMinutes } from "@drifty/domain";

/** Display rows only; aggregation and activity groups keep their own intervals. */
export type FlowChartRowMinutes = 10 | 20 | 30 | 60;

export function flowRowUnitMinutes(rowMinutes: FlowChartRowMinutes, intervalMinutes: FlowIntervalMinutes): number {
  let a: number = rowMinutes;
  let b: number = intervalMinutes;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export type FlowCellSlice = {
  readonly sourceMinute: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly rowIndex: number;
  readonly columnOffset: number;
  readonly columnSpan: number;
};

/** A boundary cuts the painted cell, never its source record or hover identity. */
export function sliceFlowCell(sourceMinute: number, intervalMinutes: FlowIntervalMinutes, rowMinutes: FlowChartRowMinutes): FlowCellSlice[] {
  const unit = flowRowUnitMinutes(rowMinutes, intervalMinutes);
  const end = Math.min(sourceMinute + intervalMinutes, 1440);
  const slices: FlowCellSlice[] = [];
  for (let start = sourceMinute; start < end;) {
    const rowIndex = Math.floor(start / rowMinutes);
    const sliceEnd = Math.min(end, (rowIndex + 1) * rowMinutes);
    slices.push({ sourceMinute, startMinute: start, endMinute: sliceEnd, rowIndex, columnOffset: (start - rowIndex * rowMinutes) / unit, columnSpan: (sliceEnd - start) / unit });
    start = sliceEnd;
  }
  return slices;
}

export function buildFlowTimeRows(rowMinutes: FlowChartRowMinutes, intervalMinutes: FlowIntervalMinutes) {
  const rows = Array.from({ length: 1440 / rowMinutes }, (_, rowIndex) => ({ startMinute: rowIndex * rowMinutes, slices: [] as FlowCellSlice[] }));
  for (let source = 0; source < 1440; source += intervalMinutes) {
    for (const slice of sliceFlowCell(source, intervalMinutes, rowMinutes)) rows[slice.rowIndex].slices.push(slice);
  }
  return rows;
}
