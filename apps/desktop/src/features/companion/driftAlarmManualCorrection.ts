import {
  classifyActivityDetailed,
  type ActivityClassificationRecord,
  type ActivitySegment,
  type ClassificationOptions,
  type ClassificationRuleInput,
  canonicalizeClassificationRuleSiteUrl,
  siteTargetFromCanonicalUrl,
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
    matchScope: target.matchScope,
    detailKind: target.detailKind,
    detailValue: target.detailValue,
    category: classification.category,
    productivity: "neutral",
    enabled: true,
    confidence: 1,
  };
}

function getDriftAlarmManualCorrectionRuleTarget(
  segment: ActivitySegment,
): Pick<ClassificationRuleInput, "targetKind" | "targetValue" | "matchScope" | "detailKind" | "detailValue"> | null {
  const canonicalUrl = canonicalizeClassificationRuleSiteUrl(segment.siteUrl);
  if (canonicalUrl) {
    const siteTarget = siteTargetFromCanonicalUrl(canonicalUrl);
    if (siteTarget) {
      return {
        targetKind: "site",
        targetValue: siteTarget,
        matchScope: "detail",
        detailKind: "siteUrl",
        detailValue: canonicalUrl,
      };
    }
  }

  const appTarget = segment.bundleId?.trim() || segment.appName.trim();
  const windowTitle = segment.windowTitle?.trim() ?? "";
  if (appTarget && windowTitle) {
    return {
      targetKind: "app",
      targetValue: appTarget,
      matchScope: "detail",
      detailKind: "windowTitle",
      detailValue: windowTitle,
    };
  }
  if (appTarget) {
    return {
      targetKind: "app",
      targetValue: appTarget,
      matchScope: "surface",
      detailKind: null,
      detailValue: null,
    };
  }

  return null;
}
