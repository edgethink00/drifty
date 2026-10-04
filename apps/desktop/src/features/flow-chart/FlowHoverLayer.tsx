import { useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { ActivitySegment, ClassificationOptions, FlowIntervalMinutes } from "@drifty/domain";
import {
  ActivityInspectorPreview,
  resolveActivityActionsDisabledReason,
  type ActivityInspectorEvent,
  type ActivityInspectorProjectOption,
} from "../dashboard/WeekActivityInspector";
import { FlowHoverGroupHighlights } from "./FlowHoverGroupHighlights";
import { buildFlowHoverGroupContributions, type FlowBlockHoverGroup } from "./flowHoverGroups";
import type { ProjectLegendEntry } from "./projectFlowView";
import { blockDetailLabel, blockDisplayName, formatGroupTimeRange } from "./flowChartFormat";
import { useFlowChartHoverDelegation, type AnchoredFlowHoverState } from "./useFlowChartHoverDelegation";
import { useLocalization } from "../localization/LocalizationContext";
import { buildActivityDevices } from "../device-sync/deviceTimelineLabels";

const EMPTY_ACTIVITY_SEGMENTS_BY_ID = new Map<string, ActivitySegment>();
const EMPTY_ACTIVITY_INSPECTOR_PROJECT_OPTIONS: readonly ActivityInspectorProjectOption[] = [];

type FlowHoverLayerProps = {
  readonly previewAnchorRef: MutableRefObject<AnchoredFlowHoverState | null>;
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
  readonly disabled?: boolean;
  readonly pinnedGroup?: FlowBlockHoverGroup | null;
};

export function buildFlowActivityInspectorEvent(
  group: FlowBlockHoverGroup,
  options: {
    readonly projectsById?: ReadonlyMap<string, ProjectLegendEntry>;
    readonly segmentsById?: ReadonlyMap<string, ActivitySegment>;
    readonly deviceLabelById?: ReadonlyMap<string, string>;
    readonly thisDeviceLabel?: string;
    readonly syncedDeviceLabel?: string;
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
    devices: buildActivityDevices(
      (group.displaySegmentIds ?? group.segmentIds).flatMap((id) => {
        const segment = options.segmentsById?.get(id);
        return segment ? [segment] : [];
      }),
      options.deviceLabelById,
      options.thisDeviceLabel ?? "",
      options.syncedDeviceLabel ?? "",
    ),
  };
}

// Day and Week share the same anchored, read-only preview. Clicking a block
// pins the editor; preview pointer events must never cover neighboring cells.
export function FlowHoverLayer({
  previewAnchorRef,
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
  disabled = false,
  pinnedGroup = null,
}: FlowHoverLayerProps) {
  const { t } = useLocalization();
  const [hoveredBlock, setHoveredBlock] = useState<AnchoredFlowHoverState | null>(null);
  const { dismissHover } = useFlowChartHoverDelegation({
    gridElement,
    hoverGroupsByCell,
    setHoveredBlock,
    previewAnchorRef,
    disabled,
  });
  const highlightedGroup = disabled ? pinnedGroup : hoveredBlock?.group ?? null;
  const previewEvent = hoveredBlock
    ? buildFlowActivityInspectorEvent(hoveredBlock.group, {
        projectsById, segmentsById, deviceLabelById,
        thisDeviceLabel: t("dashboard.week.inspector.thisMac"),
        syncedDeviceLabel: t("dashboard.week.inspector.syncedMac"),
      })
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
          onDismiss={dismissHover}
        />
      ) : null}
    </>
  );
}
