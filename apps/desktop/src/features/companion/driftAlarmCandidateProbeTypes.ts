import type { SystemTransientActivity } from "@drifty/domain";
import type { DriftAlarmDebugClassificationSummary, DriftAlarmDebugSegmentSummary } from "./driftAlarmDebugLog";

export const DRIFT_ALARM_CANDIDATE_PROBE_REASONS = [
  "no_current_snapshot",
  "no_latest_segment",
  "current_snapshot_mismatch",
  "system_transient_no_candidate",
  "classification_not_drift",
  "classification_confidence_low",
  "duration_below_threshold",
  "live_ai_not_available",
  "candidate_expected",
] as const;

export type DriftAlarmCandidateProbeReason = typeof DRIFT_ALARM_CANDIDATE_PROBE_REASONS[number];

export type DriftAlarmCandidateProbeSummary = {
  readonly reason: DriftAlarmCandidateProbeReason;
  readonly latestSegment: DriftAlarmDebugSegmentSummary | null;
  readonly activeSegment: DriftAlarmDebugSegmentSummary | null;
  readonly identityMatched: boolean | null;
  readonly candidateDurationSeconds: number | null;
  readonly minimumDurationSeconds: number;
  readonly classification: DriftAlarmDebugClassificationSummary | null;
  readonly liveAiAvailable: boolean;
  readonly systemTransientActivity: SystemTransientActivity;
};
