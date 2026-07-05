import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { logicalMinuteOfDay, normalizeStartOfDayMinutes, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import { FlowChartGrid } from "./FlowChartGrid";
import { FlowChartHeader } from "./FlowChartHeader";
import type { FlowColorMode } from "./FlowChartTypes";
import { FlowHoverCard, FlowLegendHoverCard, type FlowHoverState, type FlowLegendHoverState } from "./FlowChartHoverCards";
import { buildFlowBlockHoverGroups } from "./flowHoverGroups";
import { useFlowChartHoverDelegation } from "./useFlowChartHoverDelegation";

const BASE_FLOW_CELL_INTERVAL_MINUTES = 3;
const FLOW_CELL_BASE_MIN_HEIGHT_REM = 0.5;
const FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM = 0.76;

export function FlowChartView({
  blocks,
  appIcons,
  currentMinuteOfDay,
  intervalMinutes = 3,
  onIntervalChange,
  showEmptyGrid = false,
  startOfDayMinutes = 0,
}: {
  blocks: FlowBlock[];
  appIcons: Record<string, string | null>;
  currentMinuteOfDay?: number | null;
  intervalMinutes?: FlowIntervalMinutes;
  onIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  showEmptyGrid?: boolean;
  startOfDayMinutes?: number;
}) {
  const [hoveredBlock, setHoveredBlock] = useState<FlowHoverState | null>(null);
  const [hoveredLegend, setHoveredLegend] = useState<FlowLegendHoverState | null>(null);
  const [colorMode, setColorMode] = useState<FlowColorMode>("category");
  const [flowGridElement, setFlowGridElement] = useState<HTMLDivElement | null>(null);
  const hoveredBlockCardRef = useRef<HTMLDivElement>(null);
  const hoveredLegendCardRef = useRef<HTMLDivElement>(null);
  const hoveredGroupMinutes = useMemo(
    () => hoveredBlock ? new Set(hoveredBlock.group.blocks.map((block) => block.minuteOfDay)) : null,
    [hoveredBlock],
  );
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const currentLogicalMinute = currentMinuteOfDay !== null && currentMinuteOfDay !== undefined ? logicalMinuteOfDay(currentMinuteOfDay, boundaryMinutes) : null;
  const currentHourIndex = currentLogicalMinute !== null ? Math.floor(currentLogicalMinute / 60) : null;
  const currentMinuteOffset = currentLogicalMinute !== null
    ? Math.floor((currentLogicalMinute % 60) / intervalMinutes) * intervalMinutes
    : null;
  const blockByCell = useMemo(() => {
    const next = new Map<string, FlowBlock>();
    for (const block of blocks) next.set(`${block.minuteOfDay}`, block);
    return next;
  }, [blocks]);
  const hoverGroupsByCell = useMemo(
    () => buildFlowBlockHoverGroups(blocks, intervalMinutes, boundaryMinutes),
    [blocks, boundaryMinutes, intervalMinutes],
  );
  useFlowChartHoverDelegation({ gridElement: flowGridElement, cardRef: hoveredBlockCardRef, hoverGroupsByCell, setHoveredBlock });
  const minuteAxisFontSize = intervalMinutes === 3 ? "0.52rem" : "0.58rem";
  const chartStyle: CSSProperties & Record<"--flow-cell-min-height" | "--flow-breakdown-cell-min-height" | "--flow-minute-axis-font-size" | "--flow-row-count", string> = {
    "--flow-cell-min-height": `${(FLOW_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-breakdown-cell-min-height": `${(FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-minute-axis-font-size": minuteAxisFontSize,
    "--flow-row-count": `${60 / intervalMinutes}`,
  };
  if (blocks.length === 0 && !showEmptyGrid) return null;

  return (
    <section className="flow-chart-card" aria-label={`${intervalMinutes}-minute flow chart`} data-flow-interval={intervalMinutes} data-flow-color-mode={colorMode} style={chartStyle}>
      <FlowChartHeader
        blocks={blocks}
        colorMode={colorMode}
        hoveredLegendCardRef={hoveredLegendCardRef}
        intervalMinutes={intervalMinutes}
        onColorModeChange={setColorMode}
        onIntervalChange={onIntervalChange}
        setHoveredLegend={setHoveredLegend}
      />

      <FlowChartGrid
        blockByCell={blockByCell}
        boundaryMinutes={boundaryMinutes}
        colorMode={colorMode}
        currentHourIndex={currentHourIndex}
        currentMinuteOffset={currentMinuteOffset}
        hoverGroupsByCell={hoverGroupsByCell}
        hoveredBlock={hoveredBlock}
        hoveredGroupMinutes={hoveredGroupMinutes}
        intervalMinutes={intervalMinutes}
        setFlowGridElement={setFlowGridElement}
      />

      {hoveredBlock ? <FlowHoverCard hover={hoveredBlock} appIcons={appIcons} cardRef={hoveredBlockCardRef} /> : null}
      {hoveredLegend ? <FlowLegendHoverCard hover={hoveredLegend} appIcons={appIcons} cardRef={hoveredLegendCardRef} /> : null}
    </section>
  );
}
