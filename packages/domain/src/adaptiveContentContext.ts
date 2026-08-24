import type { ActivityCategory } from "./activity";

export const CURRENT_CONTENT_CONTEXT_FIELDS = ["siteTitle", "youtubeTitle", "youtubeChannelName", "youtubeCategory"] as const;
export type CurrentContentContextField = (typeof CURRENT_CONTENT_CONTEXT_FIELDS)[number];

export const ENHANCED_CONTENT_CONTEXT_FIELDS = ["container", "structure", "shortHint"] as const;
export type EnhancedContentContextField = (typeof ENHANCED_CONTENT_CONTEXT_FIELDS)[number];

export const EXCLUDED_CONTENT_CONTEXT_FIELDS = ["documentBody", "notionBody", "obsidianBody", "messageBody", "rawFullPageText"] as const;
export type ExcludedContentContextField = (typeof EXCLUDED_CONTENT_CONTEXT_FIELDS)[number];

type ContentContextTermBase = {
  readonly devGated: boolean;
  readonly firstPassProviderVisible: boolean;
  readonly excludedFields: readonly ExcludedContentContextField[];
};

export type CurrentContentContextTerm = ContentContextTermBase & {
  readonly kind: "current_content_context";
  readonly providerVisibility: "first_pass_optional";
  readonly fields: readonly CurrentContentContextField[];
};

export type EnhancedContentContextTerm = ContentContextTermBase & {
  readonly kind: "enhanced_context";
  readonly providerVisibility: "local_first_enhanced_retry_only";
  readonly fields: readonly EnhancedContentContextField[];
};

export type ContentContextTerm = CurrentContentContextTerm | EnhancedContentContextTerm;

export const CONTENT_CONTEXT_TERMS: {
  readonly currentContentContext: CurrentContentContextTerm;
  readonly enhancedContext: EnhancedContentContextTerm;
} = {
  currentContentContext: {
    kind: "current_content_context",
    providerVisibility: "first_pass_optional",
    devGated: false,
    firstPassProviderVisible: true,
    fields: CURRENT_CONTENT_CONTEXT_FIELDS,
    excludedFields: EXCLUDED_CONTENT_CONTEXT_FIELDS,
  },
  enhancedContext: {
    kind: "enhanced_context",
    providerVisibility: "local_first_enhanced_retry_only",
    devGated: false,
    firstPassProviderVisible: false,
    fields: ENHANCED_CONTENT_CONTEXT_FIELDS,
    excludedFields: EXCLUDED_CONTENT_CONTEXT_FIELDS,
  },
};

export const ADAPTIVE_CONTEXT_DEPTHS = [0, 1, 2, 3] as const;
export type AdaptiveContextDepth = (typeof ADAPTIVE_CONTEXT_DEPTHS)[number];
export type AdaptiveSignalOrigin = "existing_surface_metadata" | "local_derived_context";

export type AdaptiveContextDepthPolicy = {
  readonly depth: AdaptiveContextDepth;
  readonly signalOrigin: AdaptiveSignalOrigin;
  readonly countsAsNewEnhancedSignal: boolean;
  readonly maxProviderCharacters: number | null;
  readonly examples: readonly string[];
};

export const ADAPTIVE_CONTEXT_DEPTH_POLICIES: Readonly<Record<AdaptiveContextDepth, AdaptiveContextDepthPolicy>> = {
  0: { depth: 0, signalOrigin: "existing_surface_metadata", countsAsNewEnhancedSignal: false, maxProviderCharacters: null, examples: ["app name", "bundle id", "window title", "site domain", "sanitized site URL", "site title", "YouTube title/channel/category"] },
  1: { depth: 1, signalOrigin: "local_derived_context", countsAsNewEnhancedSignal: true, maxProviderCharacters: null, examples: ["workspace", "parent page", "database/project", "folder/vault", "repo/project"] },
  2: { depth: 2, signalOrigin: "local_derived_context", countsAsNewEnhancedSignal: true, maxProviderCharacters: null, examples: ["headings/outline", "tags", "labels", "status", "document/page type", "visible section names"] },
  3: { depth: 3, signalOrigin: "local_derived_context", countsAsNewEnhancedSignal: true, maxProviderCharacters: 240, examples: ["short selected snippet", "short visible hint", "intro snippet", "safe keyword summary"] },
};

