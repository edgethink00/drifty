import { classifyActivityDetailed } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions, CurrentActivitySnapshot, SystemTransientActivity } from "@drifty/domain";
import { getActiveDriftAlarmSegment } from "./driftAlarmCurrentSegment";
import type { DriftAlarmCandidateProbeReason, DriftAlarmCandidateProbeSummary } from "./driftAlarmCandidateProbeTypes";
import { AI_DRIFT_ALARM_MINIMUM_CONFIDENCE } from "./driftAlarmData";
import {
  type DriftAlarmDebugClassificationSummary,
  type DriftAlarmDebugSegmentSummary,
  summarizeDriftAlarmSegment,
} from "./driftAlarmDebugLog";
import { segmentForLiveDriftAlarmClassification } from "./liveDriftAlarmClassification";
import { activitySegmentIdentity, currentSnapshotIdentity, getLatestWatcherSegment } from "./watcherData";

export type DriftAlarmCandidateProbeInput = {
  readonly segments: readonly ActivitySegment[];
  readonly currentSnapshot: CurrentActivitySnapshot | null;
  readonly classificationOptions: ClassificationOptions;
  readonly minimumDurationSeconds: number;
  readonly liveAiAvailable: boolean;
  readonly systemTransientActivity: SystemTransientActivity;
};

export function buildDriftAlarmCandidateProbe(input: DriftAlarmCandidateProbeInput): DriftAlarmCandidateProbeSummary {
  const latestSegment = getLatestWatcherSegment([...input.segments]);
  const base = {
    latestSegment: latestSegment ? summarizeDriftAlarmSegment(latestSegment, latestSegment.id) : null,
    minimumDurationSeconds: input.minimumDurationSeconds,
    liveAiAvailable: input.liveAiAvailable,
    systemTransientActivity: input.systemTransientActivity,
  };
  if (!input.currentSnapshot) {
    return candidateProbe({ ...base, reason: "no_current_snapshot", identityMatched: null });
  }
  if (!latestSegment) {
    return candidateProbe({ ...base, reason: "no_latest_segment", identityMatched: null });
  }

  const identityMatched = activitySegmentIdentity(latestSegment) === currentSnapshotIdentity(input.currentSnapshot);
  const activeSegment = getActiveDriftAlarmSegment(input.currentSnapshot, input.segments);
  if (!activeSegment) {
    return candidateProbe({ ...base, reason: "current_snapshot_mismatch", identityMatched });
  }

  const classificationSegment = segmentForLiveDriftAlarmClassification(activeSegment.segment, input.segments);
  const classification = classifyActivityDetailed(classificationSegment, input.classificationOptions);
  const activeSummary = summarizeDriftAlarmSegment(activeSegment.segment, activeSegment.sourceSegmentId);
  const classificationSummary = summarizeProbeClassification(classification);
  if (activeSegment.segment.durationSeconds < input.minimumDurationSeconds) {
    return candidateProbe({ ...base, reason: "duration_below_threshold", activeSegment: activeSummary, identityMatched, classification: classificationSummary });
  }
  if (classification.productivity === "drift" && classification.source === "llm" && classification.confidence < AI_DRIFT_ALARM_MINIMUM_CONFIDENCE) {
    return candidateProbe({ ...base, reason: "classification_confidence_low", activeSegment: activeSummary, identityMatched, classification: classificationSummary });
  }
  if (classification.productivity !== "drift") {
    const reason = liveAiReason(classification.category === "unknown", input.liveAiAvailable);
    return candidateProbe({ ...base, reason, activeSegment: activeSummary, identityMatched, classification: classificationSummary });
  }
  if (input.systemTransientActivity) {
    return candidateProbe({ ...base, reason: "system_transient_no_candidate", activeSegment: activeSummary, identityMatched, classification: classificationSummary });
  }
  return candidateProbe({ ...base, reason: "candidate_expected", activeSegment: activeSummary, identityMatched, classification: classificationSummary });
}

function liveAiReason(isUnknown: boolean, liveAiAvailable: boolean): DriftAlarmCandidateProbeReason {
  if (!isUnknown) return "classification_not_drift";
  return liveAiAvailable ? "candidate_expected" : "live_ai_not_available";
}

function candidateProbe(input: {
  readonly reason: DriftAlarmCandidateProbeReason;
  readonly latestSegment: DriftAlarmDebugSegmentSummary | null;
  readonly activeSegment?: DriftAlarmDebugSegmentSummary | null;
  readonly identityMatched: boolean | null;
  readonly minimumDurationSeconds: number;
  readonly classification?: DriftAlarmDebugClassificationSummary | null;
  readonly liveAiAvailable: boolean;
  readonly systemTransientActivity: SystemTransientActivity;
}): DriftAlarmCandidateProbeSummary {
  return {
    reason: input.reason,
    latestSegment: input.latestSegment,
    activeSegment: input.activeSegment ?? null,
    identityMatched: input.identityMatched,
    candidateDurationSeconds: input.activeSegment?.durationSeconds ?? null,
    minimumDurationSeconds: input.minimumDurationSeconds,
    classification: input.classification ?? null,
    liveAiAvailable: input.liveAiAvailable,
    systemTransientActivity: input.systemTransientActivity,
  };
}

function summarizeProbeClassification(classification: ReturnType<typeof classifyActivityDetailed>): DriftAlarmDebugClassificationSummary {
  return {
    category: classification.category,
    productivity: classification.productivity,
    confidence: Number.isFinite(classification.confidence) ? classification.confidence : null,
    source: classification.source,
    model: null,
    promptVersion: null,
    classifiedAt: null,
  };
}
