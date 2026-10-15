import { buildAppUsageSummaries, canonicalizeClassificationRuleSiteUrl, classifyActivityDetailed, formatTimelineItems, PRODUCTIVITY_ORDER, secondsToLabel } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationOptions, ClassificationRule, ClassificationRuleApplyResult, ClassificationRuleCandidate, ClassificationRuleDetailKind, ClassificationRuleInput, ClassificationRuleTargetKind, ClassificationSource, ProductivityLabel } from "@drifty/domain";
import { FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatTimeLabel } from "../../lib/formatting";

export type ClassificationSourceSummary = {
  id: string;
  label: string;
  usageKind: "app" | "site";
  appName: string;
  siteDomain: string | null;
  siteTitle: string | null;
  totalSeconds: number;
  sessionCount: number;
  averageSessionSeconds: number;
  shareOfTotal: number;
  productivityMix: ClassificationSourceProductivityMix[];
};

export type ClassificationSourceProductivityMix = {
  productivity: ProductivityLabel;
  totalSeconds: number;
  ratio: number;
};

type ClassificationSourceSummaryDraft = ClassificationSourceSummary & {
  productivitySeconds: Record<ProductivityLabel, number>;
};

export type ClassificationActivityRow = {
  id: string;
  label: string;
  totalSeconds: number;
  count: number;
  startedLabel: string;
  endedLabel: string;
  segments: ActivitySegment[];
  hasDetails: boolean;
  /**
   * True when the captures in this row carry no title we can name the activity
   * by, so the row stands for "time we could not identify" rather than one
   * activity. Those rows cannot back a reusable detail rule.
   */
  unidentified: boolean;
};

export type CaptureSliceGroup = {
  /** Stable DOM/aria id: the first segment's id. */
  id: string;
  startedAt: string;
  endedAt: string;
  /** Sum of member durations — excludes untracked gaps between captures. */
  durationSeconds: number;
  segments: ActivitySegment[];
};

/**
 * Consecutive captures of the same activity whose boundary gap is at most this
 * long read as one sitting, not two separate records. Matches the communication
 * episode convention in domain aggregation.
 */
export const CAPTURE_SLICE_GROUP_MAX_GAP_SECONDS = 60;

export function buildCaptureSliceGroups(
  segments: ActivitySegment[],
  maxGapSeconds = CAPTURE_SLICE_GROUP_MAX_GAP_SECONDS,
): CaptureSliceGroup[] {
  const ordered = segments.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const groups: CaptureSliceGroup[] = [];
  for (const segment of ordered) {
    const group = groups[groups.length - 1];
    const gapSeconds = group
      ? (Date.parse(segment.startedAt) - Date.parse(group.endedAt)) / 1000
      : Number.POSITIVE_INFINITY;
    if (group && gapSeconds <= maxGapSeconds) {
      group.segments.push(segment);
      group.durationSeconds += segment.durationSeconds;
      if (segment.endedAt > group.endedAt) group.endedAt = segment.endedAt;
      if (segment.startedAt < group.startedAt) group.startedAt = segment.startedAt;
      continue;
    }
    groups.push({
      id: segment.id,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      durationSeconds: segment.durationSeconds,
      segments: [segment],
    });
  }
  return groups;
}

export type TimelineItem = ReturnType<typeof formatTimelineItems>[number];

export type CategoryBreakdownUsageItem = ReturnType<typeof buildAppUsageSummaries>[number];

export type CategoryProductivityMixItem = {
  productivity: ProductivityLabel;
  totalSeconds: number;
  ratio: number;
};

export type ClassificationCategoryBreakdown = {
  category: ActivityCategory;
  totalSeconds: number;
  shareOfDay: number;
  sessionCount: number;
  averageSessionSeconds: number;
  longestSession: TimelineItem | null;
  dominantSurface: CategoryBreakdownUsageItem | null;
  productivityMix: CategoryProductivityMixItem[];
  dominantProductivity: CategoryProductivityMixItem | null;
  topApps: CategoryBreakdownUsageItem[];
  topSites: CategoryBreakdownUsageItem[];
};

export const CATEGORY_BREAKDOWN_USAGE_LIMIT = 4;

