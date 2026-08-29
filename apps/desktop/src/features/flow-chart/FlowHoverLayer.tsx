import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FlowIntervalMinutes } from "@drifty/domain";
import { FlowHoverGroupHighlights } from "./FlowHoverGroupHighlights";
import { FlowHoverCard, moveFlowHoverCardToPointer, type FlowHoverState } from "./FlowChartHoverCards";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";
import type { ProjectLegendEntry } from "./projectFlowView";
import { useFlowChartHoverDelegation } from "./useFlowChartHoverDelegation";

type FlowHoverLayerProps = {
  readonly gridElement: HTMLDivElement | null;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly boundaryMinutes: number;
  readonly appIcons: Record<string, string | null>;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly projectsById?: ReadonlyMap<string, ProjectLegendEntry>;
  readonly showClassificationSource?: boolean;
};

// Owns the pointer-driven hover state so that moving across cells re-renders only this
// layer — never the grid (memoized) or the surrounding chart. The group highlight is
// portaled into the grid element so it keeps sharing the grid's positioning context and
// CSS custom properties without the grid depending on hover state.
export function FlowHoverLayer({
  gridElement,
  hoverGroupsByCell,
  intervalMinutes,
  boundaryMinutes,
  appIcons,
  deviceLabelById,
  projectsById,
  showClassificationSource,
}: FlowHoverLayerProps) {
  const [hoveredBlock, setHoveredBlock] = useState<FlowHoverState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useFlowChartHoverDelegation({ gridElement, cardRef, hoverGroupsByCell, setHoveredBlock });

  useLayoutEffect(() => {
    if (!hoveredBlock) return;
    moveFlowHoverCardToPointer(cardRef.current, hoveredBlock.x, hoveredBlock.y);
  }, [hoveredBlock]);

  return (
    <>
      {gridElement && hoveredBlock
        ? createPortal(
            <FlowHoverGroupHighlights group={hoveredBlock.group} intervalMinutes={intervalMinutes} boundaryMinutes={boundaryMinutes} />,
            gridElement,
          )
        : null}
      {hoveredBlock ? <FlowHoverCard hover={hoveredBlock} appIcons={appIcons} cardRef={cardRef} deviceLabelById={deviceLabelById} projectsById={projectsById} showClassificationSource={showClassificationSource} /> : null}
    </>
  );
}
