import { classifyActivityDetailed } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions, CurrentActivitySnapshot } from "@drifty/domain";

import { getActiveDriftAlarmSegment } from "./driftAlarmCurrentSegment";
import { segmentForLiveDriftAlarmClassification } from "./liveDriftAlarmClassification";

export type LiveDriftAlarmAiCandidate = {
  readonly key: string;
  readonly segment: ActivitySegment;
  readonly sourceSegmentId: string;
};

export type LiveDriftAlarmAiCandidateInput = {
  readonly segments: readonly ActivitySegment[];
  readonly currentSnapshot: CurrentActivitySnapshot | null;
  readonly classificationOptions: ClassificationOptions;
  readonly minimumDurationSeconds: number;
};

export function resolveLiveDriftAlarmAiCandidate(input: LiveDriftAlarmAiCandidateInput): LiveDriftAlarmAiCandidate | null {
  if (!input.currentSnapshot) return null;

  const activeSegment = getActiveDriftAlarmSegment(input.currentSnapshot, input.segments);
  if (!activeSegment) return null;
  if (activeSegment.segment.durationSeconds < input.minimumDurationSeconds) return null;

  const classificationSegment = segmentForLiveDriftAlarmClassification(activeSegment.segment, input.segments);
  const classification = classifyActivityDetailed(classificationSegment, input.classificationOptions);
  if (classification.category !== "unknown") return null;

  return {
    key: activeSegment.alertKey,
    segment: classificationSegment,
    sourceSegmentId: activeSegment.sourceSegmentId,
  };
}
