import {
  classifyActivityDetailed,
  type ActivityClassificationRecord,
  type ActivitySegment,
  type ClassificationOptions,
  type ClassificationRuleInput,
} from "@drifty/domain";

const DRIFT_ALARM_MANUAL_CORRECTION_REASON = "Marked not drift from drift alarm.";

export function buildDriftAlarmManualCorrectionRecord({
  classifiedAt,
  classificationOptions,
  segment,
}: {
  readonly classifiedAt: string;
  readonly classificationOptions: ClassificationOptions;
  readonly segment: ActivitySegment;
}): ActivityClassificationRecord {
  const classification = classifyActivityDetailed(segment, classificationOptions);

  return {
    segmentId: segment.id,
    category: classification.category,
    productivity: "neutral",
    source: "manual",
    confidence: 1,
    reason: DRIFT_ALARM_MANUAL_CORRECTION_REASON,
    inputFingerprint: `manual:not-drift:${segment.id}:${segment.endedAt}`,
    aiResult: false,
    stale: false,
    classifiedAt,
  };
}

export function buildDriftAlarmManualCorrectionRuleInput({
  classificationOptions,
  segment,
}: {
  readonly classificationOptions: ClassificationOptions;
  readonly segment: ActivitySegment;
}): ClassificationRuleInput | null {
  const target = getDriftAlarmManualCorrectionRuleTarget(segment);
  if (!target) return null;

  const classification = classifyActivityDetailed(segment, classificationOptions);

  return {
    targetKind: target.targetKind,
    targetValue: target.targetValue,
    category: classification.category,
    productivity: "neutral",
    enabled: true,
    confidence: 1,
  };
}

function getDriftAlarmManualCorrectionRuleTarget(
  segment: ActivitySegment,
): Pick<ClassificationRuleInput, "targetKind" | "targetValue"> | null {
  const siteTarget = segment.siteDomain?.trim() || segment.siteUrl?.trim() || "";
  if (siteTarget) return { targetKind: "site", targetValue: siteTarget };

  const appTarget = segment.bundleId?.trim() || segment.appName.trim();
  if (appTarget) return { targetKind: "app", targetValue: appTarget };

  return null;
}
