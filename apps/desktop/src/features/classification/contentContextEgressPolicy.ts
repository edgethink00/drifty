import {
  adaptiveRetryEligibility,
  sourceFamilyPolicy,
  type ActivityCategory,
  type AdaptiveContentContext,
  type AdaptiveContextItem,
  type AdaptiveContextItemKind,
  type AdaptiveContextSourceFamily,
  type AdaptiveProviderPolicyDecision,
  type AdaptiveRetryEligibility,
  type AdaptiveRetryEvidence,
} from "@drifty/domain";
import type { EnhancedContextSettings } from "../settings/settingsStorage";
import {
  sanitizeValues,
  sensitiveDecision,
  sensitivityReasons,
} from "./contentContextEgressRedaction";

export type ContentContextEgressMode = "first_pass" | "enhanced_retry";
type ProviderVisibleDecision = Extract<AdaptiveProviderPolicyDecision, "send" | "metadata_only">;

export const CONTENT_CONTEXT_DROP_REASONS = [
  "first_pass",
  "dev_mode_disabled",
  "enhanced_context_disabled",
  "capture_disabled",
  "retry_disabled",
  "missing_context",
  "source_family_disabled",
  "surface_metadata_not_enhanced",
  "source_family_local_only",
  "depth_not_allowed",
  "item_kind_not_allowed",
  "item_kind_blocked",
  "depth_3_not_allowed",
  "provider_policy_blocked",
  "provider_policy_local_only",
  "sensitive_surface",
  "raw_collector_output",
  "secret_like_value",
  "private_key",
  "credit_card",
  "ssn",
  "one_time_code",
  "long_identifier",
  "invalid_url",
  "empty_after_redaction",
  "max_items_exceeded",
  "max_values_exceeded",
  "text_truncated",
] as const;
export type ContentContextDropReason = (typeof CONTENT_CONTEXT_DROP_REASONS)[number];

export type EnhancedContextProviderItem = {
  readonly id: string;
  readonly sourceFamily: AdaptiveContextSourceFamily;
  readonly depth: 1 | 2 | 3;
  readonly kind: AdaptiveContextItemKind;
  readonly decision: ProviderVisibleDecision;
  readonly values: readonly string[];
};

export type EnhancedContextProviderPayload = {
  readonly kind: "enhanced_retry_context";
  readonly segmentId: string;
  readonly items: readonly EnhancedContextProviderItem[];
};

export type ContentContextEgressSummary = {
  readonly decisionCounts: Readonly<Record<AdaptiveProviderPolicyDecision, number>>;
  readonly dropReasonCounts: Readonly<Partial<Record<ContentContextDropReason, number>>>;
  readonly providerSafeItemCount: number;
  readonly redactionCount: number;
  readonly maxDepthSent: 1 | 2 | 3 | null;
};

export type ContentContextEgressPolicyInput = {
  readonly mode: ContentContextEgressMode;
  readonly devModeEnabled: boolean;
  readonly settings: EnhancedContextSettings;
  readonly context: AdaptiveContentContext | null;
};

export type ContentContextEgressPolicyResult = {
  readonly providerContext: EnhancedContextProviderPayload | null;
  readonly summary: ContentContextEgressSummary;
};

type ItemDecision =
  | {
      readonly decision: "send" | "metadata_only";
      readonly reasons: readonly ContentContextDropReason[];
      readonly depth: ProviderContextDepth;
    }
  | { readonly decision: "local_only" | "blocked"; readonly reasons: readonly ContentContextDropReason[] };
type ProviderVisibleItemDecision = Extract<ItemDecision, { readonly decision: ProviderVisibleDecision }>;

type MutableSummary = {
  decisionCounts: Record<AdaptiveProviderPolicyDecision, number>;
  dropReasonCounts: Partial<Record<ContentContextDropReason, number>>;
  providerSafeItemCount: number;
  redactionCount: number;
  maxDepthSent: 1 | 2 | 3 | null;
};

type ProviderContextDepth = EnhancedContextProviderItem["depth"];

const MAX_PROVIDER_ITEMS = 5;
const DEPTH_3_PROVIDER_SOURCES: ReadonlySet<AdaptiveContextSourceFamily> = new Set([
  "document_knowledge",
  "local_notes_markdown",
  "work_tracker_dev_platform",
]);

export function buildProviderSafeEnhancedContext(
  input: ContentContextEgressPolicyInput,
): ContentContextEgressPolicyResult {
  const summary = emptySummary();
  const providerItems: EnhancedContextProviderItem[] = [];
  const items = input.context?.items ?? [];
  if (!input.context) {
    recordReasons(summary, ["missing_context"]);
  }

  for (const item of items) {
    if (providerItems.length >= MAX_PROVIDER_ITEMS) {
      recordDecision(summary, "local_only", ["max_items_exceeded"]);
      continue;
    }

    const itemDecision = decideItem({ item, input });
    if (!isProviderVisibleItemDecision(itemDecision)) {
      recordDecision(summary, itemDecision.decision, itemDecision.reasons);
      continue;
    }

    const sanitized = sanitizeValues(item);
    const reasons = [...itemDecision.reasons, ...sanitized.reasons];
    if (sanitized.values.length === 0) {
      recordDecision(summary, "blocked", [...reasons, "empty_after_redaction"]);
      continue;
    }

    recordDecision(summary, itemDecision.decision, reasons);
    summary.providerSafeItemCount += 1;
    summary.redactionCount += sanitized.redactionCount;
    summary.maxDepthSent = maxDepth(summary.maxDepthSent, itemDecision.depth);
    providerItems.push({
      id: item.id,
      sourceFamily: item.sourceFamily,
      depth: itemDecision.depth,
      kind: item.kind,
      decision: itemDecision.decision,
      values: sanitized.values,
    });
  }

  return {
    providerContext: providerItems.length === 0 || !input.context
      ? null
      : { kind: "enhanced_retry_context", segmentId: input.context.segmentId, items: providerItems },
    summary,
  };
}

