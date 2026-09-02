import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActivitySegment, ClassificationOptions, FlowIntervalMinutes } from "@drifty/domain";
import {
  ActivityInspectorPreview,
  resolveActivityActionsDisabledReason,
  type ActivityInspectorAttribute,
  type ActivityInspectorEvent,
  type ActivityInspectorProjectOption,
  type ActivityInspectorView,
} from "../dashboard/WeekActivityInspector";
import { FlowHoverGroupHighlights } from "./FlowHoverGroupHighlights";
import { FlowHoverCard, moveFlowHoverCardToPointer } from "./FlowChartHoverCards";
import { buildFlowHoverGroupContributions, type FlowBlockHoverGroup } from "./flowHoverGroups";
import type { ProjectLegendEntry } from "./projectFlowView";
import { blockDetailLabel, blockDisplayName, formatGroupTimeRange } from "./flowChartFormat";
import { useFlowChartHoverDelegation, type AnchoredFlowHoverState } from "./useFlowChartHoverDelegation";
import { useLocalization } from "../localization/LocalizationContext";

const EMPTY_ACTIVITY_SEGMENTS_BY_ID = new Map<string, ActivitySegment>();
const EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS: readonly ActivityInspectorProjectOption[] = [];

type FlowHoverLayerProps = {
  readonly gridElement: HTMLDivElement | null;
  readonly hoverGroupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly boundaryMinutes: number;
  readonly appIcons: Record<string, string | null>;
  readonly segmentsById?: ReadonlyMap<string, ActivitySegment>;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly projectsById?: ReadonlyMap<string, ProjectLegendEntry>;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly activityActionsEnabled?: boolean;
  readonly classificationOptions?: ClassificationOptions;
  readonly hasAssignProjectAction?: boolean;
  readonly hasClassifyAction?: boolean;
  readonly hasDeleteAction?: boolean;
  readonly onOpenActivity?: (
    group: FlowBlockHoverGroup,
    target: HTMLButtonElement,
    initialView: ActivityInspectorView,
  ) => void;
  readonly disabled?: boolean;
  readonly pinnedGroup?: FlowBlockHoverGroup | null;
};

export function buildFlowActivityInspectorEvent(
  group: FlowBlockHoverGroup,
  options: {
    readonly projectsById?: ReadonlyMap<string, ProjectLegendEntry>;
  } = {},
): ActivityInspectorEvent {
  const { block } = group;
  const { projectsById } = options;
  const displayName = blockDisplayName(block);
  const [startLabel = "", endLabel = ""] = formatGroupTimeRange(group).split("–");
  const identityId = block.siteDomain ?? block.bundleId ?? block.appName;
  // Every app/site that shared the highlighted cells, painted winner first. The cell
  // only shows the winner's color, so the inspector lists the rest to explain what
  // else filled the range and what surfaces if the winner's records are removed.
  const contributions = buildFlowHoverGroupContributions(group);
  const projectWeights = new Map<string, { readonly projectId: string | null; seconds: number; order: number }>();
  const projectBySegmentId = new Map<string, string | null>();
  for (const [order, groupedBlock] of group.blocks.entries()) {
    const key = groupedBlock.projectId ?? "__no_project__";
    const current = projectWeights.get(key) ?? { projectId: groupedBlock.projectId ?? null, seconds: 0, order };
    current.seconds += groupedBlock.durationSeconds;
    current.order = order;
    projectWeights.set(key, current);
    for (const segmentId of groupedBlock.sourceSegmentIds ?? []) {
      projectBySegmentId.set(segmentId, groupedBlock.projectId ?? null);
    }
  }
  let dominantProject: { readonly projectId: string | null; seconds: number; order: number } | null = null;
  for (const candidate of projectWeights.values()) {
    if (!dominantProject || candidate.seconds > dominantProject.seconds || (candidate.seconds === dominantProject.seconds && candidate.order > dominantProject.order)) {
      dominantProject = candidate;
    }
  }
  const projectId = dominantProject ? dominantProject.projectId : block.projectId ?? null;
  const project = projectId ? projectsById?.get(projectId) ?? null : null;
  return {
    id: `${block.day}-${group.startMinuteOfDay}-${group.endMinuteOfDay}-${identityId}`,
    surface: "flow",
    segmentIds: group.segmentIds,
    appName: displayName,
    projectId,
    projectName: project?.name ?? null,
    projectColor: project?.color ?? (projectId === (block.projectId ?? null) ? block.projectColor ?? null : null),
    projectAssignments: group.segmentIds.map((segmentId) => ({
      segmentId,
      projectId: projectBySegmentId.has(segmentId)
        ? projectBySegmentId.get(segmentId) ?? null
        : projectId,
    })),
    category: block.category,
    productivity: block.productivity,
    startLabel,
    endLabel,
    identities: contributions.map((contribution, index) => ({
      id: index === 0 ? identityId : contribution.id,
      label: index === 0 ? displayName : contribution.label,
      appName: contribution.appName,
      bundleId: contribution.bundleId,
      siteDomain: contribution.siteDomain,
      seconds: contribution.durationSeconds,
    })),
    // Category/productivity edits and delete only target the painted winner's records
    // (segmentIds), so the chips stay winner-only instead of flagging runner-ups as mixed.
    hasMixedCategory: false,
    hasMixedProductivity: false,
    hasMixedProject: projectWeights.size > 1,
    detailLabel: blockDetailLabel(block),
    durationSeconds: group.durationSeconds,
  };
}

