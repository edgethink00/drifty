import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { logicalMinuteOfDay, normalizeStartOfDayMinutes, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import { FlowChartGrid } from "./FlowChartGrid";
import { FlowChartHeader } from "./FlowChartHeader";
import type { FlowColorMode } from "./FlowChartTypes";
import { FlowLegendHoverCard, type FlowLegendHoverState } from "./FlowChartHoverCards";
import { FlowHoverLayer } from "./FlowHoverLayer";
import { buildFlowBlockHoverGroups } from "./flowHoverGroups";
import type { ProjectLegendEntry } from "./projectFlowView";

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
  projectModeAvailable = false,
  projectLegend,
  colorMode: controlledColorMode,
  onColorModeChange,
  deviceLabelById,
}: {
  blocks: FlowBlock[];
  appIcons: Record<string, string | null>;
  currentMinuteOfDay?: number | null;
  intervalMinutes?: FlowIntervalMinutes;
  onIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  showEmptyGrid?: boolean;
  startOfDayMinutes?: number;
  projectModeAvailable?: boolean;
  projectLegend?: readonly ProjectLegendEntry[];
  colorMode?: FlowColorMode;
  onColorModeChange?: (mode: FlowColorMode) => void;
  deviceLabelById?: ReadonlyMap<string, string>;
}) {
  const [hoveredLegend, setHoveredLegend] = useState<FlowLegendHoverState | null>(null);
  // projectId → legend entry, so the hover card can name a block's project.
  const projectsById = useMemo(() => {
    const next = new Map<string, ProjectLegendEntry>();
    for (const entry of projectLegend ?? []) {
      if (entry.projectId) next.set(entry.projectId, entry);
    }
    return next;
  }, [projectLegend]);
  const [internalColorMode, setInternalColorMode] = useState<FlowColorMode>("category");
  const colorMode = controlledColorMode ?? internalColorMode;
  const setColorMode = onColorModeChange ?? setInternalColorMode;
  const effectiveColorMode: FlowColorMode = colorMode === "project" && !projectModeAvailable ? "category" : colorMode;
  const [flowGridElement, setFlowGridElement] = useState<HTMLDivElement | null>(null);
  const hoveredLegendCardRef = useRef<HTMLDivElement>(null);
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
  const minuteAxisFontSize = intervalMinutes === 3 ? "0.52rem" : "0.58rem";
  const chartStyle: CSSProperties & Record<"--flow-cell-min-height" | "--flow-breakdown-cell-min-height" | "--flow-minute-axis-font-size" | "--flow-row-count", string> = {
    "--flow-cell-min-height": `${(FLOW_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-breakdown-cell-min-height": `${(FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-minute-axis-font-size": minuteAxisFontSize,
    "--flow-row-count": `${60 / intervalMinutes}`,
  };
  if (blocks.length === 0 && !showEmptyGrid) return null;

  return (
    <section className="flow-chart-card" aria-label={`${intervalMinutes}-minute flow chart`} data-flow-interval={intervalMinutes} data-flow-color-mode={effectiveColorMode} style={chartStyle}>
      <FlowChartHeader
        blocks={blocks}
        colorMode={effectiveColorMode}
        hoveredLegendCardRef={hoveredLegendCardRef}
        intervalMinutes={intervalMinutes}
        onColorModeChange={setColorMode}
        onIntervalChange={onIntervalChange}
        setHoveredLegend={setHoveredLegend}
        projectModeAvailable={projectModeAvailable}
        projectLegend={projectLegend}
      />

      <FlowChartGrid
        blockByCell={blockByCell}
        boundaryMinutes={boundaryMinutes}
        colorMode={effectiveColorMode}
        currentHourIndex={currentHourIndex}
        currentMinuteOffset={currentMinuteOffset}
        hoverGroupsByCell={hoverGroupsByCell}
        intervalMinutes={intervalMinutes}
        setFlowGridElement={setFlowGridElement}
      />

      <FlowHoverLayer
        gridElement={flowGridElement}
        hoverGroupsByCell={hoverGroupsByCell}
        intervalMinutes={intervalMinutes}
        boundaryMinutes={boundaryMinutes}
        appIcons={appIcons}
        deviceLabelById={deviceLabelById}
        projectsById={projectsById}
      />
      {hoveredLegend ? <FlowLegendHoverCard hover={hoveredLegend} appIcons={appIcons} cardRef={hoveredLegendCardRef} /> : null}
    </section>
  );
}