export const ADAPTIVE_CONTEXT_SOURCE_FAMILIES = [
  "surface_metadata",
  "document_knowledge",
  "local_notes_markdown",
  "work_tracker_dev_platform",
  "design_dev_tool",
  "calendar_meeting",
  "communication_metadata",
  "ai_conversation",
  "developer_workspace",
  "document_editor",
] as const;
export type AdaptiveContextSourceFamily = (typeof ADAPTIVE_CONTEXT_SOURCE_FAMILIES)[number];

export const DEPTH_0_ITEM_KINDS = ["appName", "bundleId", "windowTitle", "siteDomain", "siteUrl", "siteTitle", "youtubeTitle", "youtubeChannelName", "youtubeCategory"] as const;
export type AdaptiveDepth0ContextItemKind = (typeof DEPTH_0_ITEM_KINDS)[number];

export const DEPTH_1_ITEM_KINDS = ["workspace", "parentPage", "database", "project", "folder", "vault", "repo", "team", "channel", "thread", "document"] as const;
export type AdaptiveDepth1ContextItemKind = (typeof DEPTH_1_ITEM_KINDS)[number];

export const DEPTH_2_ITEM_KINDS = ["heading", "tag", "label", "status", "documentType", "issueType", "visibleSection", "meetingType", "attendeeCountRange", "pageType", "layerType", "channelType", "conversationType"] as const;
export type AdaptiveDepth2ContextItemKind = (typeof DEPTH_2_ITEM_KINDS)[number];

export const DEPTH_3_ITEM_KINDS = ["shortSelectedHint", "shortVisibleHint", "introHint", "safeKeywordSummary", "messageBody"] as const;
export type AdaptiveDepth3ContextItemKind = (typeof DEPTH_3_ITEM_KINDS)[number];

export type AdaptiveContextItemKind = AdaptiveDepth0ContextItemKind | AdaptiveDepth1ContextItemKind | AdaptiveDepth2ContextItemKind | AdaptiveDepth3ContextItemKind;

export const ADAPTIVE_PROVIDER_POLICY_DECISIONS = ["send", "metadata_only", "local_only", "blocked"] as const;
export type AdaptiveProviderPolicyDecision = (typeof ADAPTIVE_PROVIDER_POLICY_DECISIONS)[number];

export const ADAPTIVE_SENSITIVITY_FLAGS = ["auth", "password", "payment", "health", "legal", "hr", "finance", "message_body", "secret_like", "personal_identifier"] as const;
export type AdaptiveSensitivityFlag = (typeof ADAPTIVE_SENSITIVITY_FLAGS)[number];

export const ADAPTIVE_EXTRACTION_CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"] as const;
export type AdaptiveExtractionConfidence = (typeof ADAPTIVE_EXTRACTION_CONFIDENCE_LEVELS)[number];

export const ADAPTIVE_LOCAL_STORAGE_STATUSES = ["not_persisted_current_payload", "stored_local", "dropped", "expired", "disabled"] as const;
export type AdaptiveLocalStorageStatus = (typeof ADAPTIVE_LOCAL_STORAGE_STATUSES)[number];

type AdaptiveContextItemBase = {
  readonly id: string;
  readonly sourceFamily: AdaptiveContextSourceFamily;
  readonly values: readonly string[];
  readonly extractionConfidence: AdaptiveExtractionConfidence;
  readonly localStorage: AdaptiveLocalStorageStatus;
  readonly providerPolicy: AdaptiveProviderPolicyDecision;
  readonly sensitivity: readonly AdaptiveSensitivityFlag[];
};

export type AdaptiveContextItem =
  | (AdaptiveContextItemBase & { readonly depth: 0; readonly kind: AdaptiveDepth0ContextItemKind })
  | (AdaptiveContextItemBase & { readonly depth: 1; readonly kind: AdaptiveDepth1ContextItemKind })
  | (AdaptiveContextItemBase & { readonly depth: 2; readonly kind: AdaptiveDepth2ContextItemKind })
  | (AdaptiveContextItemBase & { readonly depth: 3; readonly kind: AdaptiveDepth3ContextItemKind });

export type AdaptiveContentContext = {
  readonly version: 1;
  readonly segmentId: string;
  readonly collectedAt: string;
  readonly items: readonly AdaptiveContextItem[];
  readonly localStorage: AdaptiveLocalStorageStatus;
};