// Pointer inspection stays lightweight and non-interactive so it cannot cover
// neighboring Flow cells. Keyboard focus keeps the accessible anchored preview;
// clicking either path opens the full pinned inspector for editing.
export function FlowHoverLayer({
  gridElement,
  hoverGroupsByCell,
  intervalMinutes,
  boundaryMinutes,
  appIcons,
  segmentsById = EMPTY_ACTIVITY_SEGMENTS_BY_ID,
  deviceLabelById,
  projectsById,
  projectOptions = EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS,
  activityActionsEnabled = false,
  classificationOptions,
  hasAssignProjectAction = false,
  hasClassifyAction = false,
  hasDeleteAction = false,
  onOpenActivity,
  disabled = false,
  pinnedGroup = null,
}: FlowHoverLayerProps) {
  const { t } = useLocalization();
  const [hoveredBlock, setHoveredBlock] = useState<AnchoredFlowHoverState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { clearFocusHover, dismissHover } = useFlowChartHoverDelegation({
    gridElement,
    cardRef,
    hoverGroupsByCell,
    setHoveredBlock,
    disabled,
  });
  const pointerHover = hoveredBlock?.trigger === "pointer" ? hoveredBlock : null;
  const focusHover = hoveredBlock?.trigger === "focus" ? hoveredBlock : null;

  useLayoutEffect(() => {
    if (!pointerHover) return;
    moveFlowHoverCardToPointer(cardRef.current, pointerHover.x, pointerHover.y);
  }, [pointerHover]);

  const highlightedGroup = disabled ? pinnedGroup : hoveredBlock?.group ?? null;
  const previewEvent = focusHover
    ? buildFlowActivityInspectorEvent(focusHover.group, { projectsById })
    : null;
  const previewSegments = previewEvent?.segmentIds.flatMap((segmentId) => {
    const segment = segmentsById.get(segmentId);
    return segment ? [segment] : [];
  }) ?? [];
  const actionsDisabledReason = previewEvent
    ? resolveActivityActionsDisabledReason(previewEvent, previewSegments, activityActionsEnabled, t)
    : null;

  return (
    <>
      {gridElement && highlightedGroup
        ? createPortal(
            <FlowHoverGroupHighlights
              group={highlightedGroup}
              intervalMinutes={intervalMinutes}
              boundaryMinutes={boundaryMinutes}
              variant={disabled ? "pinned" : "hover"}
            />,
            gridElement,
          )
        : null}
      {!disabled && pointerHover ? (
        <FlowHoverCard
          hover={pointerHover}
          appIcons={appIcons}
          cardRef={cardRef}
          deviceLabelById={deviceLabelById}
          projectsById={projectsById}
          showClassificationSource={false}
        />
      ) : null}
      {!disabled && focusHover ? (
        <ActivityInspectorPreview
          event={previewEvent!}
          segments={previewSegments}
          appIcons={appIcons}
          deviceLabelById={deviceLabelById}
          anchorElement={focusHover.anchorElement}
          descriptionTarget={focusHover.triggerElement}
          restoreFocusOnDismiss
          actionsDisabledReason={actionsDisabledReason}
          classificationOptions={classificationOptions}
          projectOptions={projectOptions}
          canAssignProject={hasAssignProjectAction}
          canClassify={hasClassifyAction}
          onDismiss={dismissHover}
          onOpenAttribute={onOpenActivity
            ? (field: ActivityInspectorAttribute) => {
                if (field === "project" ? !hasAssignProjectAction : !hasClassifyAction) return;
                onOpenActivity(focusHover.group, focusHover.triggerElement, field);
              }
            : undefined}
          onRequestDelete={hasDeleteAction && onOpenActivity
            ? () => onOpenActivity(focusHover.group, focusHover.triggerElement, "delete")
            : undefined}
          onFocusLeave={clearFocusHover}
        />
      ) : null}
    </>
  );
}