export function classifySourceKey(item: ClassificationSourceSummary): string {
  return item.id;
}

export function normalizeClassificationSourceDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? "";
  return domain.length > 0 ? domain : null;
}

export function normalizeClassificationSourceTitle(value: string | null | undefined): string | null {
  const title = value?.trim() ?? "";
  return title.length > 0 ? title : null;
}

export function classificationSourceIdentity(segment: ActivitySegment): Pick<ClassificationSourceSummary, "id" | "label" | "usageKind" | "appName" | "siteDomain" | "siteTitle"> {
  const appName = segment.appName.trim() || "Unknown app";
  const siteDomain = normalizeClassificationSourceDomain(segment.siteDomain);
  const siteTitle = normalizeClassificationSourceTitle(segment.siteTitle);
  const siteLabel = siteDomain ?? siteTitle;

  if (siteLabel) {
    const titleKeyScope = segment.bundleId?.trim() || appName;
    return {
      id: siteDomain ? `site:${siteDomain}` : `site-title:${siteTitle!.toLowerCase()}:${titleKeyScope}`,
      label: siteLabel,
      usageKind: "site",
      appName,
      siteDomain,
      siteTitle,
    };
  }

  return { id: `app:${appName}`, label: appName, usageKind: "app", appName, siteDomain: null, siteTitle: null };
}

export function classifySegmentSourceKey(segment: ActivitySegment): string {
  return classificationSourceIdentity(segment).id;
}

export function isChromeLikeBrowserName(value: string | null | undefined): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return /\b(chrome|chromium|chrome canary|brave|microsoft edge|vivaldi|opera)\b/.test(normalized);
}

export function isChromeTitleBrowserChunk(value: string): boolean {
  return /^(google chrome|chrome|chromium|chrome canary|brave browser|brave|microsoft edge|edge|vivaldi|opera)$/i.test(value.trim());
}

export function isChromeVolatileTitleChunk(value: string): boolean {
  const normalized = value.trim();
  return normalized === "오디오 재생"
    || normalized === "메모리 사용량 많음"
    || /^\d+(?:\.\d+)?\s*(?:MB|GB)$/i.test(normalized);
}

export function stableChromeWindowTitle(segment: ActivitySegment, title: string): string | null {
  if (!isChromeLikeBrowserName(segment.appName) && !isChromeLikeBrowserName(segment.browserName)) return null;

  const parts = title.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const youtubeIndex = parts.findIndex((part) => part === "YouTube");
  const hasBrowserSuffix = parts.some(isChromeTitleBrowserChunk);
  const hasVolatileSuffix = parts.some(isChromeVolatileTitleChunk);
  if (youtubeIndex > 0 && (hasBrowserSuffix || hasVolatileSuffix)) {
    return parts.slice(0, youtubeIndex).join(" - ");
  }

  let end = parts.length;
  if (end >= 2 && isChromeTitleBrowserChunk(parts[end - 2])) end -= 1;
  if (end > 0 && isChromeTitleBrowserChunk(parts[end - 1])) end -= 1;
  while (end > 0 && isChromeVolatileTitleChunk(parts[end - 1])) end -= 1;
  if (end > 0 && parts[end - 1] === "YouTube" && (hasBrowserSuffix || hasVolatileSuffix)) end -= 1;

  if (end > 0 && end < parts.length) return parts.slice(0, end).join(" - ");
  return null;
}

export function windowTitleMatchesSiteTitle(windowTitle: string, siteTitle: string, stableWindowTitle: string | null): boolean {
  if (!windowTitle || !siteTitle) return true;
  return windowTitle.startsWith(siteTitle) || siteTitle.startsWith(stableWindowTitle ?? windowTitle);
}

export function classificationActivityLabel(segment: ActivitySegment): string {
  const windowTitle = (segment.windowTitle || "").trim();
  const siteTitle = (segment.siteTitle || "").trim();
  const stableWindowTitle = windowTitle ? stableChromeWindowTitle(segment, windowTitle) : null;
  // Segments are grouped by site fields, so a window title captured from a
  // different window than the recorded tab must not be used as the label.
  const windowTitleUsable = windowTitleMatchesSiteTitle(windowTitle, siteTitle, stableWindowTitle);
  const rawLabel = (windowTitleUsable ? stableWindowTitle || windowTitle : "")
    || siteTitle
    || (segment.siteDomain || "").trim()
    || segment.appName;
  return sanitizeCaptureText(rawLabel);
}

