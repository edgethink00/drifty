import { logicalMinuteOfDay, type FlowBlock } from "@drifty/domain";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";

/**
 * The chart cells a Day activity card covers, as one highlight group: the cells inside the card's
 * time that hold its records. A card opened from the activity lane edits all of the card's
 * records, so the panel lights all of its cells rather than the one run it was opened through.
 */
export function laneCardFlowGroup(
  card: { readonly topMinutes: number; readonly durationMinutes: number; readonly segmentIds: readonly string[] },
  blocks: readonly FlowBlock[],
  intervalMinutes: number,
  boundaryMinutes: number,
): FlowBlockHoverGroup | null {
  const ids = new Set(card.segmentIds);
  const end = card.topMinutes + card.durationMinutes;
  const inside = blocks
    .filter((block) => {
      const minute = logicalMinuteOfDay(block.minuteOfDay, boundaryMinutes);
      return minute + intervalMinutes > card.topMinutes && minute < end
        && (block.sourceSegmentIds ?? []).some((id) => ids.has(id));
    })
    .sort((a, b) => logicalMinuteOfDay(a.minuteOfDay, boundaryMinutes) - logicalMinuteOfDay(b.minuteOfDay, boundaryMinutes));
  if (inside.length === 0) return null;
  const first = inside[0];
  const last = inside[inside.length - 1];
  return {
    block: [...inside].sort((a, b) => b.durationSeconds - a.durationSeconds)[0],
    blocks: inside,
    segmentIds: [...ids],
    displaySegmentIds: [...ids],
    startMinuteOfDay: first.minuteOfDay,
    endMinuteOfDay: (last.minuteOfDay + intervalMinutes) % 1440,
    durationSeconds: inside.reduce((sum, block) => sum + block.durationSeconds, 0),
  };
}

