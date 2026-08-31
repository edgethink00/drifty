import { logicalMinuteOfDay, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";

const MINUTES_PER_DAY = 24 * 60;

export type FlowBlockHoverGroup = {
  readonly block: FlowBlock;
  readonly blocks: readonly FlowBlock[];
  readonly segmentIds: readonly string[];
  readonly startMinuteOfDay: number;
  readonly endMinuteOfDay: number;
  readonly durationSeconds: number;
};

type MutableFlowBlockHoverGroup = {
  block: FlowBlock;
  blocks: FlowBlock[];
  segmentIds: Set<string>;
  identityKey: string;
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  durationSeconds: number;
};

function blockIdentityKey(block: FlowBlock): string {
  const activityKey = block.siteDomain
    ? `site:${block.siteDomain}`
    : block.siteTitle
      ? `title:${block.siteTitle}`
      : block.bundleId
        ? `bundle:${block.bundleId}`
        : `app:${block.appName}`;
  return `${block.day}|${block.category}|${block.productivity}|${activityKey}`;
}

function blockEndMinute(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): number {
  return (block.minuteOfDay + intervalMinutes) % MINUTES_PER_DAY;
}

function isAdjacentFlowBlock(left: FlowBlock, right: FlowBlock, intervalMinutes: FlowIntervalMinutes, startOfDayMinutes: number): boolean {
  const leftLogicalMinute = logicalMinuteOfDay(left.minuteOfDay, startOfDayMinutes);
  const rightLogicalMinute = logicalMinuteOfDay(right.minuteOfDay, startOfDayMinutes);
  return rightLogicalMinute - leftLogicalMinute === intervalMinutes;
}

function startGroup(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): MutableFlowBlockHoverGroup {
  return {
    block,
    blocks: [block],
    segmentIds: new Set(block.sourceSegmentIds ?? []),
    identityKey: blockIdentityKey(block),
    startMinuteOfDay: block.minuteOfDay,
    endMinuteOfDay: blockEndMinute(block, intervalMinutes),
    durationSeconds: block.durationSeconds,
  };
}

function finishGroup(group: MutableFlowBlockHoverGroup, target: Map<number, FlowBlockHoverGroup>): void {
  const hoverGroup: FlowBlockHoverGroup = {
    block: group.block,
    blocks: [...group.blocks],
    segmentIds: [...group.segmentIds],
    startMinuteOfDay: group.startMinuteOfDay,
    endMinuteOfDay: group.endMinuteOfDay,
    durationSeconds: group.durationSeconds,
  };
  for (const block of group.blocks) target.set(block.minuteOfDay, hoverGroup);
}

export function buildFlowBlockHoverGroups(blocks: readonly FlowBlock[], intervalMinutes: FlowIntervalMinutes, startOfDayMinutes: number): Map<number, FlowBlockHoverGroup> {
  const groupsByMinute = new Map<number, FlowBlockHoverGroup>();
  const sortedBlocks = [...blocks].sort((left, right) => logicalMinuteOfDay(left.minuteOfDay, startOfDayMinutes) - logicalMinuteOfDay(right.minuteOfDay, startOfDayMinutes));
  let currentGroup: MutableFlowBlockHoverGroup | null = null;

  for (const block of sortedBlocks) {
    if (
      currentGroup === null ||
      currentGroup.identityKey !== blockIdentityKey(block) ||
      !isAdjacentFlowBlock(currentGroup.blocks[currentGroup.blocks.length - 1], block, intervalMinutes, startOfDayMinutes)
    ) {
      if (currentGroup !== null) finishGroup(currentGroup, groupsByMinute);
      currentGroup = startGroup(block, intervalMinutes);
      continue;
    }

    currentGroup.blocks.push(block);
    for (const segmentId of block.sourceSegmentIds ?? []) currentGroup.segmentIds.add(segmentId);
    currentGroup.endMinuteOfDay = blockEndMinute(block, intervalMinutes);
    currentGroup.durationSeconds += block.durationSeconds;
  }

  if (currentGroup !== null) finishGroup(currentGroup, groupsByMinute);

  return groupsByMinute;
}
