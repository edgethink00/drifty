import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  isRemoteDeviceSegment,
  logicalMinuteOfDay,
  normalizeStartOfDayMinutes,
  type ActivityCategory,
  type ActivitySegment,
  type ClassificationOptions,
  type FlowBlock,
  type FlowIntervalMinutes,
  type ProductivityLabel,
} from "@drifty/domain";
import { WeekActivityInspector, type ActivityInspectorEvent } from "../dashboard/WeekActivityInspector";
import { formatCalendarMinuteLabel } from "../../lib/formatting";
import { FlowChartGrid } from "./FlowChartGrid";
import { FlowChartHeader } from "./FlowChartHeader";
import { blockDisplayName, formatGroupTimeRange } from "./flowChartFormat";
import type { FlowColorMode } from "./FlowChartTypes";
import { FlowLegendHoverCard, type FlowLegendHoverState } from "./FlowChartHoverCards";
import { FlowHoverLayer } from "./FlowHoverLayer";
import { buildFlowBlockHoverGroups, type FlowBlockHoverGroup } from "./flowHoverGroups";
import type { ProjectLegendEntry } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";

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
  segments = [],
  activityActionsEnabled = false,
  onClassifyActivity,
  onDeleteActivity,
  classificationOptions,
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
  segments?: readonly ActivitySegment[];
  activityActionsEnabled?: boolean;
  onClassifyActivity?: (
    nextSegments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  onDeleteActivity?: (segmentIds: readonly string[]) => Promise<void>;
  classificationOptions?: ClassificationOptions;
}) {
  const { t } = useLocalization();
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
  const [activityInspector, setActivityInspector] = useState<{
    readonly event: ActivityInspectorEvent;
    readonly group: FlowBlockHoverGroup;
    readonly pointer: { readonly x: number; readonly y: number };
    readonly fallbackRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
    readonly restoreFocusTarget: HTMLElement | null;
  } | null>(null);
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
  const segmentsById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  );
  const inspectedSegments = useMemo(() => (
    activityInspector?.event.segmentIds.flatMap((segmentId) => {
      const segment = segmentsById.get(segmentId);
      return segment ? [segment] : [];
    }) ?? []
  ), [activityInspector, segmentsById]);
  const closeActivityInspector = useCallback(() => {
    setActivityInspector((current) => {
      const restoreFocusTarget = current?.restoreFocusTarget ?? null;
      window.setTimeout(() => {
        if (restoreFocusTarget?.isConnected) restoreFocusTarget.focus();
      }, 0);
      return null;
    });
  }, []);
  const openActivityInspector = useCallback((group: FlowBlockHoverGroup, target: HTMLElement, pointer: { readonly x: number; readonly y: number }) => {
    const block = group.block;
    const displayName = blockDisplayName(block);
    const [startLabel, endLabel] = formatGroupTimeRange(group).split("–");
    const identityId = block.siteDomain ?? block.bundleId ?? block.appName;
    const rect = target.getBoundingClientRect();
    setActivityInspector({
      group,
      event: {
        id: `${block.day}-${group.startMinuteOfDay}-${group.endMinuteOfDay}-${identityId}`,
        segmentIds: group.segmentIds,
        appName: displayName,
        category: block.category,
        productivity: block.productivity,
        startLabel: startLabel || formatCalendarMinuteLabel(block.day, group.startMinuteOfDay, boundaryMinutes),
        endLabel: endLabel || formatCalendarMinuteLabel(block.day, group.endMinuteOfDay, boundaryMinutes),
        identities: [{
          id: identityId,
          label: displayName,
          appName: block.appName,
          bundleId: block.bundleId ?? null,
          siteDomain: block.siteDomain ?? null,
        }],
        hasMixedCategory: false,
        hasMixedProductivity: false,
      },
      pointer,
      fallbackRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      restoreFocusTarget: target,
    });
  }, [boundaryMinutes]);
  const activityActionsDisabledReason = useMemo(() => {
    if (!activityInspector) return null;
    if (inspectedSegments.length !== activityInspector.event.segmentIds.length) {
      return "Some source records are no longer available. Refresh the day before editing.";
    }
    if (inspectedSegments.some(isRemoteDeviceSegment)) {
      return "Synced activity can be viewed here, but must be edited on the Mac that recorded it.";
    }
    if (!activityActionsEnabled) {
      return "Activity editing is unavailable in preview or replay mode.";
    }
    return null;
  }, [activityActionsEnabled, activityInspector, inspectedSegments]);
  // The minute axis sits a hair under the shared 11px floor. It is the densest
  // repeated label in the app (up to 20 marks per hour), so at the full floor it
  // read heavier than everything around it; 3% back keeps it legible without
  // letting the axis dominate the chart. The denser 3-minute view no longer
  // shrinks further, which is what made it unreadable before.
  const minuteAxisFontSize = "0.667rem";
  const chartStyle: CSSProperties & Record<"--flow-cell-min-height" | "--flow-breakdown-cell-min-height" | "--flow-minute-axis-font-size" | "--flow-row-count", string> = {
    "--flow-cell-min-height": `${(FLOW_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-breakdown-cell-min-height": `${(FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-minute-axis-font-size": minuteAxisFontSize,
    "--flow-row-count": `${60 / intervalMinutes}`,
  };
  if (blocks.length === 0 && !showEmptyGrid) return null;

  return (
    <section className="flow-chart-card" aria-label={t("dashboard.today.flowChart", { interval: intervalMinutes })} data-flow-interval={intervalMinutes} data-flow-color-mode={effectiveColorMode} style={chartStyle}>
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
        onOpenActivity={openActivityInspector}
      />

      <FlowHoverLayer
        gridElement={flowGridElement}
        hoverGroupsByCell={hoverGroupsByCell}
        intervalMinutes={intervalMinutes}
        boundaryMinutes={boundaryMinutes}
        appIcons={appIcons}
        deviceLabelById={deviceLabelById}
        projectsById={projectsById}
        disabled={activityInspector !== null}
      />
      {hoveredLegend && !activityInspector ? <FlowLegendHoverCard hover={hoveredLegend} appIcons={appIcons} cardRef={hoveredLegendCardRef} /> : null}
      {activityInspector ? (
        <WeekActivityInspector
          key={activityInspector.event.id}
          event={activityInspector.event}
          segments={inspectedSegments}
          appIcons={appIcons}
          deviceLabelById={deviceLabelById}
          pointer={activityInspector.pointer}
          fallbackRect={activityInspector.fallbackRect}
          actionsDisabledReason={activityActionsDisabledReason}
          onClose={closeActivityInspector}
          onClassify={onClassifyActivity}
          onDelete={onDeleteActivity}
          classificationOptions={classificationOptions}
        />
      ) : null}
    </section>
  );
}
