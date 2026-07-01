import { shiftIsoDate, type ActivitySegment } from "@drifty/domain";
import { formatDayLabel, formatDuration, formatTimeLabel } from "../../lib/formatting";
import type { DemoDashboardReplayKind, DemoDashboardReplayPhase } from "./demoDashboardReplay";
import type { DashboardDemoReplayControllerState } from "./useDashboardDemoReplayController";

export type DashboardDemoReplaySidebarCard = {
  readonly controlState: "replay";
  readonly indicatorClassName: "idle" | "tracking";
  readonly collapsedLabel: string;
  readonly statusLabel: string;
  readonly appLabel: string;
  readonly siteLabel: string | null;
  readonly metaLabel: string;
  readonly actionLabel: string;
};

type DashboardDemoReplaySidebarCardInput = {
  readonly replayState: DashboardDemoReplayControllerState;
  readonly segments: readonly ActivitySegment[];
  readonly currentDay: string;
  readonly currentMinuteOfDay: number | null;
  readonly startOfDayMinutes: number;
};

export function buildDashboardDemoReplaySidebarCard(
  input: DashboardDemoReplaySidebarCardInput,
): DashboardDemoReplaySidebarCard | null {
  if (input.replayState.kind !== "active") return null;

  const replayKindLabel = labelForReplayKind(input.replayState.replayKind);
  const phaseLabel = labelForReplayPhase(input.replayState.phase);
  const totalSeconds = input.segments.reduce((total, segment) => total + segment.durationSeconds, 0);
  const currentSegment = selectReplayActivitySegment(input);
  const currentMinuteOfDay = input.currentMinuteOfDay ?? 0;

  return {
    controlState: "replay",
    indicatorClassName: input.replayState.phase === "playing" ? "tracking" : "idle",
    collapsedLabel: input.replayState.phase === "playing" ? "Replay running" : "Replay paused",
    statusLabel: `${phaseLabel} ${replayKindLabel} · ${formatDuration(totalSeconds)}`,
    appLabel: currentSegment?.appName ?? "No replay activity",
    siteLabel: currentSegment?.siteDomain ?? currentSegment?.siteTitle ?? null,
    metaLabel: metaLabelForReplayKind({
      currentDay: input.currentDay,
      currentMinuteOfDay,
      replayKind: input.replayState.replayKind,
      startOfDayMinutes: input.startOfDayMinutes,
    }),
    actionLabel: "Stop replay",
  };
}

function selectReplayActivitySegment(input: DashboardDemoReplaySidebarCardInput): ActivitySegment | null {
  const sourceSegments = input.replayState.kind === "active" ? input.replayState.fixture.segments : [];
  const visibleSegment = input.segments[input.segments.length - 1] ?? null;
  if (sourceSegments.length === 0) return visibleSegment;
  if (input.currentMinuteOfDay === null) return visibleSegment ?? sourceSegments[0] ?? null;

  const virtualNowMs = clockMinuteTimestampMs(input.currentDay, input.currentMinuteOfDay, input.startOfDayMinutes);
  const activeSegment = sourceSegments.find((segment) => segmentContainsTime(segment, virtualNowMs)) ?? null;
  if (activeSegment) return activeSegment;

  const lastVisibleSourceSegment = lastSegmentEndingBeforeOrAt(sourceSegments, virtualNowMs);
  if (lastVisibleSourceSegment) return lastVisibleSourceSegment;

  return sourceSegments.find((segment) => segmentStartsAfterOrAt(segment, virtualNowMs)) ?? visibleSegment;
}

function lastSegmentEndingBeforeOrAt(segments: readonly ActivitySegment[], timestampMs: number): ActivitySegment | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment && segmentEndsBeforeOrAt(segment, timestampMs)) return segment;
  }
  return null;
}

function segmentContainsTime(segment: ActivitySegment, timestampMs: number): boolean {
  const startedAtMs = new Date(segment.startedAt).getTime();
  const endedAtMs = new Date(segment.endedAt).getTime();
  return Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) && startedAtMs <= timestampMs && timestampMs < endedAtMs;
}

function segmentEndsBeforeOrAt(segment: ActivitySegment, timestampMs: number): boolean {
  const endedAtMs = new Date(segment.endedAt).getTime();
  return Number.isFinite(endedAtMs) && endedAtMs <= timestampMs;
}

function segmentStartsAfterOrAt(segment: ActivitySegment, timestampMs: number): boolean {
  const startedAtMs = new Date(segment.startedAt).getTime();
  return Number.isFinite(startedAtMs) && startedAtMs >= timestampMs;
}

type ReplayTimeMetaInput = {
  readonly replayKind: DemoDashboardReplayKind;
  readonly currentDay: string;
  readonly currentMinuteOfDay: number;
  readonly startOfDayMinutes: number;
};

function metaLabelForReplayKind(input: ReplayTimeMetaInput): string {
  const calendarDay = calendarDayForClockMinute(input.currentDay, input.currentMinuteOfDay, input.startOfDayMinutes);
  const timeLabel = formatTimeLabel(new Date(clockMinuteTimestampMs(input.currentDay, input.currentMinuteOfDay, input.startOfDayMinutes)));
  switch (input.replayKind) {
    case "day":
      return `Replay time: ${timeLabel}`;
    case "week":
      return `Replay time: ${formatDayLabel(calendarDay)} ${timeLabel}`;
    default:
      return assertNever(input.replayKind);
  }
}

function clockMinuteTimestampMs(currentDay: string, minuteOfDay: number, startOfDayMinutes: number): number {
  const calendarDay = calendarDayForClockMinute(currentDay, minuteOfDay, startOfDayMinutes);
  const calendarStartMs = new Date(`${calendarDay}T00:00:00`).getTime();
  return calendarStartMs + minuteOfDay * 60 * 1000;
}

function calendarDayForClockMinute(currentDay: string, minuteOfDay: number, startOfDayMinutes: number): string {
  return minuteOfDay < startOfDayMinutes ? shiftIsoDate(currentDay, 1) : currentDay;
}

function labelForReplayKind(replayKind: DemoDashboardReplayKind): string {
  switch (replayKind) {
    case "day":
      return "day";
    case "week":
      return "week";
    default:
      return assertNever(replayKind);
  }
}

function labelForReplayPhase(phase: Exclude<DemoDashboardReplayPhase, "idle">): string {
  switch (phase) {
    case "pre_roll":
      return "Preparing";
    case "playing":
      return "Replaying";
    case "complete":
      return "Replay complete";
    default:
      return assertNever(phase);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected dashboard replay sidebar card value: ${String(value)}`);
}