export type AdaptiveLocalCaptureDefault = "depth_0_current_payload" | "store_depth_1_2" | "metadata_only" | "local_only";

export type AdaptiveSourceFamilyPolicy = {
  readonly family: AdaptiveContextSourceFamily;
  readonly localCaptureDefault: AdaptiveLocalCaptureDefault;
  readonly providerRetryDefault: AdaptiveProviderPolicyDecision;
  readonly allowedDepths: readonly AdaptiveContextDepth[];
  readonly allowedItemKinds: readonly AdaptiveContextItemKind[];
  readonly blockedItemKinds: readonly AdaptiveContextItemKind[];
};

const BODY_ITEM_KINDS = ["messageBody"] as const;
const DOCUMENT_ITEM_KINDS = ["workspace", "parentPage", "database", "project", "heading", "tag", "status", "documentType", "visibleSection", "shortSelectedHint", "shortVisibleHint", "introHint", "safeKeywordSummary"] as const;
const LOCAL_NOTES_ITEM_KINDS = ["folder", "vault", "project", "heading", "tag", "documentType", "visibleSection", "shortVisibleHint", "safeKeywordSummary"] as const;
const WORK_TRACKER_ITEM_KINDS = ["project", "repo", "heading", "tag", "label", "status", "issueType", "visibleSection", "shortVisibleHint", "safeKeywordSummary"] as const;
const DESIGN_DEV_ITEM_KINDS = ["workspace", "project", "folder", "repo", "visibleSection", "documentType", "pageType", "layerType", "tag", "label"] as const;
const CALENDAR_ITEM_KINDS = ["workspace", "project", "documentType", "meetingType", "attendeeCountRange", "tag"] as const;
// `channelType` carries dm/channel/folder shape without naming the DM peer or mail thread.
const COMMUNICATION_ITEM_KINDS = ["workspace", "team", "channel", "thread", "channelType"] as const;
const AI_CONVERSATION_ITEM_KINDS = ["workspace", "thread", "conversationType"] as const;
const DEVELOPER_WORKSPACE_ITEM_KINDS = ["workspace", "project", "repo"] as const;
const DOCUMENT_EDITOR_ITEM_KINDS = ["workspace", "document", "documentType"] as const;

