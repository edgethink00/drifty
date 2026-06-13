import type { ActivitySegment, ClassificationOptions, CurrentActivitySnapshot } from "@drifty/domain";
import { buildDriftAlarmCandidates, type DriftAlarmCandidate } from "./driftAlarmData";

export type FreshDriftAlarmCandidateInput = {
  readonly candidate: DriftAlarmCandidate;
  readonly segments: readonly ActivitySegment[];
  readonly currentSnapshot: CurrentActivitySnapshot | null;
  readonly classificationOptions: ClassificationOptions;
  readonly minimumDurationSeconds: number;
};

export function resolveFreshDriftAlarmCandidate(input: FreshDriftAlarmCandidateInput): DriftAlarmCandidate | null {
  if (!input.currentSnapshot) return null;

  const freshCandidate = buildDriftAlarmCandidates({
    segments: [...input.segments],
    currentSnapshot: input.currentSnapshot,
    classificationOptions: input.classificationOptions,
    minimumDurationSeconds: input.minimumDurationSeconds,
  })[0] ?? null;
  if (!freshCandidate) return null;

  return driftAlarmCandidateSourceKey(freshCandidate) === driftAlarmCandidateSourceKey(input.candidate)
    ? freshCandidate
    : null;
}

function driftAlarmCandidateSourceKey(candidate: DriftAlarmCandidate): string {
  return candidate.sourceSegmentId ?? candidate.segment.id;
}
