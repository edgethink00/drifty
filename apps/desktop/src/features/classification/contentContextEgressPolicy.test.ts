import type { ActivityCategory, AdaptiveContentContext, AdaptiveContextItem } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import type { EnhancedContextSettings } from "../settings/settingsStorage";
import {
  buildProviderSafeEnhancedContext,
  enhancedContextRetryEligibility,
} from "./contentContextEgressPolicy";

const enabledSettings: EnhancedContextSettings = {
  enabled: true,
  captureLocal: true,
  retryLowConfidence: true,
  debugLogging: true,
  sourceFamilies: {
    document_knowledge: true,
    local_notes_markdown: true,
    work_tracker_dev_platform: true,
    design_dev_tool: true,
    calendar_meeting: true,
    communication_metadata: true,
    ai_conversation: true,
    developer_workspace: true,
    document_editor: true,
  },
};

const disabledSettings: EnhancedContextSettings = {
  ...enabledSettings,
  enabled: false,
  retryLowConfidence: false,
};

function context(items: readonly AdaptiveContextItem[]): AdaptiveContentContext {
  return {
    version: 1,
    segmentId: "segment-1",
    collectedAt: "2026-07-08T09:00:00.000Z",
    localStorage: "stored_local",
    items,
  };
}

const notionParentPage = {
  id: "notion-parent",
  depth: 1,
  kind: "parentPage",
  sourceFamily: "document_knowledge",
  values: ["Product research"],
  extractionConfidence: "high",
  localStorage: "stored_local",
  providerPolicy: "metadata_only",
  sensitivity: [],
} satisfies AdaptiveContextItem;

const notionHeading = {
  id: "notion-heading",
  depth: 2,
  kind: "heading",
  sourceFamily: "document_knowledge",
  values: ["Moderator outreach", "Subreddits"],
  extractionConfidence: "medium",
  localStorage: "stored_local",
  providerPolicy: "metadata_only",
  sensitivity: [],
} satisfies AdaptiveContextItem;