export function segmentHasUsefulCaptureDetails(segment: ActivitySegment, rowLabel: string): boolean {
  const title = (segment.youtubeTitle || segment.siteTitle || segment.windowTitle || "").trim();
  return Boolean(
    segment.browserName
    || segment.siteDomain
    || segment.youtubeChannelName
    || (title && title !== rowLabel)
    || segment.classification?.source
    || segment.classification?.reason
    || segment.classification?.confidence != null,
  );
}

/**
 * True when a capture tells us nothing about what the person was actually
 * doing: no page/video/window title, no URL we can canonicalize, or a window
 * title that is just the app's own name (a browser tab-less "ChatGPT" window
 * says as little as an empty one).
 *
 * Such captures cannot back a reusable detail rule, because a rule matches an
 * exact title or URL and there is none. Keeping them in their own row is what
 * stops "ChatGPT" from meaning both "the ChatGPT window" and "ChatGPT time we
 * could not name".
 */
export function isUnidentifiedActivitySegment(segment: ActivitySegment): boolean {
  if ((segment.youtubeTitle || "").trim()) return false;
  if ((segment.siteTitle || "").trim()) return false;
  if (canonicalizeClassificationRuleSiteUrl(segment.siteUrl)) return false;
  const windowTitle = (segment.windowTitle || "").trim();
  if (!windowTitle) return true;
  return windowTitle.toLocaleLowerCase() === segment.appName.trim().toLocaleLowerCase();
}

// A control character keeps this key out of reach of any real capture label,
// which are sanitized text. Row ids are never rendered; the DOM id derived from
// them is sanitized and hashed.
const UNIDENTIFIED_ROW_KEY = "\u0000unidentified";

function unidentifiedRowId(sourceKey: string): string {
  return `${sourceKey}:${UNIDENTIFIED_ROW_KEY}`;
}

export function hashStringForDomId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function classificationActivityDetailsId(rowId: string): string {
  const readableId = rowId
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "activity";
  return `classification-activity-details-${readableId}-${hashStringForDomId(rowId)}`;
}

export function formatClassificationConfidence(confidence: number): string {
  return `${Math.round(Math.min(Math.max(confidence, 0), 1) * 100)}%`;
}

