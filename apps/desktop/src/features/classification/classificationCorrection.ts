import {
  canonicalizeClassificationRuleSiteUrl,
  classifyActivityDetailed,
  siteTargetFromCanonicalUrl,
  type ActivityCategory,
  type ActivityClassificationRecord,
  type ActivitySegment,
  type ClassificationOptions,
  type ClassificationRuleDetailKind,
  type ClassificationRuleInput,
  type ProductivityLabel,
} from "@drifty/domain";
import { normalizeClassificationRuleDetail } from "./classificationViewData";

/**
 * "surface" and "detail" save a reusable rule. "records" is for rows we cannot
 * name: there is no title or URL to write a rule about, so the correction
 * applies to the captured records themselves and nothing is promised about
 * future activity.
 */
export type ClassificationCorrectionScope = "surface" | "detail" | "records";

/**
 * Row pencils ask for a "detail" correction, but a row we could not name has no
 * title or URL to write a rule about, so it corrects its records instead.
 */
export function classificationCorrectionScopeForRow(
  requestedScope: ClassificationCorrectionScope,
  row: { readonly unidentified: boolean } | null,
): ClassificationCorrectionScope {
  return requestedScope === "detail" && row?.unidentified === true ? "records" : requestedScope;
}

export type ClassificationCorrectionNotice = {
  readonly kind: "success" | "error";
  readonly message: string;
};

export type ClassificationCorrectionDraft = {
  readonly scope: ClassificationCorrectionScope;
  readonly rowId: string | null;
  readonly targetKind: ClassificationRuleInput["targetKind"];
  readonly targetValue: string;
  readonly detailKind: ClassificationRuleDetailKind | null;
  readonly detailValue: string | null;
  readonly displayLabel: string | null;
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
  /** Classification shown when the editor opened, so the editor can preview the change. */
  readonly originalCategory: ActivityCategory;
  readonly originalProductivity: ProductivityLabel;
};

export function classificationRuleTargetForSegment(segment: ActivitySegment): Pick<ClassificationRuleInput, "targetKind" | "targetValue"> | null {
  const siteTarget = segment.siteDomain?.trim() || segment.siteUrl?.trim() || "";
  if (siteTarget) return { targetKind: "site", targetValue: siteTarget };

  const appTarget = segment.bundleId?.trim() || segment.appName.trim();
  if (appTarget) return { targetKind: "app", targetValue: appTarget };

  return null;
}

export function classificationRuleDetailForSegment(segment: ActivitySegment): Pick<ClassificationCorrectionDraft, "detailKind" | "detailValue"> {
  if (segment.youtubeTitle?.trim()) return { detailKind: "youtubeTitle", detailValue: segment.youtubeTitle.trim() };
  if (segment.siteTitle?.trim()) return { detailKind: "siteTitle", detailValue: segment.siteTitle.trim() };
  if (segment.windowTitle?.trim()) return { detailKind: "windowTitle", detailValue: segment.windowTitle.trim() };
  return { detailKind: null, detailValue: null };
}

export function classificationRuleUrlDetailForSegment(segment: ActivitySegment): Pick<ClassificationCorrectionDraft, "targetKind" | "targetValue" | "detailKind" | "detailValue"> | null {
  const canonicalUrl = canonicalizeClassificationRuleSiteUrl(segment.siteUrl);
  if (!canonicalUrl) return null;
  const siteTarget = siteTargetFromCanonicalUrl(canonicalUrl);
  if (!siteTarget) return null;
  return {
    targetKind: "site",
    targetValue: siteTarget,
    detailKind: "siteUrl",
    detailValue: canonicalUrl,
  };
}

export function buildClassificationCorrectionDraft({
  rowId,
  scope,
  segment,
  classificationOptions,
  displayLabel,
}: {
  readonly rowId: string | null;
  readonly scope: ClassificationCorrectionScope;
  readonly segment: ActivitySegment;
  readonly classificationOptions: ClassificationOptions;
  readonly displayLabel: string | null;
}): ClassificationCorrectionDraft | null {
  const target = classificationRuleTargetForSegment(segment);
  if (!target) return null;
  const classification = classifyActivityDetailed(segment, classificationOptions);
  const urlDetail = scope === "detail" ? classificationRuleUrlDetailForSegment(segment) : null;
  const detail = urlDetail ?? (scope === "detail" ? classificationRuleDetailForSegment(segment) : { detailKind: null, detailValue: null });
  if (scope === "detail" && (!detail.detailKind || !normalizeClassificationRuleDetail(detail.detailValue))) return null;
  return {
    scope,
    rowId,
    targetKind: urlDetail?.targetKind ?? target.targetKind,
    targetValue: urlDetail?.targetValue ?? target.targetValue,
    detailKind: detail.detailKind,
    detailValue: detail.detailValue,
    displayLabel,
    category: classification.category,
    productivity: classification.productivity,
    originalCategory: classification.category,
    originalProductivity: classification.productivity,
  };
}

export function buildClassificationCorrectionRecord({
  category,
  classifiedAt,
  productivity,
  segment,
}: {
  readonly category: ActivityCategory;
  readonly classifiedAt: string;
  readonly productivity: ProductivityLabel;
  readonly segment: ActivitySegment;
}): ActivityClassificationRecord {
  return {
    segmentId: segment.id,
    category,
    productivity,
    source: "manual",
    confidence: 1,
    reason: "Manual classification correction.",
    inputFingerprint: `manual:classification-correction:${segment.id}:${segment.endedAt}`,
    aiResult: false,
    stale: false,
    classifiedAt,
  };
}

/** Classification tab corrections always save a reusable app/site/detail choice. */
export async function persistClassificationCorrection(
  draft: ClassificationCorrectionDraft,
  persistence: {
    saveRule: (input: ClassificationRuleInput) => Promise<boolean>;
  },
): Promise<boolean> {
  if (draft.scope === "records") throw new Error("Unidentified-activity corrections do not save a rule.");
  return persistence.saveRule({
    targetKind: draft.targetKind, targetValue: draft.targetValue, matchScope: draft.scope,
    detailKind: draft.scope === "detail" ? draft.detailKind : null,
    detailValue: draft.scope === "detail" ? draft.detailValue : null,
    category: draft.category, productivity: draft.productivity, enabled: true, confidence: 1,
  });
}

/**
 * Corrections for a row we could not name. A rule needs an exact title or URL
 * to match on, and there is none, so every capture in the row gets a manual
 * classification instead. Manual records outrank rules and AI results when the
 * timeline is recomputed, so the fix stays put.
 */
export async function persistUnidentifiedRecordsCorrection(
  draft: ClassificationCorrectionDraft,
  segments: readonly ActivitySegment[],
  persistence: {
    saveClassifications: (records: ActivityClassificationRecord[]) => Promise<{ saved: number }>;
  },
  classifiedAt: string = new Date().toISOString(),
): Promise<boolean> {
  if (segments.length === 0) return false;
  const records = segments.map((segment) => buildClassificationCorrectionRecord({
    category: draft.category,
    classifiedAt,
    productivity: draft.productivity,
    segment,
  }));
  const result = await persistence.saveClassifications(records);
  return result.saved === records.length;
}
