import { logicalMinuteOfDay, type ActivitySegment, type FlowBlock, type FlowBlockContribution, type FlowIntervalMinutes } from "@drifty/domain";

const MINUTES_PER_DAY = 24 * 60;

/** One app/site's accumulated share across every cell in a hover group. */
export type FlowHoverGroupContribution = {
  readonly id: string;
  readonly label: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly browserName: string | null;
  readonly siteDomain: string | null;
  readonly siteTitle: string | null;
  readonly category: FlowBlockContribution["category"];
  readonly productivity: FlowBlockContribution["productivity"];
  readonly durationSeconds: number;
  readonly isWinner: boolean;
};

export type FlowBlockHoverGroup = {
  readonly block: FlowBlock;
  readonly blocks: readonly FlowBlock[];
  readonly segmentIds: readonly string[];
  /** All displayed contributions; editing still targets segmentIds only. */
  readonly displaySegmentIds?: readonly string[];
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
  return `${block.day}|${block.category}|${block.productivity}|${activityIdentityKey(block)}`;
}

function activityIdentityKey(block: Pick<FlowBlock, "siteDomain" | "siteTitle" | "bundleId" | "appName">): string {
  return block.siteDomain
    ? `site:${block.siteDomain}`
    : block.siteTitle
      ? `title:${block.siteTitle}`
      : block.bundleId
        ? `bundle:${block.bundleId}`
        : `app:${block.appName}`;
}

// Sums each cell's composition across the whole hover group so the inspector can list
// what actually filled the highlighted range: the painted winner first, then every
// runner-up that shares the cells but never gets its own color.
export function buildFlowHoverGroupContributions(group: FlowBlockHoverGroup): FlowHoverGroupContribution[] {
  const winnerKey = activityIdentityKey(group.block);
  const totals = new Map<string, { contribution: FlowHoverGroupContribution; order: number }>();
  let order = 0;
  for (const block of group.blocks) {
    const composition = block.composition ?? [{
      colorKey: block.colorKey,
      appName: block.appName,
      bundleId: block.bundleId ?? null,
      browserName: block.browserName ?? null,
      siteDomain: block.siteDomain ?? null,
      siteTitle: block.siteTitle ?? null,
      category: block.category,
      productivity: block.productivity,
      durationSeconds: block.durationSeconds,
      sourceSegmentIds: block.sourceSegmentIds ?? [],
    }];
    for (const entry of composition) {
      const id = activityIdentityKey(entry);
      const existing = totals.get(id);
      if (existing) {
        existing.contribution = { ...existing.contribution, durationSeconds: existing.contribution.durationSeconds + entry.durationSeconds };
        continue;
      }
      totals.set(id, {
        order: order++,
        contribution: {
          id,
          label: entry.siteDomain ?? entry.siteTitle ?? entry.appName,
          appName: entry.appName,
          bundleId: entry.bundleId,
          browserName: entry.browserName,
          siteDomain: entry.siteDomain,
          siteTitle: entry.siteTitle,
          category: entry.category,
          productivity: entry.productivity,
          durationSeconds: entry.durationSeconds,
          isWinner: id === winnerKey,
        },
      });
    }
  }
  return [...totals.values()]
    .sort((left, right) =>
      Number(right.contribution.isWinner) - Number(left.contribution.isWinner)
      || right.contribution.durationSeconds - left.contribution.durationSeconds
      || left.order - right.order)
    .map((entry) => entry.contribution);
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

function finishGroup(group: MutableFlowBlockHoverGroup, target: Map<number, FlowBlockHoverGroup>, segmentsById?: ReadonlyMap<string, ActivitySegment>): void {
  const displaySegmentIds = [...new Set(group.blocks.flatMap((block) =>
    block.composition?.flatMap((entry) => entry.sourceSegmentIds) ?? block.sourceSegmentIds ?? []))];
  const hasRemoteContribution = displaySegmentIds.some((id) => segmentsById?.get(id)?.deviceId)
    || group.blocks.some((block) => block.deviceId);
  const hoverGroup: FlowBlockHoverGroup = {
    block: group.block,
    blocks: [...group.blocks],
    segmentIds: [...group.segmentIds],
    displaySegmentIds,
    startMinuteOfDay: group.startMinuteOfDay,
    endMinuteOfDay: group.endMinuteOfDay,
    durationSeconds: hasRemoteContribution
      ? group.blocks.reduce((total, block) => total + (block.composition
        ? block.composition.reduce((sum, entry) => sum + entry.durationSeconds, 0)
        : block.durationSeconds), 0)
      : group.durationSeconds,
  };
  for (const block of group.blocks) target.set(block.minuteOfDay, hoverGroup);
}

export function buildFlowBlockHoverGroups(blocks: readonly FlowBlock[], intervalMinutes: FlowIntervalMinutes, startOfDayMinutes: number, segmentsById?: ReadonlyMap<string, ActivitySegment>): Map<number, FlowBlockHoverGroup> {
  const groupsByMinute = new Map<number, FlowBlockHoverGroup>();
  const sortedBlocks = [...blocks].sort((left, right) => logicalMinuteOfDay(left.minuteOfDay, startOfDayMinutes) - logicalMinuteOfDay(right.minuteOfDay, startOfDayMinutes));
  let currentGroup: MutableFlowBlockHoverGroup | null = null;

  for (const block of sortedBlocks) {
    if (
      currentGroup === null ||
      currentGroup.identityKey !== blockIdentityKey(block) ||
      !isAdjacentFlowBlock(currentGroup.blocks[currentGroup.blocks.length - 1], block, intervalMinutes, startOfDayMinutes)
    ) {
      if (currentGroup !== null) finishGroup(currentGroup, groupsByMinute, segmentsById);
      currentGroup = startGroup(block, intervalMinutes);
      continue;
    }

    currentGroup.blocks.push(block);
    for (const segmentId of block.sourceSegmentIds ?? []) currentGroup.segmentIds.add(segmentId);
    currentGroup.endMinuteOfDay = blockEndMinute(block, intervalMinutes);
    currentGroup.durationSeconds += block.durationSeconds;
  }

  if (currentGroup !== null) finishGroup(currentGroup, groupsByMinute, segmentsById);

  return groupsByMinute;
}
