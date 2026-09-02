import { useState } from "react";
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
import type { FlowBlockHoverGroup } from "./flowHoverGroups";
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
    identities: [{
      id: identityId,
      label: displayName,
      appName: block.appName,
      bundleId: block.bundleId ?? null,
      siteDomain: block.siteDomain ?? null,
    }],
    hasMixedCategory: false,
    hasMixedProductivity: false,
    hasMixedProject: projectWeights.size > 1,
    detailLabel: blockDetailLabel(block),
    durationSeconds: group.durationSeconds,
  };
}

// Main activity previews and their pinned inspector share the same block anchor
// and card surface. While pinned, the hover state is disabled but the selected
// group highlight remains in the grid as the visual tether to the card.
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
  const { cancelPointerClear, schedulePointerClear, clearFocusHover, dismissHover } = useFlowChartHoverDelegation({
    gridElement,
    hoverGroupsByCell,
    setHoveredBlock,
    disabled,
  });
  const highlightedGroup = disabled ? pinnedGroup : hoveredBlock?.group ?? null;
  const previewEvent = hoveredBlock
    ? buildFlowActivityInspectorEvent(hoveredBlock.group, { projectsById })
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
      {!disabled && hoveredBlock ? (
        <ActivityInspectorPreview
          event={previewEvent!}
          segments={previewSegments}
          appIcons={appIcons}
          deviceLabelById={deviceLabelById}
          anchorElement={hoveredBlock.anchorElement}
          descriptionTarget={hoveredBlock.triggerElement}
          restoreFocusOnDismiss={hoveredBlock.trigger === "focus"}
          actionsDisabledReason={actionsDisabledReason}
          classificationOptions={classificationOptions}
          projectOptions={projectOptions}
          canAssignProject={hasAssignProjectAction}
          canClassify={hasClassifyAction}
          onDismiss={dismissHover}
          onOpenAttribute={onOpenActivity
            ? (field: ActivityInspectorAttribute) => {
                if (field === "project" ? !hasAssignProjectAction : !hasClassifyAction) return;
                onOpenActivity(hoveredBlock.group, hoveredBlock.triggerElement, field);
              }
            : undefined}
          onRequestDelete={hasDeleteAction && onOpenActivity
            ? () => onOpenActivity(hoveredBlock.group, hoveredBlock.triggerElement, "delete")
            : undefined}
          onPointerEnter={cancelPointerClear}
          onPointerLeave={schedulePointerClear}
          onFocusEnter={cancelPointerClear}
          onFocusLeave={clearFocusHover}
        />
      ) : null}
    </>
  );
}
