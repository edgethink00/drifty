import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_CONTEXT_BLOCKED_SOURCE_EXAMPLES,
  ADAPTIVE_CONTEXT_DEPTH_POLICIES,
  CONTENT_CONTEXT_TERMS,
  adaptiveRetryEligibility,
  isProviderVisibleDecision,
  sourceFamilyPolicy,
  type AdaptiveContextItem,
} from "./adaptiveContentContext";

describe("adaptive content context terminology", () => {
  it("distinguishes current Content context from Enhanced context", () => {
    // Given: the shared terms used by settings, domain, and classification code.
    const current = CONTENT_CONTEXT_TERMS.currentContentContext;
    const enhanced = CONTENT_CONTEXT_TERMS.enhancedContext;

    // When: consumers read the terminology contract.
    // Then: current Content context stays limited to existing title and YouTube metadata.
    expect(current.providerVisibility).toBe("first_pass_optional");
    expect(current.fields).toContain("siteTitle");
    expect(current.fields).toContain("youtubeChannelName");
    expect(current.excludedFields).toContain("documentBody");
    expect(current.excludedFields).toContain("notionBody");

    // Then: Enhanced context is local derived evidence for a gated retry, not first-pass payload.
    expect(enhanced.providerVisibility).toBe("local_first_enhanced_retry_only");
    expect(enhanced.devGated).toBe(true);
    expect(enhanced.firstPassProviderVisible).toBe(false);
    expect(enhanced.excludedFields).toContain("rawFullPageText");
  });

  it("models Depth 0 through Depth 3 without double-counting existing surface metadata", () => {
    // Given: one fixture item for each internal depth.
    const items: readonly AdaptiveContextItem[] = [
      {
        id: "depth-0-window-title",
        depth: 0,
        kind: "windowTitle",
        sourceFamily: "surface_metadata",
        values: ["Reddit - Product research - Arc"],
        extractionConfidence: "high",
        localStorage: "not_persisted_current_payload",
        providerPolicy: "metadata_only",
        sensitivity: [],
      },
      {
        id: "depth-1-parent-page",
        depth: 1,
        kind: "parentPage",
        sourceFamily: "document_knowledge",
        values: ["Product research"],
        extractionConfidence: "medium",
        localStorage: "stored_local",
        providerPolicy: "metadata_only",
        sensitivity: [],
      },
      {
        id: "depth-2-heading",
        depth: 2,
        kind: "heading",
        sourceFamily: "document_knowledge",
        values: ["Moderator outreach"],
        extractionConfidence: "medium",
        localStorage: "stored_local",
        providerPolicy: "metadata_only",
        sensitivity: [],
      },
      {
        id: "depth-3-short-hint",
        depth: 3,
        kind: "shortVisibleHint",
        sourceFamily: "document_knowledge",
        values: ["Researching communities for launch planning"],
        extractionConfidence: "low",
        localStorage: "stored_local",
        providerPolicy: "local_only",
        sensitivity: [],
      },
    ];

    // When: consumers inspect depth policy.
    const depth0 = ADAPTIVE_CONTEXT_DEPTH_POLICIES[0];
    const depth3 = ADAPTIVE_CONTEXT_DEPTH_POLICIES[3];

    // Then: every depth is represented and Depth 0 remains current surface metadata.
    expect(items.map((item) => item.depth)).toEqual([0, 1, 2, 3]);
    expect(depth0.signalOrigin).toBe("existing_surface_metadata");
    expect(depth0.countsAsNewEnhancedSignal).toBe(false);
    expect(depth3.maxProviderCharacters).toBe(240);
    expect(depth3.examples).toContain("safe keyword summary");
  });

  it("keeps source-family defaults explicit for document, work, and communication surfaces", () => {
    // Given: source-family policy is shared before adapters or provider egress exist.
    const documentPolicy = sourceFamilyPolicy("document_knowledge");
    const workPolicy = sourceFamilyPolicy("work_tracker_dev_platform");
    const communicationPolicy = sourceFamilyPolicy("communication_metadata");

    // When/Then: document and work families may store derived context locally.
    expect(documentPolicy.localCaptureDefault).toBe("store_depth_1_2");
    expect(documentPolicy.allowedDepths).toEqual([1, 2, 3]);
    expect(workPolicy.providerRetryDefault).toBe("metadata_only");
    expect(workPolicy.allowedItemKinds).toContain("label");

    // Then: communication metadata never authorizes message-body provider egress.
    expect(communicationPolicy.providerRetryDefault).toBe("local_only");
    expect(communicationPolicy.blockedItemKinds).toContain("messageBody");
  });

  it("marks only low-confidence or unknown first-pass results eligible for one enhanced retry", () => {
    // Given: retry toggle is on, provider-safe context exists, and the first pass is uncertain.
    const unknownResult = adaptiveRetryEligibility({
      retryEnabled: true,
      alreadyRetried: false,
      category: "unknown",
      confidence: 0.5,
      evidence: "normal",
      providerSafeContextItemCount: 2,
      threshold: 0.55,
    });

    // When/Then: unknown or low-confidence results are eligible.
    expect(unknownResult).toEqual({ kind: "eligible", reason: "unknown_category" });
    expect(
      adaptiveRetryEligibility({
        retryEnabled: true,
        alreadyRetried: false,
        category: "workspace",
        confidence: 0.55,
        evidence: "normal",
        providerSafeContextItemCount: 1,
        threshold: 0.55,
      }),
    ).toEqual({ kind: "eligible", reason: "low_confidence" });

    // Then: high-confidence or already retried results stay ineligible.
    expect(
      adaptiveRetryEligibility({
        retryEnabled: true,
        alreadyRetried: false,
        category: "workspace",
        confidence: 0.9,
        evidence: "normal",
        providerSafeContextItemCount: 1,
        threshold: 0.55,
      }),
    ).toEqual({ kind: "ineligible", reason: "high_confidence" });
    expect(
      adaptiveRetryEligibility({
        retryEnabled: true,
        alreadyRetried: true,
        category: "unknown",
        confidence: 0.4,
        evidence: "normal",
        providerSafeContextItemCount: 1,
        threshold: 0.55,
      }),
    ).toEqual({ kind: "ineligible", reason: "already_retried" });
  });

  it("keeps blocked sensitive-source examples provider-invisible", () => {
    // Given: source policy ships with concrete blocked examples for future adapters.
    const exampleIds = ADAPTIVE_CONTEXT_BLOCKED_SOURCE_EXAMPLES.map((example) => example.id);

    // When/Then: sensitive surfaces are represented and default to provider-invisible decisions.
    expect(exampleIds).toContain("chat_message_body");
    expect(exampleIds).toContain("email_message_body");
    expect(exampleIds).toContain("auth_password_surface");
    expect(exampleIds).toContain("payment_finance_surface");
    expect(ADAPTIVE_CONTEXT_BLOCKED_SOURCE_EXAMPLES.every((example) => !isProviderVisibleDecision(example.defaultProviderPolicy))).toBe(true);
    expect(ADAPTIVE_CONTEXT_BLOCKED_SOURCE_EXAMPLES.every((example) => example.blockedDepths.includes(3))).toBe(true);
  });
});
