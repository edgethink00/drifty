import { classifyActivity } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import type { DriftAlarmInteraction } from "../companion/driftAlarmRecoveryTypes";

/** How long after an alarm we still count a return to focus. */
export const FOLLOW_THROUGH_WINDOW_MINUTES = 30;
/** A focus run must last at least this long to count as a real return. */
export const FOLLOW_THROUGH_MIN_FOCUS_MINUTES = 10;
/** Adjacent focus segments closer than this belong to the same run. */
const FOCUS_RUN_GAP_MS = 5 * 60 * 1000;

export type AlarmFollowThroughPath = "afterBreak" | "returned" | "onOwn" | "noReturn";

export type AlarmFollowThrough = {
  readonly totalAlarms: number;
  readonly recoveredAlarms: number;
  /** null when no alarm fired in the window. */
  readonly rate: number | null;
  /** Median minutes from alarm to a qualifying focus run; null without recoveries. */
  readonly medianMinutesToFocus: number | null;
  readonly pathCounts: Readonly<Record<AlarmFollowThroughPath, number>>;
};

type FocusRun = { readonly startMs: number; readonly durationMs: number };

export const EMPTY_ALARM_FOLLOW_THROUGH: AlarmFollowThrough = {
  totalAlarms: 0,
  recoveredAlarms: 0,
  rate: null,
  medianMinutesToFocus: null,
  pathCounts: { afterBreak: 0, returned: 0, onOwn: 0, noReturn: 0 },
};

function buildFocusRuns(segments: readonly ActivitySegment[], options: ClassificationOptions): FocusRun[] {
  const focusSegments = segments
    .filter((segment) => Number.isFinite(segment.durationSeconds) && segment.durationSeconds > 0)
    .map((segment) => ({ segment, startMs: new Date(segment.startedAt).getTime() }))
    .filter((entry) => !Number.isNaN(entry.startMs) && classifyActivity(entry.segment, options).productivity === "focus")
    .sort((left, right) => left.startMs - right.startMs);

  const runs: { startMs: number; endMs: number }[] = [];
  for (const { segment, startMs } of focusSegments) {
    const endMs = startMs + segment.durationSeconds * 1000;
    const previous = runs[runs.length - 1];
    if (previous && startMs - previous.endMs <= FOCUS_RUN_GAP_MS) {
      previous.endMs = Math.max(previous.endMs, endMs);
      continue;
    }
    runs.push({ startMs, endMs });
  }
  return runs.map((run) => ({ startMs: run.startMs, durationMs: run.endMs - run.startMs }));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value);
}

/**
 * Did the drift end after Drifty interrupted?
 *
 * Every alarm shown in the window counts, not only the ones where the user
 * chose to take a break, so the rate covers people who dismiss alarms as well.
 * Recovery is read back from classified activity with one method for every
 * alarm, which keeps the four paths comparable. The path records what the user
 * did before returning; it is not a claim that the alarm caused the return.
 */
export function buildAlarmFollowThrough({
  interactions,
  segments,
  classificationOptions,
  rangeStart,
  rangeEnd,
}: {
  readonly interactions: readonly DriftAlarmInteraction[];
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly rangeStart: string;
  readonly rangeEnd: string;
}): AlarmFollowThrough {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();
  if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs)) return EMPTY_ALARM_FOLLOW_THROUGH;

  const alarms = interactions
    .filter((interaction) => interaction.kind === "shown")
    .map((interaction) => ({ alarmId: interaction.alarmId, shownMs: new Date(interaction.shownAt).getTime() }))
    .filter((alarm) => !Number.isNaN(alarm.shownMs) && alarm.shownMs >= rangeStartMs && alarm.shownMs <= rangeEndMs)
    .sort((left, right) => left.shownMs - right.shownMs);

  if (alarms.length === 0) return EMPTY_ALARM_FOLLOW_THROUGH;

  const actionsByAlarm = new Map<string, Set<string>>();
  for (const interaction of interactions) {
    if (interaction.kind !== "action") continue;
    const actedMs = new Date(interaction.actedAt).getTime();
    if (Number.isNaN(actedMs)) continue;
    const bucket = actionsByAlarm.get(interaction.alarmId) ?? new Set<string>();
    bucket.add(interaction.action);
    actionsByAlarm.set(interaction.alarmId, bucket);
  }

  const runs = buildFocusRuns(segments, classificationOptions);
  const windowMs = FOLLOW_THROUGH_WINDOW_MINUTES * 60 * 1000;
  const minFocusMs = FOLLOW_THROUGH_MIN_FOCUS_MINUTES * 60 * 1000;

  const pathCounts: Record<AlarmFollowThroughPath, number> = { afterBreak: 0, returned: 0, onOwn: 0, noReturn: 0 };
  const minutesToFocus: number[] = [];

  for (const alarm of alarms) {
    const run = runs.find((candidate) =>
      candidate.startMs >= alarm.shownMs
      && candidate.startMs <= alarm.shownMs + windowMs
      && candidate.durationMs >= minFocusMs);

    if (!run) {
      pathCounts.noReturn += 1;
      continue;
    }

    minutesToFocus.push((run.startMs - alarm.shownMs) / 60000);
    const actions = actionsByAlarm.get(alarm.alarmId);
    if (actions?.has("start_break")) pathCounts.afterBreak += 1;
    else if (actions?.has("return_to_focus")) pathCounts.returned += 1;
    else pathCounts.onOwn += 1;
  }

  const recoveredAlarms = pathCounts.afterBreak + pathCounts.returned + pathCounts.onOwn;

  return {
    totalAlarms: alarms.length,
    recoveredAlarms,
    rate: recoveredAlarms / alarms.length,
    medianMinutesToFocus: median(minutesToFocus),
    pathCounts,
  };
}
