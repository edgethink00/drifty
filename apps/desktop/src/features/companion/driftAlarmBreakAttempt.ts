import { classifyActivity } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ClassificationOptions } from "@drifty/domain";
import type { DriftAlarmAction, DriftAlarmEvent } from "./DriftAlarm";
import type { DriftAlarmCandidate } from "./driftAlarmData";
import { BREAK_ASSESSMENT_WINDOW_MS } from "./driftAlarmRecoveryTypes";
import type { BreakRecoveryOutcome, DriftAlarmBreakAttempt, DriftAlarmBreakSnooze, DriftAlarmRecoverySource } from "./driftAlarmRecoveryTypes";

export function buildBreakRecoveryAttempt({
  action,
  event,
  segments,
  classificationOptions,
  startedAtMs,
}: {
  readonly action: Extract<DriftAlarmAction, { type: "start_break" }>;
  readonly event: DriftAlarmEvent;
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions?: ClassificationOptions;
  readonly startedAtMs: number;
}): DriftAlarmBreakAttempt {
  const breakEndsAtMs = startedAtMs + action.minutes * 60_000;
  return {
    attemptId: `${event.id}:${action.minutes}:${startedAtMs}`,
    alarmId: event.id,
    mode: event.mode,
    minutes: action.minutes,
    breakStartedAt: new Date(startedAtMs).toISOString(),
    breakEndsAt: new Date(breakEndsAtMs).toISOString(),
    assessmentEndsAt: new Date(breakEndsAtMs + BREAK_ASSESSMENT_WINDOW_MS).toISOString(),
    source: resolveAlarmSource(event, segments, classificationOptions),
  };
}

export function buildBreakSnooze({
  attempt,
  event,
}: {
  readonly attempt: DriftAlarmBreakAttempt;
  readonly event: DriftAlarmEvent;
}): DriftAlarmBreakSnooze {
  return {
    ...attempt,
    untilMs: new Date(attempt.breakEndsAt).getTime(),
    pausedFromLabel: event.mode === "break_return" ? event.breakReturn.pausedFromLabel : event.contextLabel || "This drift",
    focusTargets: event.focusTargets,
  };
}

export function resolveBreakRecoveryOutcome({
  attempt,
  driftCandidate,
  nowMs,
}: {
  readonly attempt: DriftAlarmBreakAttempt;
  readonly driftCandidate: DriftAlarmCandidate | null;
  readonly nowMs: number;
}): BreakRecoveryOutcome | null {
  if (driftCandidate) {
    const driftSource = sourceFromSegment(driftCandidate.segment, driftCandidate.category);
    return sourcesMatch(attempt.source, driftSource) ? "same_drift_continued" : "drift_shifted";
  }

  const assessmentEndsAtMs = new Date(attempt.assessmentEndsAt).getTime();
  return nowMs >= assessmentEndsAtMs ? "recovered" : null;
}

function resolveAlarmSource(event: DriftAlarmEvent, segments: readonly ActivitySegment[], classificationOptions?: ClassificationOptions): DriftAlarmRecoverySource {
  const sourceSegmentId = event.sourceSegmentId?.trim() ?? "";
  const sourceSegment = sourceSegmentId ? segments.find((segment) => segment.id === sourceSegmentId) ?? null : null;
  if (sourceSegment) return sourceFromSegment(sourceSegment, classifyActivity(sourceSegment, classificationOptions).category);
  const label = event.contextLabel.trim() || "This drift";
  return { kind: "context", key: normalizeSourceKey(label), label, category: null };
}

function sourceFromSegment(segment: ActivitySegment, category: ActivityCategory): DriftAlarmRecoverySource {
  const siteDomain = segment.siteDomain?.trim() ?? "";
  if (siteDomain) return { kind: "site", key: normalizeSourceKey(siteDomain), label: siteDomain, category };
  const appName = segment.appName.trim() || "Unknown app";
  const bundleId = segment.bundleId?.trim() ?? "";
  return { kind: "app", key: normalizeSourceKey(bundleId || appName), label: appName, category };
}

function normalizeSourceKey(value: string): string {
  return value.trim().toLowerCase();
}

function sourcesMatch(left: DriftAlarmRecoverySource, right: DriftAlarmRecoverySource): boolean {
  return left.key.length > 0 && left.key === right.key;
}
