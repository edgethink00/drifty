import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { hoversWhileSelected, useActivityInspection, type ActivityLaneSelection } from "../dashboard/ActivityInspectionContext";
import {
  logicalMinuteOfDay,
  normalizeStartOfDayMinutes,
  type ActivityCategory,
  type ActivitySegment,
  type ClassificationOptions,
  type FlowBlock,
  type FlowIntervalMinutes,
  type ProductivityLabel,
} from "@drifty/domain";
import {
  WeekActivityInspector,
  resolveActivityActionsDisabledReason,
  type ActivityInspectorEvent,
  type ActivityInspectorProjectOption,
  type ActivityInspectorSaveHandler,
  type ActivityInspectorView,
} from "../dashboard/WeekActivityInspector";
import { FlowChartGrid, type FlowChartOrientation, type FlowChartRowAside } from "./FlowChartGrid";
import { FlowChartHeader } from "./FlowChartHeader";
import type { TimelineZoomState } from "../dashboard/timelineZoom";
import type { CategoryEditorTarget } from "../categories/categoryEditorModel";
import type { FlowColorMode } from "./FlowChartTypes";
import { FlowLegendHoverCard, type FlowLegendHoverState } from "./FlowChartHoverCards";
import { buildFlowActivityInspectorEvent, flowGroupActivityLabel, FlowHoverLayer } from "./FlowHoverLayer";
import { useActivityLabels } from "../activity-labels/ActivityLabelsContext";
import { buildFlowBlockHoverGroups, type FlowBlockHoverGroup } from "./flowHoverGroups";
import type { AnchoredFlowHoverState } from "./useFlowChartHoverDelegation";
import type { ProjectLegendEntry } from "./projectFlowView";
import { useLocalization } from "../localization/LocalizationContext";
import { FlowHoverGroupHighlights } from "./FlowHoverGroupHighlights";
import { moveFlowHoverCardToPointer } from "./FlowChartHoverCards";
import { buildPhoneFlowCells, type PhoneFlowCell, type PhoneTimeBlock } from "../phone-time/phoneFlowCells";
import { PhoneFlowHoverCard, type PhoneFlowHoverState } from "../phone-time/PhoneFlowHoverCard";
import type { FlowChartScrollScale } from "./FlowChartScrollArea";
import { flowRowUnitMinutes } from "./flowChartRows";

const BASE_FLOW_CELL_INTERVAL_MINUTES = 3;
const FLOW_CELL_BASE_MIN_HEIGHT_REM = 0.5;
const FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM = 0.76;
const EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS: readonly ActivityInspectorProjectOption[] = [];
const EMPTY_ACTIVITY_SEGMENTS: readonly ActivitySegment[] = [];
const EMPTY_PHONE_CELLS: ReadonlyMap<number, PhoneFlowCell> = new Map();
/** How long a record sent from History may take to appear before it is dropped. */
const FLOW_REVEAL_GIVE_UP_MS = 5000;

