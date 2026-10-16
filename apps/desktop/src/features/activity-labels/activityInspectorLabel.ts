import { logicalMinuteOfDay } from "@drifty/domain";
import type { ActivityLabelBlock, ActivityLabelDisplay } from "./activityLabelBlocks";
import type { ActivityLabelsController } from "./useActivityBlockLabels";

/** What the hover card and the pinned editor show for one block. */
export type ActivityInspectorLabel = {
  readonly block: ActivityLabelBlock;
  /** Null keeps the app/site text: no name yet, too little evidence, or the user cleared it. */
  readonly display: ActivityLabelDisplay | null;
  /** "range": the card covers part of the block (Day view), so editing names the block's time. */
  readonly scope: "block" | "range";
  /** Week: every canonical block a merged block draws as one. Hiding or
   *  showing the name applies to all of them, so it cannot move to another piece. */
  readonly members?: readonly ActivityLabelBlock[];
};

function labelFromBlock(block: ActivityLabelBlock | null, scope: ActivityInspectorLabel["scope"]): ActivityInspectorLabel | null {
  if (!block) return null;
  return { block, display: block.display, scope };
}

export function activityLabelForWeekEvent(
  controller: ActivityLabelsController | null,
  day: string | null | undefined,
  segmentIds: readonly string[],
): ActivityInspectorLabel | null {
  if (!controller || !day) return null;
  return labelFromBlock(controller.index.forSegments(day, segmentIds), "block");
}

/** Day view: hover groups are per app/site slices of a longer work block. */
export function activityLabelForFlowRange(
  controller: ActivityLabelsController | null,
  day: string,
  startMinuteOfDay: number,
  endMinuteOfDay: number,
  startOfDayMinutes: number,
  segmentIds: readonly string[],
): ActivityInspectorLabel | null {
  if (!controller) return null;
  const start = logicalMinuteOfDay(startMinuteOfDay, startOfDayMinutes);
  const span = (endMinuteOfDay - startMinuteOfDay + 1440) % 1440 || 1440;
  const block = controller.index.forRange(day, start, start + span, segmentIds);
  if (!block) return null;
  const covers = block.startMinute >= start && block.endMinute <= start + span;
  return labelFromBlock(block, covers ? "block" : "range");
}