describe("contentContextEgressPolicy", () => {
  it("removes account addresses in historical metadata even without sensitivity flags", () => {
    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry", settings: enabledSettings,
      context: context([{ ...notionParentPage, sourceFamily: "calendar_meeting", kind: "workspace",
        values: ["person@example.test", "Planning for another@example.test", "Work calendar", "학습@예시.한국"] }]),
    });
    const sent = JSON.stringify(result.providerContext);
    expect(sent).not.toContain("@example.test");
    expect(sent).not.toContain("학습@예시.한국");
    expect(sent).toContain("Work calendar");
    expect(result.summary.redactionCount).toBe(3);
    expect(result.summary.dropReasonCounts.personal_identifier).toBe(3);
  });

  it("returns no enhanced provider context for first-pass mode", () => {
    const result = buildProviderSafeEnhancedContext({
      mode: "first_pass",
      settings: enabledSettings,
      context: context([notionParentPage, notionHeading]),
    });

    expect(result.providerContext).toBeNull();
    expect(result.summary.providerSafeItemCount).toBe(0);
    expect(result.summary.dropReasonCounts.first_pass).toBe(2);
  });

  it("allows Notion-like Depth 1-2 metadata only in enhanced retry mode", () => {
    const firstPass = buildProviderSafeEnhancedContext({
      mode: "first_pass",
      settings: enabledSettings,
      context: context([notionParentPage, notionHeading]),
    });
    const enhancedRetry = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([notionParentPage, notionHeading]),
    });

    expect(firstPass.providerContext).toBeNull();
    expect(enhancedRetry.providerContext?.items.map((item) => item.kind)).toEqual(["parentPage", "heading"]);
    expect(enhancedRetry.providerContext?.items.map((item) => item.decision)).toEqual(["metadata_only", "metadata_only"]);
    expect(enhancedRetry.summary.decisionCounts.metadata_only).toBe(2);
  });

  it("promotes Depth 3 only for allowed document and work surfaces", () => {
    const safeDocumentHint = {
      id: "safe-doc-hint",
      depth: 3,
      kind: "safeKeywordSummary",
      sourceFamily: "document_knowledge",
      values: ["research launch communities"],
      extractionConfidence: "medium",
      localStorage: "stored_local",
      providerPolicy: "send",
      sensitivity: [],
    } satisfies AdaptiveContextItem;
    const chatBody = {
      id: "chat-body",
      depth: 3,
      kind: "messageBody",
      sourceFamily: "communication_metadata",
      values: ["raw Slack body: the card number is 4242 4242 4242 4242"],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "blocked",
      sensitivity: ["message_body"],
    } satisfies AdaptiveContextItem;
    const authHint = {
      ...safeDocumentHint,
      id: "auth-hint",
      values: ["password reset one-time code 123456"],
      sensitivity: ["auth", "password"],
    } satisfies AdaptiveContextItem;
    const paymentHint = {
      ...safeDocumentHint,
      id: "payment-hint",
      values: ["checkout card verification"],
      sensitivity: ["payment", "finance"],
    } satisfies AdaptiveContextItem;

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([safeDocumentHint, chatBody, authHint, paymentHint]),
    });

    expect(result.providerContext?.items).toHaveLength(1);
    expect(result.providerContext?.items[0]?.values).toEqual(["research launch communities"]);
    expect(result.summary.decisionCounts.send).toBe(1);
    expect(result.summary.decisionCounts.blocked).toBeGreaterThanOrEqual(2);
    expect(result.summary.dropReasonCounts.sensitive_surface).toBeGreaterThanOrEqual(3);
  });

  it("drops local-only provider policy items before provider egress", () => {
    const localOnlyHint = {
      id: "safe-doc-hint",
      depth: 3,
      kind: "safeKeywordSummary",
      sourceFamily: "document_knowledge",
      values: ["research launch communities"],
      extractionConfidence: "medium",
      localStorage: "stored_local",
      providerPolicy: "local_only",
      sensitivity: [],
    } satisfies AdaptiveContextItem;

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([localOnlyHint]),
    });

    expect(result.providerContext).toBeNull();
    expect(result.summary.decisionCounts.local_only).toBe(1);
    expect(result.summary.providerSafeItemCount).toBe(0);
    expect(result.summary.dropReasonCounts.provider_policy_local_only).toBe(1);
  });

  it("sanitizes URLs and removes secret-like values before provider egress", () => {
    const urlItem = {
      ...notionParentPage,
      values: ["https://alice:secret@notion.so/Product/Research?token=abc#private"],
    } satisfies AdaptiveContextItem;
    const secretItem = {
      ...notionHeading,
      values: [
        "Launch API key sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        "SSN 123-45-6789 and OTP 123456",
        "safe visible heading",
      ],
    } satisfies AdaptiveContextItem;

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([urlItem, secretItem]),
    });
    const values = result.providerContext?.items.flatMap((item) => item.values).join(" ") ?? "";

    expect(values).toContain("https://notion.so/Product/Research");
    expect(values).not.toContain("alice");
    expect(values).not.toContain("token=abc");
    expect(values).not.toContain("#private");
    expect(values).not.toContain("sk-proj");
    expect(values).not.toContain("123-45-6789");
    expect(values).not.toContain("OTP 123456");
    expect(result.summary.redactionCount).toBeGreaterThanOrEqual(3);
  });

  it("sanitizes embedded URLs inside provider-visible headings labels and hints", () => {
    const unsafeUrl = "https://user:pass@example.com/path?token=abc#frag";
    const unsafeUrlPartsArePresent = (value: string): boolean =>
      value.includes("user:pass")
      || value.includes("token=")
      || value.includes("#frag")
      || value.includes("person:credential")
      || value.includes("api_key=")
      || value.includes("#comment")
      || value.includes("reader:pw")
      || value.includes("authToken=")
      || value.includes("#outline");
    const headingWithEmbeddedUrl = {
      ...notionHeading,
      values: [`see ${unsafeUrl} now`],
    } satisfies AdaptiveContextItem;
    const tagWithEmbeddedUrl = {
      id: "issue-tag",
      depth: 2,
      kind: "tag",
      sourceFamily: "document_knowledge",
      values: [`research ${unsafeUrl}`],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    } satisfies AdaptiveContextItem;
    const labelWithEmbeddedUrl = {
      id: "issue-label",
      depth: 2,
      kind: "label",
      sourceFamily: "work_tracker_dev_platform",
      values: ["triage https://person:credential@linear.app/team/ABC?api_key=secret#comment"],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    } satisfies AdaptiveContextItem;
    const hintWithEmbeddedUrl = {
      id: "safe-doc-hint",
      depth: 3,
      kind: "safeKeywordSummary",
      sourceFamily: "document_knowledge",
      values: ["research note links https://reader:pw@docs.example.org/launch?authToken=private#outline"],
      extractionConfidence: "medium",
      localStorage: "stored_local",
      providerPolicy: "send",
      sensitivity: [],
    } satisfies AdaptiveContextItem;

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([headingWithEmbeddedUrl, tagWithEmbeddedUrl, labelWithEmbeddedUrl, hintWithEmbeddedUrl]),
    });
    const values = result.providerContext?.items.flatMap((item) => item.values).join(" ") ?? "";

    expect(values.includes("see https://example.com/path now")).toBe(true);
    expect(values.includes("research https://example.com/path")).toBe(true);
    expect(values.includes("triage https://linear.app/team/ABC")).toBe(true);
    expect(values.includes("research note links https://docs.example.org/launch")).toBe(true);
    expect(unsafeUrlPartsArePresent(values)).toBe(false);
    expect(result.summary.redactionCount).toBeGreaterThanOrEqual(3);
  });

  it("redacts short password-like key value strings from provider-visible unflagged items", () => {
    const unflaggedCredentials = {
      ...notionHeading,
      id: "unflagged-credentials",
      values: ["password=hunter2", "pwd: 1234", "passcode abc123", "password reset guidance"],
      sensitivity: [],
    } satisfies AdaptiveContextItem;

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([unflaggedCredentials]),
    });
    const values = result.providerContext?.items.flatMap((item) => item.values).join(" ") ?? "";

    expect(values).not.toContain("hunter2");
    expect(values).not.toContain("1234");
    expect(values).not.toContain("abc123");
    expect(values).toContain("password reset guidance");
    expect(result.summary.redactionCount).toBe(3);
    expect(result.summary.dropReasonCounts.secret_like_value).toBe(3);
  });

  it("redacts adjacent short secret key value strings without dropping benign prose", () => {
    const shortSecretCredentials = [{
      ...notionHeading,
      id: "short-secret-credentials-a",
      values: [
        "pass=abcd",
        "token=abcd1234",
        "api_key: abcd1234",
        "api-key abcd1234",
        "token bucket algorithm",
      ],
      sensitivity: [],
    }, {
      ...notionHeading,
      id: "short-secret-credentials-b",
      values: [
        "api key = abcd1234",
        "secret: abcd1234",
        "client_secret abcd1234",
        "access_token=abcd1234",
        "secret management policy",
      ],
      sensitivity: [],
    }, {
      ...notionHeading,
      id: "short-secret-credentials-c",
      values: ["refresh_token: abcd1234", "auth_token abcd1234", "password reset guidance"],
      sensitivity: [],
    }] satisfies readonly AdaptiveContextItem[];

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context(shortSecretCredentials),
    });
    const values = result.providerContext?.items.flatMap((item) => item.values).join(" ") ?? "";

    expect(values).not.toContain("abcd");
    expect(values).not.toContain("abcd1234");
    expect(values).toContain("token bucket algorithm");
    expect(values).toContain("secret management policy");
    expect(values).toContain("password reset guidance");
    expect(result.summary.redactionCount).toBe(10);
    expect(result.summary.dropReasonCounts.secret_like_value).toBe(10);
  });

  it("keeps provider policy independent from dogfood capture and respects the internal kill switch", () => {
    const captureDisabled = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: { ...enabledSettings, captureLocal: false },
      context: context([notionParentPage]),
    });
    const toggleDisabled = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: disabledSettings,
      context: context([notionParentPage]),
    });

    expect(captureDisabled.providerContext?.items).toHaveLength(1);
    expect(toggleDisabled.providerContext).toBeNull();
    expect(toggleDisabled.summary.dropReasonCounts.enhanced_context_disabled).toBe(1);
  });

  it("does not pass blocked raw collector output through", () => {
    const rawCollectorBody = {
      id: "raw-body",
      depth: 3,
      kind: "messageBody",
      sourceFamily: "communication_metadata",
      values: ["document.body.innerText raw body password=hunter2"],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "blocked",
      sensitivity: ["message_body", "secret_like"],
    } satisfies AdaptiveContextItem;

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([notionParentPage, rawCollectorBody]),
    });
    const serialized = JSON.stringify(result.providerContext);

    expect(serialized).toContain("Product research");
    expect(serialized).not.toContain("document.body.innerText");
    expect(serialized).not.toContain("hunter2");
    expect(result.summary.dropReasonCounts.raw_collector_output).toBe(1);
  });

  it("sends production communication shape and still withholds the body", () => {
    const shared = {
      sourceFamily: "communication_metadata",
      extractionConfidence: "medium",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    } as const;
    const workspace: AdaptiveContextItem = {
      ...shared, id: "communication_metadata:workspace", depth: 1, kind: "workspace", values: ["Northstar Lab"],
    };
    const channel: AdaptiveContextItem = {
      ...shared, id: "communication_metadata:channel", depth: 1, kind: "channel", values: ["students"],
    };
    const channelType: AdaptiveContextItem = {
      ...shared, id: "communication_metadata:channelType", depth: 2, kind: "channelType", values: ["channel"],
    };

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([workspace, channel, channelType]),
    });

    expect(result.providerContext?.items.map((item) => item.kind)).toEqual(["workspace", "channel", "channelType"]);
    expect(result.summary.decisionCounts.metadata_only).toBe(3);

    const withBody = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([{
        id: "communication_metadata:messageBody",
        depth: 3,
        kind: "messageBody",
        sourceFamily: "communication_metadata",
        values: ["standup notes from the team"],
        extractionConfidence: "medium",
        localStorage: "stored_local",
        providerPolicy: "blocked",
        sensitivity: ["message_body"],
      }]),
    });

    expect(withBody.providerContext).toBeNull();
    expect(JSON.stringify(withBody)).not.toContain("standup notes");
  });

  it("sends promoted extractor metadata only during enhanced retry", () => {
    const shared = {
      extractionConfidence: "medium",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    } as const;
    const dogfoodItems: AdaptiveContextItem[] = [
      { ...shared, id: "ai_conversation:thread", sourceFamily: "ai_conversation", depth: 1, kind: "thread", values: ["Migration strategy"] },
      { ...shared, id: "developer_workspace:workspace", sourceFamily: "developer_workspace", depth: 1, kind: "workspace", values: ["drifty_mac"] },
      { ...shared, id: "document_editor:documentType", sourceFamily: "document_editor", depth: 2, kind: "documentType", values: ["presentation"] },
    ];

    const enabled = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context(dogfoodItems),
    });
    expect(enabled.providerContext?.items.map((item) => item.sourceFamily)).toEqual([
      "ai_conversation",
      "developer_workspace",
      "document_editor",
    ]);
    expect(enabled.providerContext?.items.every((item) => item.decision === "metadata_only")).toBe(true);

    const disabled = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: {
        ...enabledSettings,
        sourceFamilies: {
          ...enabledSettings.sourceFamilies,
          ai_conversation: false,
          developer_workspace: false,
          document_editor: false,
        },
      },
      context: context(dogfoodItems),
    });
    expect(disabled.providerContext).toBeNull();
    expect(disabled.summary.dropReasonCounts.source_family_disabled).toBe(3);
  });

  it("keeps rows captured before the promotion local-only", () => {
    // Rows already on disk carry the old shape: the container sat in `thread`, the
    // channel kept its suffix, and every item was stamped local_only at capture time.
    const legacyItem = (kind: "channel" | "thread" | "workspace", values: readonly string[]): AdaptiveContextItem => ({
      id: `communication_metadata:${kind}`,
      depth: 1,
      kind,
      sourceFamily: "communication_metadata",
      values,
      extractionConfidence: "medium",
      localStorage: "stored_local",
      providerPolicy: "local_only",
      sensitivity: [],
    });

    const result = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([
        legacyItem("channel", ["students(채널)"]),
        legacyItem("thread", ["Northstar Lab"]),
        legacyItem("workspace", ["1개의 새 항목"]),
      ]),
    });

    // The stored policy still wins, so promoting the feature never retroactively
    // sends context that was captured under the old rules.
    expect(result.providerContext).toBeNull();
    expect(result.summary.dropReasonCounts.provider_policy_local_only).toBe(3);
  });

  it("maps provider-safe context count into deterministic retry eligibility", () => {
    const providerContext = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enabledSettings,
      context: context([notionParentPage]),
    }).providerContext;

    expect(
      enhancedContextRetryEligibility({
        settings: enabledSettings,
        alreadyRetried: false,
        category: "workspace" satisfies ActivityCategory,
        confidence: 0.55,
        evidence: "normal",
        threshold: 0.55,
        providerContext,
      }),
    ).toEqual({ kind: "eligible", reason: "low_confidence" });

    expect(
      enhancedContextRetryEligibility({
        settings: enabledSettings,
        alreadyRetried: false,
        category: "workspace",
        confidence: 0.9,
        evidence: "normal",
        threshold: 0.55,
        providerContext,
      }),
    ).toEqual({ kind: "ineligible", reason: "high_confidence" });
  });

  it("allows the shipped retry with production defaults", () => {
    const providerContext = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: { ...enabledSettings, captureLocal: false },
      context: context([notionParentPage]),
    }).providerContext;

    expect(providerContext?.items).toHaveLength(1);
    expect(
      enhancedContextRetryEligibility({
        settings: enabledSettings,
        alreadyRetried: false,
        category: "unknown",
        confidence: 0.5,
        evidence: "insufficient",
        threshold: 0.55,
        providerContext,
      }),
    ).toEqual({ kind: "eligible", reason: "unknown_category" });
  });
});