export function FlowChartView({
  classifiedResultIds,
  blocks,
  appIcons,
  currentMinuteOfDay,
  intervalMinutes = 3,
  showEmptyGrid = false,
  startOfDayMinutes = 0,
  projectModeAvailable = false,
  projectLegend,
  projectOptions = EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS,
  colorMode: controlledColorMode,
  onColorModeChange,
  deviceLabelById,
  segments = EMPTY_ACTIVITY_SEGMENTS,
  activityActionsEnabled = false,
  onSaveActivityValues,
  onAssignProject,
  onClassifyActivity,
  onDeleteActivity,
  classificationOptions,
  onEditCategories,
  revealSegmentId = null,
  onRevealSettled,
  orientation = "hoursAcross",
  rowAside,
  scrollScale,
  timeZoom,
  onHoverGroupChange,
  phoneTime,
  loading = false,
}: {
  readonly classifiedResultIds?: ReadonlySet<string>;
  blocks: FlowBlock[];
  appIcons: Record<string, string | null>;
  currentMinuteOfDay?: number | null;
  intervalMinutes?: FlowIntervalMinutes;
  showEmptyGrid?: boolean;
  startOfDayMinutes?: number;
  projectModeAvailable?: boolean;
  projectLegend?: readonly ProjectLegendEntry[];
  projectOptions?: readonly ActivityInspectorProjectOption[];
  colorMode?: FlowColorMode;
  onColorModeChange?: (mode: FlowColorMode) => void;
  deviceLabelById?: ReadonlyMap<string, string>;
  segments?: readonly ActivitySegment[];
  activityActionsEnabled?: boolean;
  onSaveActivityValues?: ActivityInspectorSaveHandler;
  onAssignProject?: (
    nextSegments: readonly ActivitySegment[],
    projectId: string | null,
  ) => Promise<void>;
  onClassifyActivity?: (
    nextSegments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  onDeleteActivity?: (segmentIds: readonly string[]) => Promise<void>;
  classificationOptions?: ClassificationOptions;
  /** Opens the category editor from the legend and the activity inspector. */
  onEditCategories?: (target: CategoryEditorTarget) => void;
  /** A record opened from History: scroll to its block and open its card once the day has loaded. */
  revealSegmentId?: string | null;
  /** Hours across (default) or one row per hour. */
  orientation?: FlowChartOrientation;
  rowAside?: FlowChartRowAside;
  /** The hours-down Day: one scroller, zoomed relative to the fit view. */
  scrollScale?: FlowChartScrollScale;
  timeZoom?: TimelineZoomState;
  onHoverGroupChange?: (group: FlowBlockHoverGroup | null) => void;
  /** Called once the card opens, or when the day holds no such record. */
  onRevealSettled?: () => void;
  /** The iPhone's approximate time for the shown day, drawn where the Mac recorded nothing. */
  phoneTime?: { readonly day: string; readonly blocks: readonly PhoneTimeBlock[] };
  /** The day is still loading: draw the empty frame with the legend held as a placeholder. */
  loading?: boolean;
}) {
  const { t } = useLocalization();
  const inspection = useActivityInspection();
  // Beside the chart, a selected activity no longer covers the cells, so the
  // next block can still be previewed before it is chosen.
  const hoverWhileSelected = hoversWhileSelected(inspection);
  const [hoveredLegend, setHoveredLegend] = useState<FlowLegendHoverState | null>(null);
  // projectId → legend entry, so the hover card can name a block's project.
  const projectsById = useMemo(() => {
    const next = new Map<string, ProjectLegendEntry>();
    for (const project of projectOptions) {
      if (project.id) next.set(project.id, { projectId: project.id, name: project.name, color: project.color });
    }
    for (const entry of projectLegend ?? []) {
      if (entry.projectId) next.set(entry.projectId, entry);
    }
    return next;
  }, [projectLegend, projectOptions]);
  const [internalColorMode, setInternalColorMode] = useState<FlowColorMode>("category");
  const colorMode = controlledColorMode ?? internalColorMode;
  const setColorMode = onColorModeChange ?? setInternalColorMode;
  const effectiveColorMode: FlowColorMode = colorMode === "project" && !projectModeAvailable ? "category" : colorMode;
  const [flowGridElement, setFlowGridElement] = useState<HTMLDivElement | null>(null);
  const [activityInspector, setActivityInspector] = useState<{
    readonly sessionId: number;
    readonly event: ActivityInspectorEvent;
    readonly group: FlowBlockHoverGroup;
    readonly sourceSegmentIds: readonly string[];
    readonly regroupedBlockCount: number;
    readonly anchorElement: HTMLElement;
    readonly restoreFocusTarget: HTMLElement | null;
    readonly initialView: ActivityInspectorView;
    /** The Day card that opened this cell, when one did (the panel's log describes that card). */
    readonly lane?: ActivityLaneSelection | null;
  } | null>(null);
  const activityInspectorSessionIdRef = useRef(0);
  const previewAnchorRef = useRef<AnchoredFlowHoverState | null>(null);
  const activityInspectorRef = useRef(activityInspector);
  activityInspectorRef.current = activityInspector;
  const hoveredLegendCardRef = useRef<HTMLDivElement>(null);
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const activityLabels = useActivityLabels();
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
  const phoneCellsByMinute = useMemo(() => (
    phoneTime && phoneTime.blocks.length > 0
      ? buildPhoneFlowCells(phoneTime.blocks, phoneTime.day, intervalMinutes, boundaryMinutes, (minute) => blockByCell.has(`${minute}`))
      : EMPTY_PHONE_CELLS
  ), [blockByCell, boundaryMinutes, intervalMinutes, phoneTime]);
  const [phoneHover, setPhoneHover] = useState<PhoneFlowHoverState | null>(null);
  const phoneHoverCardRef = useRef<HTMLDivElement>(null);
  const phoneHoverCells = useMemo(() => (
    phoneHover ? { blocks: [...phoneCellsByMinute.values()].filter((cell) => cell.block === phoneHover.block) } : null
  ), [phoneCellsByMinute, phoneHover]);
  const segmentsById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  );
  const hoverGroupsByCell = useMemo(
    () => buildFlowBlockHoverGroups(blocks, intervalMinutes, boundaryMinutes, segmentsById),
    [blocks, boundaryMinutes, intervalMinutes, segmentsById],
  );
  const inspectedSegments = useMemo(() => (
    activityInspector?.event.segmentIds.flatMap((segmentId) => {
      const segment = segmentsById.get(segmentId);
      return segment ? [segment] : [];
    }) ?? []
  ), [activityInspector, segmentsById]);
  const closeActivityInspector = useCallback((sessionId: number, restoreFocus = true) => {
    // A previous session's async deletion must not dismiss a newly opened card.
    if (activityInspectorRef.current?.sessionId !== sessionId) return;
    const restoreFocusTarget = activityInspectorRef.current?.restoreFocusTarget ?? null;
    setActivityInspector(null);
    if (!restoreFocus) return;
    window.setTimeout(() => {
      if (restoreFocusTarget?.isConnected) {
        const activeElement = document.activeElement;
        if (activeElement && activeElement !== document.body && activeElement !== restoreFocusTarget && activeElement.isConnected) return;
        restoreFocusTarget.dataset.activityPreviewFocusSuppressed = "true";
        restoreFocusTarget.focus();
        if (restoreFocusTarget.dataset.activityPreviewFocusSuppressed === "true") {
          delete restoreFocusTarget.dataset.activityPreviewFocusSuppressed;
        }
      }
    }, 0);
  }, []);
  const openActivityInspector = useCallback((
    group: FlowBlockHoverGroup,
    target: HTMLButtonElement,
    initialView: ActivityInspectorView = "overview",
  ) => {
    activityInspectorSessionIdRef.current += 1;
    const preview = previewAnchorRef.current;
    // A Day card opens its panel through this cell right after it is clicked.
    const lane = inspection.laneSelection.current;
    inspection.laneSelection.current = null;
    const fromLane = lane && Date.now() - lane.atMs < 1000 ? lane : null;
    setActivityInspector({
      sessionId: activityInspectorSessionIdRef.current,
      group,
      event: buildFlowActivityInspectorEvent(group, {
        projectsById, segmentsById, deviceLabelById,
        boundaryMinutes,
        thisDeviceLabel: t("dashboard.week.inspector.thisMac"),
        syncedDeviceLabel: t("dashboard.week.inspector.syncedMac"),
      }),
      sourceSegmentIds: [...new Set(group.segmentIds)],
      regroupedBlockCount: 1,
      anchorElement: preview?.group === group && preview.anchorElement.isConnected ? preview.anchorElement : target,
      restoreFocusTarget: target,
      initialView,
      lane: fromLane,
    });
  }, [inspection.laneSelection, projectsById, segmentsById, deviceLabelById, boundaryMinutes, t]);
  // Keep a pinned Inspector bound to the exact source records selected when it
  // opened. A refresh may split or merge the rendered Flow group, so only move
  // the visual anchor/highlight to the group with the greatest source overlap;
  // the Inspector's snapshot and mutation target must not silently change.
  useLayoutEffect(() => {
    setActivityInspector((current) => {
      if (!current) return current;
      const sourceSegmentIds = new Set(current.sourceSegmentIds);
      const groups = [...new Set(hoverGroupsByCell.values())];
      const candidates = groups
        .map((group) => ({
          group,
          overlap: group.segmentIds.reduce(
            (count, segmentId) => count + (sourceSegmentIds.has(segmentId) ? 1 : 0),
            0,
          ),
        }))
        .filter((candidate) => candidate.overlap > 0);
      const nextCandidate = candidates.reduce<(typeof candidates)[number] | null>((best, candidate) => {
        if (!best || candidate.overlap > best.overlap) return candidate;
        if (candidate.overlap < best.overlap) return best;
        if (candidate.group === current.group) return candidate;
        return best;
      }, null);
      if (!nextCandidate) return null;

      const nextGroup = nextCandidate.group;
      const remainsInGroup = (element: HTMLElement | null) => Boolean(
        element?.isConnected
        && flowGridElement?.contains(element)
        && hoverGroupsByCell.get(Number(element.dataset.flowMinute)) === nextGroup,
      );
      const nextAnchor = remainsInGroup(current.anchorElement)
        ? current.anchorElement
        : flowGridElement?.querySelector<HTMLElement>(
            `[data-flow-minute="${nextGroup.startMinuteOfDay}"]`,
          ) ?? null;
      if (!nextAnchor) return current;
      if (
        nextGroup === current.group
        && nextAnchor === current.anchorElement
        && candidates.length === current.regroupedBlockCount
      ) return current;
      return {
        ...current,
        group: nextGroup,
        regroupedBlockCount: candidates.length,
        anchorElement: nextAnchor,
        restoreFocusTarget: remainsInGroup(current.restoreFocusTarget) ? current.restoreFocusTarget : nextAnchor,
      };
    });
  }, [flowGridElement, hoverGroupsByCell]);

  // Open the card of a record sent from History once its block has rendered.
  const onRevealSettledRef = useRef(onRevealSettled);
  onRevealSettledRef.current = onRevealSettled;
  // The day may still be loading. Give up quietly if the record never shows;
  // the timer is keyed to the record alone, so live refreshes cannot restart it.
  useEffect(() => {
    if (!revealSegmentId) return;
    const timeoutId = window.setTimeout(() => onRevealSettledRef.current?.(), FLOW_REVEAL_GIVE_UP_MS);
    return () => window.clearTimeout(timeoutId);
  }, [revealSegmentId]);
  useEffect(() => {
    if (!revealSegmentId) return;
    const group = [...new Set(hoverGroupsByCell.values())].find((candidate) => candidate.segmentIds.includes(revealSegmentId));
    const anchor = group
      ? flowGridElement?.querySelector<HTMLButtonElement>(`button[data-flow-minute="${group.startMinuteOfDay}"]`) ?? null
      : null;
    if (!group || !anchor) return;
    anchor.scrollIntoView?.({ block: "center", inline: "center" });
    openActivityInspector(group, anchor);
    onRevealSettledRef.current?.();
  }, [flowGridElement, hoverGroupsByCell, openActivityInspector, revealSegmentId]);
  const activityActionsDisabledReason = useMemo(() => {
    if (!activityInspector) return null;
    return resolveActivityActionsDisabledReason(
      activityInspector.event,
      inspectedSegments,
      activityActionsEnabled,
      t,
    );
  }, [activityActionsEnabled, activityInspector, inspectedSegments, t]);
  // iPhone cells only describe themselves on hover; they never open the editor.
  const activityInspectorOpen = activityInspector !== null;
  useEffect(() => {
    if (!flowGridElement || phoneCellsByMinute.size === 0 || activityInspectorOpen) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-phone-minute]") : null;
      const cell = target ? phoneCellsByMinute.get(Number(target.dataset.phoneMinute)) : undefined;
      if (!cell) {
        setPhoneHover((current) => (current ? null : current));
        return;
      }
      setPhoneHover((current) => (current?.block === cell.block ? current : { block: cell.block, x: event.clientX, y: event.clientY }));
      moveFlowHoverCardToPointer(phoneHoverCardRef.current, event.clientX, event.clientY);
    };
    const handlePointerLeave = () => setPhoneHover(null);
    flowGridElement.addEventListener("pointermove", handlePointerMove);
    flowGridElement.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      flowGridElement.removeEventListener("pointermove", handlePointerMove);
      flowGridElement.removeEventListener("pointerleave", handlePointerLeave);
      setPhoneHover(null);
    };
  }, [activityInspectorOpen, flowGridElement, phoneCellsByMinute]);
  // The minute axis sits a hair under the shared 11px floor. It is the densest
  // repeated label in the app (up to 20 marks per hour), so at the full floor it
  // read heavier than everything around it; 3% back keeps it legible without
  // letting the axis dominate the chart. The denser 3-minute view no longer
  // shrinks further, which is what made it unreadable before.
  const minuteAxisFontSize = "0.667rem";
  // Both orientations draw one row (or column) per hour.
  const displayRowMinutes = 60;
  const chartStyle: CSSProperties & Record<string, string> = {
    "--flow-cell-min-height": `${(FLOW_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-breakdown-cell-min-height": `${(FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-minute-axis-font-size": minuteAxisFontSize,
    "--flow-row-count": `${displayRowMinutes / flowRowUnitMinutes(displayRowMinutes, intervalMinutes)}`,
    "--flow-time-row-count": `${1440 / displayRowMinutes}`,
    "--flow-row-minutes": `${displayRowMinutes}`,
    "--flow-time-row-fraction": `${displayRowMinutes / 60}`,
  };
  if (blocks.length === 0 && !showEmptyGrid) return null;

  const grid = <FlowChartGrid
    classifiedResultIds={classifiedResultIds}
    blockByCell={blockByCell}
    boundaryMinutes={boundaryMinutes}
    colorMode={effectiveColorMode}
    currentHourIndex={currentHourIndex}
    currentMinuteOffset={currentMinuteOffset}
    currentLogicalMinute={currentLogicalMinute}
    hoverGroupsByCell={hoverGroupsByCell}
    intervalMinutes={intervalMinutes}
    setFlowGridElement={setFlowGridElement}
    onOpenActivity={openActivityInspector}
    inspectedGroup={activityInspector?.group ?? null}
    orientation={orientation}
    rowAside={rowAside}
    scrollScale={scrollScale}
    phoneCellsByMinute={phoneCellsByMinute}
  />;
  const scrollable = orientation === "hoursDown" && scrollScale;
  return (
    <section className={`flow-chart-card${orientation === "hoursDown" ? " flow-chart-card--hours-down" : ""}${scrollable ? " flow-chart-card--scroll" : ""}`} aria-label={t("dashboard.today.flowChart", { interval: intervalMinutes })} aria-busy={loading || undefined} data-flow-interval={intervalMinutes} data-flow-color-mode={effectiveColorMode} data-flow-time-axis={orientation === "hoursDown" ? "hours" : undefined} style={chartStyle}>
      <FlowChartHeader
        blocks={blocks}
        colorMode={effectiveColorMode}
        hoveredLegendCardRef={hoveredLegendCardRef}
        onColorModeChange={setColorMode}
        setHoveredLegend={setHoveredLegend}
        projectModeAvailable={projectModeAvailable}
        projectLegend={projectLegend}
        onEditCategories={onEditCategories}
        hasPhoneTime={phoneCellsByMinute.size > 0}
        timeZoom={timeZoom}
        loading={loading}
      />

      {grid}
      {flowGridElement && phoneHoverCells && phoneHoverCells.blocks.length > 0
        ? createPortal(
            <FlowHoverGroupHighlights group={phoneHoverCells} intervalMinutes={intervalMinutes} boundaryMinutes={boundaryMinutes} />,
            flowGridElement,
          )
        : null}
      {phoneHover && !activityInspector ? <PhoneFlowHoverCard hover={phoneHover} cardRef={phoneHoverCardRef} /> : null}

      <FlowHoverLayer
        onHoverGroupChange={onHoverGroupChange}
        avoidRowAside={Boolean(rowAside)}
        previewAnchorRef={previewAnchorRef}
        gridElement={flowGridElement}
        hoverGroupsByCell={hoverGroupsByCell}
        intervalMinutes={intervalMinutes}
        boundaryMinutes={boundaryMinutes}
        appIcons={appIcons}
        segmentsById={segmentsById}
        deviceLabelById={deviceLabelById}
        projectsById={projectsById}
        projectOptions={projectOptions}
        activityActionsEnabled={activityActionsEnabled}
        classificationOptions={classificationOptions}
        disabled={activityInspector !== null && !hoverWhileSelected}
        pinnedGroup={activityInspector?.group ?? null}
      />
      {hoveredLegend && !activityInspector ? <FlowLegendHoverCard hover={hoveredLegend} appIcons={appIcons} cardRef={hoveredLegendCardRef} /> : null}
      {activityInspector ? (
        <WeekActivityInspector
          key={activityInspector.sessionId}
          event={activityInspector.event}
          segments={inspectedSegments}
            screenEvidenceSegments={segments}
          appIcons={appIcons}
          deviceLabelById={deviceLabelById}
          anchorElement={activityInspector.anchorElement}
          actionsDisabledReason={activityActionsDisabledReason}
          projectOptions={projectOptions}
          initialView={activityInspector.initialView}
          regroupedBlockCount={activityInspector.regroupedBlockCount}
          onClose={(restoreFocus) => closeActivityInspector(activityInspector.sessionId, restoreFocus)}
          onSaveValues={onSaveActivityValues}
          onAssignProject={onAssignProject}
          onClassify={onClassifyActivity}
          onDelete={onDeleteActivity}
          classificationOptions={classificationOptions}
          activityLabel={(inspection.presentation === "panel" ? activityInspector.lane?.label : null)
            ?? flowGroupActivityLabel(activityLabels, activityInspector.group, boundaryMinutes)}
          logStretch={activityInspector.lane?.stretch}
          detailLog={activityLabels?.detailLog}
          onEditCategories={onEditCategories}
        />
      ) : null}
    </section>
  );
}
