import {
  logicalDayEndExclusiveMs,
  logicalDayStartMs,
  type ActivitySegment,
} from "@drifty/domain";
import { formatLocalDateTime } from "../../lib/formatting";
import type {
  DemoDashboardReplayAnchor,
  DemoDashboardReplayFixture,
  DemoDashboardReplayKind,
} from "./demoDashboardReplay";

type ReplayRange = {
  readonly startMs: number;
  readonly endExclusiveMs: number;
};

export type SelectedDashboardReplayAnchorInput = {
  readonly kind: DemoDashboardReplayKind;
  readonly anchorDay: string;
  readonly startDay: string;
  readonly endDay: string;
  readonly startOfDayMinutes: number;
};

export type DashboardReplaySegmentSource = {
  readonly anchor: DemoDashboardReplayAnchor;
  readonly segments: readonly ActivitySegment[];
};

export function buildSelectedDashboardReplayAnchor(input: SelectedDashboardReplayAnchorInput): DemoDashboardReplayAnchor {
  return {
    kind: input.kind,
    anchorDay: input.anchorDay,
    startDay: input.startDay,
    endDay: input.endDay,
    rangeStart: formatLocalDateTime(logicalDayStartMs(input.startDay, input.startOfDayMinutes)),
    rangeEnd: formatLocalDateTime(logicalDayEndExclusiveMs(input.endDay, input.startOfDayMinutes) - 1000),
    startOfDayMinutes: input.startOfDayMinutes,
  };
}

export function buildDashboardReplayFixtureFromSegments(source: DashboardReplaySegmentSource): DemoDashboardReplayFixture {
  const range = replayRange(source.anchor);
  const segments = range
    ? source.segments.flatMap((segment) => clampSegmentToReplayRange(segment, range)).sort(compareActivitySegments)
    : [];

  return {
    kind: source.anchor.kind,
    anchor: source.anchor,
    segments,
    totalSeconds: segments.reduce((total, segment) => total + segment.durationSeconds, 0),
  };
}

function clampSegmentToReplayRange(segment: ActivitySegment, range: ReplayRange): ActivitySegment[] {
  const startedAtMs = new Date(segment.startedAt).getTime();
  const endedAtMs = new Date(segment.endedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs <= startedAtMs) return [];

  const replayStartedAtMs = Math.max(startedAtMs, range.startMs);
  const replayEndedAtMs = Math.min(endedAtMs, range.endExclusiveMs);
  if (replayEndedAtMs <= replayStartedAtMs) return [];

  return [{
    ...segment,
    startedAt: formatLocalDateTime(replayStartedAtMs),
    endedAt: formatLocalDateTime(replayEndedAtMs),
    durationSeconds: Math.round((replayEndedAtMs - replayStartedAtMs) / 1000),
  }];
}

function compareActivitySegments(left: ActivitySegment, right: ActivitySegment): number {
  const leftStartedAtMs = new Date(left.startedAt).getTime();
  const rightStartedAtMs = new Date(right.startedAt).getTime();
  if (leftStartedAtMs !== rightStartedAtMs) return leftStartedAtMs - rightStartedAtMs;
  return left.id.localeCompare(right.id);
}

function replayRange(anchor: DemoDashboardReplayAnchor): ReplayRange | null {
  const startMs = logicalDayStartMs(anchor.startDay, anchor.startOfDayMinutes);
  const endExclusiveMs = logicalDayEndExclusiveMs(anchor.endDay, anchor.startOfDayMinutes);
  if (!Number.isFinite(startMs) || !Number.isFinite(endExclusiveMs) || endExclusiveMs <= startMs) return null;
  return { startMs, endExclusiveMs };
}
