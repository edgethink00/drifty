import { logicalMinuteOfDay, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";

/** Any run of cells to outline: a Mac activity group or one iPhone block. */
export type FlowHighlightedCells = {
  readonly blocks: readonly Pick<FlowBlock, "minuteOfDay">[];
};

export type FlowHoverOverlaySegment = {
  readonly hourIndex: number;
  readonly rowIndex: number;
  readonly rowSpan: number;
};

type FlowHoverOverlayCell = {
  readonly hourIndex: number;
  readonly rowIndex: number;
};

function overlayCellForMinute(minuteOfDay: number, intervalMinutes: FlowIntervalMinutes, startOfDayMinutes: number): FlowHoverOverlayCell {
  const logicalMinute = logicalMinuteOfDay(minuteOfDay, startOfDayMinutes);
  return {
    hourIndex: Math.floor(logicalMinute / 60),
    rowIndex: Math.floor((logicalMinute % 60) / intervalMinutes),
  };
}

export function buildFlowHoverOverlaySegments(group: FlowHighlightedCells, intervalMinutes: FlowIntervalMinutes, startOfDayMinutes: number): readonly FlowHoverOverlaySegment[] {
  const cells = group.blocks
    .map((block) => overlayCellForMinute(block.minuteOfDay, intervalMinutes, startOfDayMinutes))
    .sort((left, right) => left.hourIndex - right.hourIndex || left.rowIndex - right.rowIndex);
  const segments: FlowHoverOverlaySegment[] = [];

  for (const cell of cells) {
    const previous = segments[segments.length - 1];
    const isSameColumnContinuation = previous && previous.hourIndex === cell.hourIndex && previous.rowIndex + previous.rowSpan === cell.rowIndex;
    if (isSameColumnContinuation) {
      segments[segments.length - 1] = { ...previous, rowSpan: previous.rowSpan + 1 };
      continue;
    }
    segments.push({ hourIndex: cell.hourIndex, rowIndex: cell.rowIndex, rowSpan: 1 });
  }

  return segments;
}