export const ADAPTIVE_CONTEXT_SOURCE_FAMILY_POLICIES: Readonly<Record<AdaptiveContextSourceFamily, AdaptiveSourceFamilyPolicy>> = {
  surface_metadata: { family: "surface_metadata", localCaptureDefault: "depth_0_current_payload", providerRetryDefault: "metadata_only", allowedDepths: [0], allowedItemKinds: DEPTH_0_ITEM_KINDS, blockedItemKinds: [] },
  document_knowledge: { family: "document_knowledge", localCaptureDefault: "store_depth_1_2", providerRetryDefault: "metadata_only", allowedDepths: [1, 2, 3], allowedItemKinds: DOCUMENT_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  local_notes_markdown: { family: "local_notes_markdown", localCaptureDefault: "store_depth_1_2", providerRetryDefault: "metadata_only", allowedDepths: [1, 2, 3], allowedItemKinds: LOCAL_NOTES_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  work_tracker_dev_platform: { family: "work_tracker_dev_platform", localCaptureDefault: "store_depth_1_2", providerRetryDefault: "metadata_only", allowedDepths: [1, 2, 3], allowedItemKinds: WORK_TRACKER_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  design_dev_tool: { family: "design_dev_tool", localCaptureDefault: "metadata_only", providerRetryDefault: "metadata_only", allowedDepths: [1, 2], allowedItemKinds: DESIGN_DEV_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  calendar_meeting: { family: "calendar_meeting", localCaptureDefault: "metadata_only", providerRetryDefault: "metadata_only", allowedDepths: [1, 2], allowedItemKinds: CALENDAR_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  communication_metadata: { family: "communication_metadata", localCaptureDefault: "store_depth_1_2", providerRetryDefault: "metadata_only", allowedDepths: [1, 2], allowedItemKinds: COMMUNICATION_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  ai_conversation: { family: "ai_conversation", localCaptureDefault: "metadata_only", providerRetryDefault: "metadata_only", allowedDepths: [1, 2], allowedItemKinds: AI_CONVERSATION_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  developer_workspace: { family: "developer_workspace", localCaptureDefault: "metadata_only", providerRetryDefault: "metadata_only", allowedDepths: [1, 2], allowedItemKinds: DEVELOPER_WORKSPACE_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
  document_editor: { family: "document_editor", localCaptureDefault: "metadata_only", providerRetryDefault: "metadata_only", allowedDepths: [1, 2], allowedItemKinds: DOCUMENT_EDITOR_ITEM_KINDS, blockedItemKinds: BODY_ITEM_KINDS },
};

export function sourceFamilyPolicy(family: AdaptiveContextSourceFamily): AdaptiveSourceFamilyPolicy {
  return ADAPTIVE_CONTEXT_SOURCE_FAMILY_POLICIES[family];
}

export type AdaptiveRetryEvidence = "normal" | "insufficient";

export type AdaptiveRetryEligibilityInput = {
  readonly retryEnabled: boolean;
  readonly alreadyRetried: boolean;
  readonly category: ActivityCategory;
  readonly confidence: number;
  readonly evidence: AdaptiveRetryEvidence;
  readonly providerSafeContextItemCount: number;
  readonly threshold: number;
};

export type AdaptiveRetryEligibility =
  | { readonly kind: "eligible"; readonly reason: "unknown_category" | "low_confidence" | "insufficient_evidence" }
  | { readonly kind: "ineligible"; readonly reason: "retry_disabled" | "already_retried" | "no_provider_safe_context" | "high_confidence" };

export function adaptiveRetryEligibility(input: AdaptiveRetryEligibilityInput): AdaptiveRetryEligibility {
  if (!input.retryEnabled) return { kind: "ineligible", reason: "retry_disabled" };
  if (input.alreadyRetried) return { kind: "ineligible", reason: "already_retried" };
  if (input.providerSafeContextItemCount <= 0) return { kind: "ineligible", reason: "no_provider_safe_context" };
  if (input.category === "unknown") return { kind: "eligible", reason: "unknown_category" };
  if (input.evidence === "insufficient") return { kind: "eligible", reason: "insufficient_evidence" };
  if (input.confidence <= input.threshold) return { kind: "eligible", reason: "low_confidence" };
  return { kind: "ineligible", reason: "high_confidence" };
}

export type AdaptiveBlockedSourceExample = {
  readonly id: string;
  readonly family: AdaptiveContextSourceFamily;
  readonly sensitivity: readonly AdaptiveSensitivityFlag[];
  readonly blockedDepths: readonly AdaptiveContextDepth[];
  readonly defaultProviderPolicy: AdaptiveProviderPolicyDecision;
};

export const ADAPTIVE_CONTEXT_BLOCKED_SOURCE_EXAMPLES: readonly AdaptiveBlockedSourceExample[] = [
  { id: "chat_message_body", family: "communication_metadata", sensitivity: ["message_body"], blockedDepths: [3], defaultProviderPolicy: "blocked" },
  { id: "email_message_body", family: "communication_metadata", sensitivity: ["message_body", "personal_identifier"], blockedDepths: [3], defaultProviderPolicy: "blocked" },
  { id: "auth_password_surface", family: "surface_metadata", sensitivity: ["auth", "password", "secret_like"], blockedDepths: [1, 2, 3], defaultProviderPolicy: "blocked" },
  { id: "payment_finance_surface", family: "surface_metadata", sensitivity: ["payment", "finance", "personal_identifier"], blockedDepths: [1, 2, 3], defaultProviderPolicy: "blocked" },
  { id: "health_legal_hr_surface", family: "surface_metadata", sensitivity: ["health", "legal", "hr", "personal_identifier"], blockedDepths: [1, 2, 3], defaultProviderPolicy: "local_only" },
];

export function isProviderVisibleDecision(decision: AdaptiveProviderPolicyDecision): boolean {
  switch (decision) {
    case "send":
    case "metadata_only":
      return true;
    case "local_only":
    case "blocked":
      return false;
    default:
      return assertNeverProviderPolicyDecision(decision);
  }
}

class AdaptiveProviderPolicyDecisionError extends Error {
  constructor(readonly decision: never) {
    super(`Unhandled adaptive provider policy decision: ${decision}`);
    this.name = "AdaptiveProviderPolicyDecisionError";
  }
}

function assertNeverProviderPolicyDecision(decision: never): never {
  throw new AdaptiveProviderPolicyDecisionError(decision);
}
