import type { ActivityCategory } from "@drifty/domain";

export const ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD = 0.55;

type RetryRecord = { readonly category: ActivityCategory; readonly confidence: number };
const finiteConfidence = (value: number): number => Number.isFinite(value) ? value : 0.5;

// The intent-first prompt expresses insufficient evidence structurally. Reasons
// may be terse or localized and are not a reliable retry signal.
export function retryEvidenceForRecord(record: RetryRecord): "normal" | "insufficient" {
  return record.category === "unknown" || finiteConfidence(record.confidence) <= ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD
    ? "insufficient" : "normal";
}

export function enhancedRetryImproves(first: RetryRecord, retry: RetryRecord): boolean {
  if (retry.category === "unknown") return false;
  if (first.category === "unknown") return true;
  const firstConfidence = finiteConfidence(first.confidence);
  const retryConfidence = finiteConfidence(retry.confidence);
  if (retryEvidenceForRecord(first) === "insufficient") return retryConfidence >= firstConfidence;
  return firstConfidence <= ENHANCED_CONTEXT_RETRY_CONFIDENCE_THRESHOLD && retryConfidence > firstConfidence;
}
