import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import type { ActivityLabelsController } from "../activity-labels/useActivityBlockLabels";
import { arrangeWeekCardBlocks, LONE_BLOCK_SHARE, type WeekCardBlockName } from "./weekCardBlocks";
import type { WeekCalendarEvent } from "./weekCalendar";
import { buildWeekDashboardDayModel } from "./weekDashboardModel";

/**
 * The blocks Your Day's activity lane draws for one day: the Week model's blocks arranged by
 * timeline card (weekCardBlocks.ts), a short block that touches nothing kept from 40% of the short
 * bar. Shared by the lane and by the Breakdown's activity count so both count the same cards.
 */
export function buildYourDayLaneEvents({ day, segments, classificationOptions, startOfDayMinutes, activityLabels, revealSegmentId = null }: {
  readonly day: string;
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly startOfDayMinutes: number;
  readonly activityLabels: ActivityLabelsController | null;
  readonly revealSegmentId?: string | null;
}): { readonly events: readonly WeekCalendarEvent[]; readonly names: ReadonlyMap<string, WeekCardBlockName> | null } {
  const model = buildWeekDashboardDayModel({ day, segments: [...segments], classificationOptions, startOfDayMinutes });
  if (!activityLabels) return { events: model.calendarEvents, names: null };
  const arranged = arrangeWeekCardBlocks(
    new Map([[day, activityLabels.weekCalendarEvents?.get(day) ?? model.calendarEvents]]),
    activityLabels.index,
    { startOfDayMinutes, keepSegmentId: revealSegmentId, loneBlockShare: LONE_BLOCK_SHARE },
  );
  return { events: arranged.eventsByDay.get(day) ?? [], names: arranged.names };
}

