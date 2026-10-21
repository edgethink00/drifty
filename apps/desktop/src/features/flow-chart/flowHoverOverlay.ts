import { logicalMinuteOfDay, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import { sliceFlowCell, type FlowChartRowMinutes } from "./flowChartRows";

/** Any run of cells to outline: a Mac activity group or one iPhone block. */
export type FlowHighlightedCells = {
  readonly blocks: readonly Pick<FlowBlock, "minuteOfDay">[];
};

export type FlowHoverOverlaySegment = {
  readonly hourIndex: number;
  readonly rowIndex: number;
  readonly rowSpan: number;
};

export function buildFlowHoverOverlaySegments(group: FlowHighlightedCells, intervalMinutes: FlowIntervalMinutes, startOfDayMinutes: number, rowMinutes: FlowChartRowMinutes = 60): readonly FlowHoverOverlaySegment[] {
  const cells = group.blocks
    .flatMap((block) => {
      const minute = logicalMinuteOfDay(block.minuteOfDay, startOfDayMinutes);
      return sliceFlowCell(Math.floor(minute / intervalMinutes) * intervalMinutes, intervalMinutes, rowMinutes)
        .map((slice) => ({ hourIndex: slice.rowIndex, rowIndex: slice.columnOffset, rowSpan: slice.columnSpan }));
    })
    .sort((left, right) => left.hourIndex - right.hourIndex || left.rowIndex - right.rowIndex);
  const segments: FlowHoverOverlaySegment[] = [];

  for (const cell of cells) {
    const previous = segments[segments.length - 1];
    const isSameColumnContinuation = previous && previous.hourIndex === cell.hourIndex && previous.rowIndex + previous.rowSpan >= cell.rowIndex;
    if (isSameColumnContinuation) {
      segments[segments.length - 1] = { ...previous, rowSpan: Math.max(previous.rowSpan, cell.rowIndex + cell.rowSpan - previous.rowIndex) };
      continue;
    }
    segments.push(cell);
  }

  return segments;
}