export type EnhancedContextRetryEligibilityInput = {
  readonly devModeEnabled: boolean;
  readonly settings: EnhancedContextSettings;
  readonly alreadyRetried: boolean;
  readonly category: ActivityCategory;
  readonly confidence: number;
  readonly evidence: AdaptiveRetryEvidence;
  readonly threshold: number;
  readonly providerContext: EnhancedContextProviderPayload | null;
};

export function enhancedContextRetryEligibility(
  input: EnhancedContextRetryEligibilityInput,
): AdaptiveRetryEligibility {
  return adaptiveRetryEligibility({
    retryEnabled: input.devModeEnabled && input.settings.enabled && input.settings.retryLowConfidence,
    alreadyRetried: input.alreadyRetried,
    category: input.category,
    confidence: input.confidence,
    evidence: input.evidence,
    threshold: input.threshold,
    providerSafeContextItemCount: input.providerContext?.items.length ?? 0,
  });
}

function decideItem(args: { readonly item: AdaptiveContextItem; readonly input: ContentContextEgressPolicyInput }): ItemDecision {
  const item = args.item;
  if (args.input.mode === "first_pass") return { decision: "local_only", reasons: ["first_pass"] };
  if (!args.input.devModeEnabled) return { decision: "local_only", reasons: ["dev_mode_disabled"] };
  if (!args.input.settings.enabled) return { decision: "local_only", reasons: ["enhanced_context_disabled"] };
  if (!args.input.settings.captureLocal) return { decision: "local_only", reasons: ["capture_disabled"] };
  if (!args.input.settings.retryLowConfidence) return { decision: "local_only", reasons: ["retry_disabled"] };
  if (item.sourceFamily === "surface_metadata") {
    return { decision: "local_only", reasons: ["surface_metadata_not_enhanced"] };
  }

  const reasons = sensitivityReasons(item);
  if (!sourceFamilyEnabled(args.input.settings, item.sourceFamily)) {
    return { decision: "local_only", reasons: [...reasons, "source_family_disabled"] };
  }
  if (reasons.includes("raw_collector_output")) return { decision: "blocked", reasons };
  if (reasons.includes("sensitive_surface")) return { decision: sensitiveDecision(item), reasons };
  if (item.providerPolicy === "blocked") return { decision: "blocked", reasons: ["provider_policy_blocked"] };
  if (item.providerPolicy === "local_only") return { decision: "local_only", reasons: ["provider_policy_local_only"] };

  const policy = sourceFamilyPolicy(item.sourceFamily);
  if (policy.providerRetryDefault === "local_only") return { decision: "local_only", reasons: ["source_family_local_only"] };
  if (!policy.allowedDepths.includes(item.depth)) return { decision: "blocked", reasons: ["depth_not_allowed"] };
  if (policy.blockedItemKinds.includes(item.kind)) return { decision: "blocked", reasons: ["item_kind_blocked"] };
  if (!policy.allowedItemKinds.includes(item.kind)) return { decision: "blocked", reasons: ["item_kind_not_allowed"] };
  if (!isProviderContextDepth(item.depth)) return { decision: "local_only", reasons: ["surface_metadata_not_enhanced"] };
  if (item.depth === 3 && !DEPTH_3_PROVIDER_SOURCES.has(item.sourceFamily)) {
    return { decision: "local_only", reasons: ["depth_3_not_allowed"] };
  }
  return { decision: item.depth === 3 ? "send" : "metadata_only", reasons, depth: item.depth };
}

function isProviderContextDepth(depth: AdaptiveContextItem["depth"]): depth is ProviderContextDepth {
  return depth === 1 || depth === 2 || depth === 3;
}

function sourceFamilyEnabled(settings: EnhancedContextSettings, family: AdaptiveContextSourceFamily): boolean {
  switch (family) {
    case "surface_metadata":
      return false;
    case "document_knowledge":
    case "local_notes_markdown":
    case "work_tracker_dev_platform":
    case "design_dev_tool":
    case "calendar_meeting":
    case "communication_metadata":
      return settings.sourceFamilies[family];
  }
}

function recordDecision(
  summary: MutableSummary,
  decision: AdaptiveProviderPolicyDecision,
  reasons: readonly ContentContextDropReason[],
): void {
  summary.decisionCounts[decision] += 1;
  recordReasons(summary, reasons);
}

function recordReasons(summary: MutableSummary, reasons: readonly ContentContextDropReason[]): void {
  for (const reason of reasons) {
    summary.dropReasonCounts[reason] = (summary.dropReasonCounts[reason] ?? 0) + 1;
  }
}

function emptySummary(): MutableSummary {
  return {
    decisionCounts: { send: 0, metadata_only: 0, local_only: 0, blocked: 0 },
    dropReasonCounts: {},
    providerSafeItemCount: 0,
    redactionCount: 0,
    maxDepthSent: null,
  };
}

function isProviderVisible(decision: AdaptiveProviderPolicyDecision): decision is ProviderVisibleDecision {
  return decision === "send" || decision === "metadata_only";
}

function isProviderVisibleItemDecision(decision: ItemDecision): decision is ProviderVisibleItemDecision {
  return isProviderVisible(decision.decision);
}

function maxDepth(current: 1 | 2 | 3 | null, next: AdaptiveContextItem["depth"]): 1 | 2 | 3 | null {
  if (next === 0) return current;
  return current === null || next > current ? next : current;
}
