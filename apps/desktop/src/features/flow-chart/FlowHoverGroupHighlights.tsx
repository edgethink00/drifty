import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { FlowIntervalMinutes } from "@drifty/domain";
import { buildFlowHoverOverlaySegments } from "./flowHoverOverlay";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";

type FlowHoverGroupHighlightsProps = {
  readonly group: FlowBlockHoverGroup;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly boundaryMinutes: number;
};

type FlowHoverHighlightStyle = CSSProperties & Record<"--flow-hover-hour" | "--flow-hover-row" | "--flow-hover-row-span", number>;

export function FlowHoverGroupHighlights({ group, intervalMinutes, boundaryMinutes }: FlowHoverGroupHighlightsProps) {
  const segments = useMemo(
    () => buildFlowHoverOverlaySegments(group, intervalMinutes, boundaryMinutes),
    [boundaryMinutes, group, intervalMinutes],
  );

  return (
    <>
      {segments.map((segment) => {
        const style: FlowHoverHighlightStyle = {
          "--flow-hover-hour": segment.hourIndex,
          "--flow-hover-row": segment.rowIndex,
          "--flow-hover-row-span": segment.rowSpan,
        };
        return (
          <span
            aria-hidden="true"
            className="flow-hover-group-highlight"
            key={`${segment.hourIndex}-${segment.rowIndex}-${segment.rowSpan}`}
            style={style}
          />
        );
      })}
    </>
  );
}
