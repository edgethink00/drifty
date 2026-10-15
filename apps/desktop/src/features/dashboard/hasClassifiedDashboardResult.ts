import { classifyActivityDetailed, type ActivitySegment, type ClassificationOptions } from "@drifty/domain";

/** Count rendered saved AI/manual/rule results, not raw tracking or default heuristics. */
export function hasClassifiedDashboardResult(
  segments: readonly ActivitySegment[],
  options: ClassificationOptions,
): boolean {
  return classifiedDashboardSegmentIds(segments, options).size > 0;
}

export function classifiedDashboardSegmentIds(segments: readonly ActivitySegment[], options: ClassificationOptions): ReadonlySet<string> {
  return new Set(segments.filter((segment) => {
    if (!Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0) return false;
    const stored = segment.classification;
    if (!stored || stored.stale || !["llm", "ai_review", "manual", "rule"].includes(stored.source)) return false;
    if (stored.source === "rule"
      && !stored.classificationRuleId
      && stored.ruleSnapshotKind !== "synced-rule") return false;
    if (stored.aiResult === true && options.includeAiClassifications === false) return false;
    return classifyActivityDetailed(segment, options).category !== "unknown";
  }).map((segment) => segment.id));
}