export function truncateCaptureSummary(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

export function sanitizeCaptureText(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[link]").replace(/\bwww\.\S+/gi, "[link]").trim().replace(/\s+/g, " ");
}

export function safeCaptureSummary(value: string): string {
  return truncateCaptureSummary(sanitizeCaptureText(value));
}

export function captureSurfaceDetails(segment: ActivitySegment): string[] {
  return [
    segment.appName ? `App: ${segment.appName}` : null,
    segment.browserName ? `Browser: ${segment.browserName}` : null,
    segment.siteDomain ? `Domain: ${segment.siteDomain}` : null,
    segment.youtubeChannelName ? `Channel: ${safeCaptureSummary(segment.youtubeChannelName)}` : null,
  ].filter((item): item is string => Boolean(item));
}

export function captureRowSurfaceDetails(segments: ActivitySegment[]): string[] {
  const details = new Set<string>();
  for (const segment of segments) {
    for (const detail of captureSurfaceDetails(segment)) details.add(detail);
  }
  return Array.from(details);
}

export type ClassificationRowSummary = {
  categoryLabel: string;
  productivityLabel: string;
  sourceLabel: string;
  confidenceLabel: string;
};

export function classificationRowSummary(segments: ActivitySegment[], options?: ClassificationOptions): ClassificationRowSummary | null {
  const classifications = segments.map((segment) => classifyActivityDetailed(segment, options));
  const firstClassification = classifications[0];
  if (!firstClassification) return null;

  const categoryValues = new Set(classifications.map((classification) => classification.category));
  const productivityValues = new Set(classifications.map((classification) => classification.productivity));
  const sourceValues = new Set(classifications.map((classification) => classification.source));
  let confidenceTotal = 0;
  let positiveConfidenceCount = 0;

  for (const classification of classifications) {
    if (Number.isFinite(classification.confidence) && classification.confidence > 0) {
      confidenceTotal += classification.confidence;
      positiveConfidenceCount += 1;
    }
  }

  let confidenceLabel = "Confidence unavailable";
  if (positiveConfidenceCount === classifications.length) {
    confidenceLabel = formatClassificationConfidence(confidenceTotal / positiveConfidenceCount);
  } else if (positiveConfidenceCount > 0) {
    confidenceLabel = "Mixed confidence";
  }

  return {
    categoryLabel: categoryValues.size > 1 ? "Mixed" : categoryLabel(firstClassification.category),
    productivityLabel: productivityValues.size > 1 ? "Mixed" : productivityLabel(firstClassification.productivity),
    sourceLabel: sourceValues.size > 1 ? "Mixed" : classificationSourceLabel(firstClassification.source, firstClassification.source === "llm", firstClassification.aiCached),
    confidenceLabel,
  };
}

export function buildClassificationSourceSummaries(segments: ActivitySegment[], options?: ClassificationOptions): ClassificationSourceSummary[] {
  const sourceMap = new Map<string, ClassificationSourceSummaryDraft>();
  for (const segment of segments) {
    const identity = classificationSourceIdentity(segment);
    const existing = sourceMap.get(identity.id) ?? {
      ...identity,
      totalSeconds: 0,
      sessionCount: 0,
      averageSessionSeconds: 0,
      shareOfTotal: 0,
      productivityMix: [],
      productivitySeconds: { focus: 0, neutral: 0, drift: 0 },
    };
    const classification = classifyActivityDetailed(segment, options);
    existing.totalSeconds += segment.durationSeconds;
    existing.sessionCount += 1;
    existing.productivitySeconds[classification.productivity] += segment.durationSeconds;
    if (existing.usageKind === "site" && !existing.siteTitle) existing.siteTitle = normalizeClassificationSourceTitle(segment.siteTitle);
    sourceMap.set(identity.id, existing);
  }
  const total = segments.reduce((sum, s) => sum + s.durationSeconds, 0);
  return Array.from(sourceMap.values())
    .map((item) => {
      const productivityMix = PRODUCTIVITY_ORDER
        .map((productivity) => ({
          productivity,
          totalSeconds: item.productivitySeconds[productivity],
          ratio: item.totalSeconds > 0 ? item.productivitySeconds[productivity] / item.totalSeconds : 0,
        }))
        .filter((entry) => entry.totalSeconds > 0);
      return {
        ...item,
        averageSessionSeconds: item.sessionCount > 0 ? Math.round(item.totalSeconds / item.sessionCount) : 0,
        shareOfTotal: total > 0 ? item.totalSeconds / total : 0,
        productivityMix,
      };
    })
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export function formatClassificationSourceProductivityMix(mix: ClassificationSourceProductivityMix[]): string {
  if (mix.length === 0) return "No productivity signal";
  return mix
    .map((entry) => `${productivityLabel(entry.productivity)} ${formatCompactDurationFromSeconds(entry.totalSeconds)}`)
    .join(", ");
}

export function buildClassificationActivityRows(segs: ActivitySegment[]): ClassificationActivityRow[] {
  const rows = new Map<string, ClassificationActivityRow>();
  const ordered = segs.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const item of ordered) {
    const label = classificationActivityLabel(item);
    // Captures we cannot name never share a row with a real activity, even when
    // the label fallback makes them look alike.
    const unidentified = isUnidentifiedActivitySegment(item);
    const sourceKey = classifySegmentSourceKey(item);
    const key = unidentified ? unidentifiedRowId(sourceKey) : `${sourceKey}:${label}`;
    const current = rows.get(key) ?? {
      id: key,
      label,
      totalSeconds: 0,
      count: 0,
      startedLabel: formatTimeLabel(item.startedAt),
      endedLabel: formatTimeLabel(item.endedAt),
      segments: [],
      hasDetails: false,
      unidentified,
    };
    current.totalSeconds += item.durationSeconds;
    current.count += 1;
    current.endedLabel = formatTimeLabel(item.endedAt);
    current.segments.push(item);
    rows.set(key, current);
  }
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      hasDetails: row.count > 1 || row.segments.some((segment) => segmentHasUsefulCaptureDetails(segment, row.label)),
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export function formatCategoryPercentage(percentage: number) {
  if (percentage > 0 && percentage < 1) return "<1%";
  return `${Math.round(percentage)}%`;
}

export function buildClassificationCategoryBreakdowns(
  segments: ActivitySegment[],
  classificationOptions: ClassificationOptions,
  dayTotalSeconds: number,
): ClassificationCategoryBreakdown[] {
  type CategoryAccumulator = {
    category: ActivityCategory;
    totalSeconds: number;
    segments: ActivitySegment[];
    productivityTotals: Map<ProductivityLabel, number>;
  };
  const categories = new Map<ActivityCategory, CategoryAccumulator>();

  for (const segment of segments) {
    const classification = classifyActivityDetailed(segment, classificationOptions);
    const current = categories.get(classification.category) ?? {
      category: classification.category,
      totalSeconds: 0,
      segments: [],
      productivityTotals: new Map<ProductivityLabel, number>(),
    };

    current.totalSeconds += segment.durationSeconds;
    current.segments.push(segment);
    current.productivityTotals.set(classification.productivity, (current.productivityTotals.get(classification.productivity) ?? 0) + segment.durationSeconds);
    categories.set(classification.category, current);
  }

  return Array.from(categories.values())
    .filter((entry) => entry.totalSeconds > 0)
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .map((entry) => {
      const appSegments = entry.segments.filter((segment) => !hasBrowserSiteContext(segment));
      const topApps = buildAppUsageSummaries(appSegments, { limit: CATEGORY_BREAKDOWN_USAGE_LIMIT, groupBy: "app" });
      const topSites = buildAppUsageSummaries(entry.segments)
        .filter((item) => item.usageKind === "site")
        .slice(0, CATEGORY_BREAKDOWN_USAGE_LIMIT);
      const longestSession = formatTimelineItems(entry.segments).sort((left, right) => right.durationSeconds - left.durationSeconds)[0] ?? null;
      const productivityMix = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER
        .map((productivity) => {
          const totalSeconds = entry.productivityTotals.get(productivity) ?? 0;
          return { productivity, totalSeconds, ratio: entry.totalSeconds > 0 ? totalSeconds / entry.totalSeconds : 0 };
        })
        .filter((item) => item.totalSeconds > 0);
      const dominantProductivity = productivityMix.slice().sort((left, right) => right.totalSeconds - left.totalSeconds)[0] ?? null;
      const dominantSurface = [...topApps, ...topSites].sort((left, right) => right.totalSeconds - left.totalSeconds)[0] ?? null;

      return {
        category: entry.category,
        totalSeconds: entry.totalSeconds,
        shareOfDay: dayTotalSeconds > 0 ? entry.totalSeconds / dayTotalSeconds : 0,
        sessionCount: entry.segments.length,
        averageSessionSeconds: entry.segments.length > 0 ? entry.totalSeconds / entry.segments.length : 0,
        longestSession,
        dominantSurface,
        productivityMix,
        dominantProductivity,
        topApps,
        topSites,
      };
    });
}

export function usageItemLabel(item: CategoryBreakdownUsageItem): string {
  return item.siteDomain ?? item.siteTitle ?? item.appName;
}

export function hasBrowserSiteContext(segment: ActivitySegment): boolean {
  return Boolean(segment.siteDomain?.trim() || segment.siteTitle?.trim());
}

export function productivityMixAriaLabel(label: string, entries: CategoryProductivityMixItem[]): string {
  const parts = entries.map((entry) => `${productivityLabel(entry.productivity)} ${formatCompactDurationFromSeconds(entry.totalSeconds)} ${formatCategoryPercentage(entry.ratio * 100)}`);
  return `${label} productivity mix: ${parts.join(", ")}`;
}

export function classificationSourceLabel(source?: ClassificationSource | string | null, ai?: boolean | null, aiCached?: boolean | null): string {
  if (ai || source === "llm") return aiCached ? "AI cache" : "AI";
  if (source === "domain-db" || source === "app-db" || source === "youtube") return "Predefined";
  if (source === "context") return "Keyword rule";
  if (source === "fallback") return "Fallback";
  if (source === "manual") return "Manual";
  if (source === "rule") return "Custom rule";
  if (source === "stored") return "Stored";
  return "Not classified yet";
}

export function classificationRuleTargetLabel(targetKind: ClassificationRuleTargetKind): string {
  return targetKind === "site" ? "Domain" : "App";
}

export function classificationRuleSurfaceLabel(rule: Pick<ClassificationRule, "targetKind">): string {
  return rule.targetKind === "site" ? "Site" : "App";
}

export function classificationRuleScopeLabel(rule: Pick<ClassificationRule, "matchScope" | "targetKind" | "detailKind">): string {
  if (rule.matchScope === "detail") return classificationRuleDetailKindLabel(rule.detailKind);
  return classificationRuleTargetLabel(rule.targetKind);
}

export function classificationRuleDetailKindLabel(detailKind?: ClassificationRuleDetailKind | null): string {
  switch (detailKind) {
    case "title": return "Title";
    case "windowTitle": return "Window title";
    case "siteTitle": return "Page title";
    case "youtubeTitle": return "YouTube title";
    case "siteUrl": return "URL";
    default: return "Detail";
  }
}

export function classificationRuleCandidateAppIconSrc(candidate: ClassificationRuleCandidate, appIcons: AppIconMap): string | null {
  return appIcons[candidate.bundleId ?? candidate.appName ?? candidate.displayName] ?? null;
}

export function classificationRuleAppIconSrc(rule: ClassificationRule, appIcons: AppIconMap): string | null {
  return appIcons[rule.targetValue] ?? null;
}

export function formatClassificationCandidateUsageLabel(candidate: ClassificationRuleCandidate): string {
  return `${secondsToLabel(candidate.totalSeconds)} across ${candidate.segmentCount} ${candidate.segmentCount === 1 ? "segment" : "segments"}`;
}

export function normalizeDomainRuleInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // Match tracker storage: repeated www prefixes and surrounding dots can leave no host.
    const hostname = new URL(candidate).hostname.toLowerCase().replace(/^(?:www\.)+/, "");
    return hostname.replace(/^\.+|\.+$/g, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/^(?:www\.)+/, "")
      .split(/[/?#]/)[0]
      .replace(/^\.+|\.+$/g, "");
  }
}

export function normalizeClassificationRuleTarget(targetKind: ClassificationRuleTargetKind, targetValue: string): string {
  return targetKind === "site" ? normalizeDomainRuleInput(targetValue) : targetValue.trim().toLowerCase();
}

export function normalizeClassificationRuleDetail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeClassificationRuleDetailForKind(detailKind: ClassificationRuleDetailKind | null | undefined, value: string | null | undefined): string {
  if (detailKind === "siteUrl") return canonicalizeClassificationRuleSiteUrl(value) ?? "";
  return normalizeClassificationRuleDetail(value);
}

export function hasDuplicateClassificationRule(rules: ClassificationRule[], targetKind: ClassificationRuleTargetKind, targetValue: string, input?: Pick<ClassificationRuleInput, "matchScope" | "detailKind" | "detailValue">): boolean {
  const normalizedTargetValue = normalizeClassificationRuleTarget(targetKind, targetValue);
  const matchScope = input?.matchScope ?? "surface";
  const detailKind = input?.detailKind ?? null;
  const detailValue = normalizeClassificationRuleDetailForKind(detailKind, input?.detailValue);
  return rules.some((rule) => {
    if (rule.targetKind !== targetKind || normalizeClassificationRuleTarget(rule.targetKind, rule.targetValue) !== normalizedTargetValue) return false;
    const ruleMatchScope = rule.matchScope ?? "surface";
    if (ruleMatchScope !== matchScope) return false;
    if (matchScope !== "detail") return true;
    return rule.detailKind === detailKind && normalizeClassificationRuleDetailForKind(rule.detailKind, rule.detailValue) === detailValue;
  });
}

export function formatClassificationRuleApplyResult(result: ClassificationRuleApplyResult): string {
  return `Matched ${result.matchedCount} local-rule ${result.matchedCount === 1 ? "segment" : "segments"}; applied ${result.appliedCount}, skipped ${result.skippedCount}.`;
}
