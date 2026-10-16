import { describe, expect, it } from "vitest";
import type { AdaptiveContextItem } from "@drifty/domain";
import {
  buildProviderSafeEnhancedContext,
  type EnhancedContextProviderPayload,
} from "./contentContextEgressPolicy";
import {
  MANAGED_LOCAL_AI_CLASSIFICATION_MAX_BATCH_SIZE,
  MANAGED_LOCAL_AI_CLASSIFICATION_MAX_MEMORY_BYTES,
  MANAGED_LOCAL_AI_CLASSIFICATION_MAX_PROMPT_BYTES,
  MANAGED_LOCAL_AI_CLASSIFICATION_MAX_TOKENS,
  toLocalProviderEnhancedRetryRequest,
  toLocalProviderRequest,
  type LocalAiProviderRequest,
  type MinimizedActivityPayload,
} from "./localAiProviderRequest";
import type { EnhancedContextSettings } from "../settings/settingsStorage";

const basePayload: MinimizedActivityPayload = {
  segmentId: "segment-1",
  inputFingerprint: "fingerprint-1",
  startedAt: "2026-06-24T09:00:00.000Z",
  endedAt: "2026-06-24T09:05:00.000Z",
  durationSeconds: 300,
  appName: "Safari",
  bundleId: null,
  browserName: "Safari",
  siteDomain: "github.com",
  siteUrl: null,
  siteTitle: "Pull request",
  windowTitle: "Pull request",
  youtubeTitle: null,
  youtubeChannelName: null,
  youtubeCategory: null,
  youtubeIsShorts: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const enhancedContextSettings: EnhancedContextSettings = {
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

function promptFor(
  payload: readonly MinimizedActivityPayload[],
): string {
  const request = toLocalProviderRequest(
    { provider: "self_hosted", baseUrl: "http://127.0.0.1:11434", model: "qwen-test" },
    payload,
    null,
  );
  return promptFromRequest(request);
}

function enhancedRetryPromptFor(
  payload: readonly MinimizedActivityPayload[],
  enhancedRetryContext: EnhancedContextProviderPayload,
): string {
  const request = toLocalProviderEnhancedRetryRequest({
    provider: { provider: "self_hosted", baseUrl: "http://127.0.0.1:11434", model: "qwen-test" },
    payload,
    workProfile: null,
    enhancedRetryContext,
  });
  return promptFromRequest(request);
}

function promptFromRequest(request: LocalAiProviderRequest | null): string {
  expect(request).not.toBeNull();
  if (!request) return "";

  const messages = request.request["messages"];
  expect(Array.isArray(messages)).toBe(true);
  if (!Array.isArray(messages)) return "";

  const firstMessage = messages[0];
  expect(isRecord(firstMessage)).toBe(true);
  if (!isRecord(firstMessage)) return "";

  const content = firstMessage["content"];
  expect(typeof content).toBe("string");
  return typeof content === "string" ? content : "";
}

describe("toLocalProviderRequest", () => {
  it("adds an optional bearer key to custom-endpoint Classification requests", () => {
    const request = toLocalProviderRequest(
      {
        provider: "self_hosted",
        baseUrl: "https://models.example/v1",
        apiKey: "custom-session-key",
        model: "classification-model",
      },
      [basePayload],
      null,
    );

    expect(request?.request).toMatchObject({
      baseUrl: "https://models.example/v1",
      apiKey: "custom-session-key",
      model: "classification-model",
    });
  });

  it("keeps managed local generations inside the measured 10-item context budget", () => {
    const request = toLocalProviderRequest(
      {
        provider: "managed_local",
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-2b-local",
        modelId: "drifty-qwen3-5-2b-economy",
      },
      [basePayload],
      null,
    );

    expect(MANAGED_LOCAL_AI_CLASSIFICATION_MAX_BATCH_SIZE).toBe(10);
    expect(MANAGED_LOCAL_AI_CLASSIFICATION_MAX_PROMPT_BYTES).toBe(9_000);
    expect(MANAGED_LOCAL_AI_CLASSIFICATION_MAX_MEMORY_BYTES).toBe(3_000);
    expect(MANAGED_LOCAL_AI_CLASSIFICATION_MAX_TOKENS).toBe(1024);
    expect(request?.request["maxTokens"]).toBe(1024);
  });

  it("requests the production intent contract and strict OpenRouter JSON schema", () => {
    const request = toLocalProviderRequest(
      { provider: "openrouter_byok", apiKey: "test-key", model: "google/gemini-3.1-flash-lite" },
      [basePayload],
      null,
    );

    expect(request).not.toBeNull();
    expect(promptFromRequest(request)).toContain('"intent":string');
    expect(promptFromRequest(request)).not.toContain('"productivity":string');
    expect(request?.request["responseFormat"]).toMatchObject({
      type: "json_schema",
      json_schema: { name: "drifty_live_intent_classification", strict: true },
    });
  });

  it("asks a local provider for userProductivity only while a productivity definition exists", () => {
    const provider = { provider: "openrouter_byok", apiKey: "test-key", model: "google/gemini-3.1-flash-lite" } as const;
    const requiredFields = (request: LocalAiProviderRequest | null) => {
      const format = request?.request["responseFormat"] as { json_schema: { schema: { properties: { results: { items: { required: string[] } } } } } };
      return format.json_schema.schema.properties.results.items.required;
    };
    const defined = toLocalProviderRequest(provider, [{ ...basePayload, categoryGuidance: [{ productivity: "neutral", description: "Slack, even for work" }] }], null);
    const categoryOnly = toLocalProviderRequest(provider, [{ ...basePayload, categoryGuidance: [{ category: "learning", description: "Conference talks" }] }], null);

    expect(requiredFields(defined)).toContain("userProductivity");
    expect(promptFromRequest(defined)).toContain('"userProductivity":string');
    expect(requiredFields(categoryOnly)).not.toContain("userProductivity");
    expect(promptFromRequest(categoryOnly)).not.toContain("userProductivity");
  });

  it("omits Reddit-specific prompt guidance for non-Reddit payloads", () => {
    const prompt = promptFor([basePayload]);

    expect(prompt).not.toContain("Reddit-specific guidance");
    expect(prompt).not.toContain("redditCommunity");
    expect(prompt).not.toContain("YouTube channel name");
    expect(prompt).not.toContain("YouTube video category");
  });

  it("adds YouTube channel names and categories when present", () => {
    const prompt = promptFor([{
      ...basePayload,
      siteDomain: "youtube.com",
      youtubeTitle: "Machine learning lecture",
      youtubeChannelName: "MIT OpenCourseWare",
      youtubeCategory: "Education",
    }]);

    expect(prompt).toContain("YouTube channel name");
    expect(prompt).toContain("YouTube video category");
    expect(prompt).toContain("\"youtubeChannelName\":\"MIT OpenCourseWare\"");
    expect(prompt).toContain("\"youtubeCategory\":\"Education\"");
  });

  it("adds Reddit-specific guidance and community context for Reddit payloads", () => {
    const prompt = promptFor([{
      ...basePayload,
      siteDomain: "reddit.com",
      siteTitle: "r/productivityapp - app recommendations",
      windowTitle: "r/productivityapp - Reddit",
      redditCommunity: "productivityapp",
    }]);

    expect(prompt).toContain("Reddit-specific guidance");
    expect(prompt).toContain("redditCommunity");
    expect(prompt).toContain("productivityapp");
  });

  it("omits enhanced context unless an explicit retry payload is supplied", () => {
    const prompt = promptFor([basePayload]);

    expect(Object.keys(basePayload)).not.toContain("adaptiveContentContext");
    expect(prompt).not.toContain("Enhanced retry context");
    expect(prompt).not.toContain("Product research");
  });

  it("adds only policy-safe enhanced retry context to the prompt", () => {
    const parentPage = {
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
    const rawBody = {
      id: "raw-body",
      depth: 3,
      kind: "messageBody",
      sourceFamily: "communication_metadata",
      values: ["blocked raw body password=hunter2"],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "blocked",
      sensitivity: ["message_body", "secret_like"],
    } satisfies AdaptiveContextItem;
    const egress = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enhancedContextSettings,
      context: {
        version: 1,
        segmentId: "segment-1",
        collectedAt: "2026-07-08T09:00:00.000Z",
        localStorage: "stored_local",
        items: [parentPage, rawBody],
      },
    });

    expect(egress.providerContext).not.toBeNull();
    if (!egress.providerContext) return;

    const prompt = enhancedRetryPromptFor([basePayload], egress.providerContext);

    expect(prompt).toContain("Enhanced retry context");
    expect(prompt).toContain("Product research");
    expect(prompt).not.toContain("blocked raw body");
    expect(prompt).not.toContain("hunter2");
  });

  it("omits short password-like key value secrets from enhanced retry prompts without sensitivity flags", () => {
    const unflaggedCredentials = {
      id: "unflagged-credentials",
      depth: 2,
      kind: "heading",
      sourceFamily: "document_knowledge",
      values: ["password=hunter2", "pwd: 1234", "passcode abc123", "password reset guidance"],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    } satisfies AdaptiveContextItem;
    const egress = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enhancedContextSettings,
      context: {
        version: 1,
        segmentId: "segment-1",
        collectedAt: "2026-07-08T09:00:00.000Z",
        localStorage: "stored_local",
        items: [unflaggedCredentials],
      },
    });

    expect(egress.providerContext).not.toBeNull();
    if (!egress.providerContext) return;

    const prompt = enhancedRetryPromptFor([basePayload], egress.providerContext);

    expect(prompt).toContain("Enhanced retry context");
    expect(prompt).toContain("password reset guidance");
    expect(prompt).not.toContain("hunter2");
    expect(prompt).not.toContain("1234");
    expect(prompt).not.toContain("abc123");
  });

  it("omits adjacent short secret key values from enhanced retry prompts while keeping benign prose", () => {
    const shortSecretCredentials = [{
      id: "short-secret-credentials-a",
      depth: 2,
      kind: "heading",
      sourceFamily: "document_knowledge",
      values: [
        "pass=abcd",
        "token=abcd1234",
        "api_key: abcd1234",
        "api-key abcd1234",
        "token bucket algorithm",
      ],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    }, {
      id: "short-secret-credentials-b",
      depth: 2,
      kind: "heading",
      sourceFamily: "document_knowledge",
      values: [
        "api key = abcd1234",
        "secret: abcd1234",
        "client_secret abcd1234",
        "access_token=abcd1234",
        "secret management policy",
      ],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    }, {
      id: "short-secret-credentials-c",
      depth: 2,
      kind: "heading",
      sourceFamily: "document_knowledge",
      values: ["refresh_token: abcd1234", "auth_token abcd1234", "password reset guidance"],
      extractionConfidence: "high",
      localStorage: "stored_local",
      providerPolicy: "metadata_only",
      sensitivity: [],
    }] satisfies readonly AdaptiveContextItem[];
    const egress = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enhancedContextSettings,
      context: {
        version: 1,
        segmentId: "segment-1",
        collectedAt: "2026-07-08T09:00:00.000Z",
        localStorage: "stored_local",
        items: shortSecretCredentials,
      },
    });

    expect(egress.providerContext).not.toBeNull();
    if (!egress.providerContext) return;

    const prompt = enhancedRetryPromptFor([basePayload], egress.providerContext);

    expect(prompt).toContain("Enhanced retry context");
    expect(prompt).toContain("token bucket algorithm");
    expect(prompt).toContain("secret management policy");
    expect(prompt).toContain("password reset guidance");
    expect(prompt).not.toContain("abcd");
    expect(prompt).not.toContain("abcd1234");
  });

  it("attaches enhanced context under the payload's id, not the capture's title", () => {
    // A captured context labels itself with a title-derived string that still holds the
    // DM peer the extractor dropped. The prompt matches on the payload's segment id, so
    // egress has to relabel; otherwise the context silently never attaches.
    const rawTitleSegmentId = "2026-08-24T00:00:00+00:00|Slack|Junho(DM) - Northstar Lab - 2개의 새 항목";
    const egress = buildProviderSafeEnhancedContext({
      mode: "enhanced_retry",
      settings: enhancedContextSettings,
      segmentId: basePayload.segmentId,
      context: {
        version: 1,
        segmentId: rawTitleSegmentId,
        collectedAt: "2026-08-24T00:00:00.000Z",
        localStorage: "stored_local",
        items: [{
          id: "communication_metadata:workspace",
          depth: 1,
          kind: "workspace",
          sourceFamily: "communication_metadata",
          values: ["Northstar Lab"],
          extractionConfidence: "medium",
          localStorage: "stored_local",
          providerPolicy: "metadata_only",
          sensitivity: [],
        }],
      },
    });

    expect(egress.providerContext).not.toBeNull();
    if (!egress.providerContext) return;

    expect(egress.providerContext.segmentId).toBe(basePayload.segmentId);

    const prompt = enhancedRetryPromptFor([basePayload], egress.providerContext);

    expect(prompt).toContain("Northstar Lab");
    expect(prompt).not.toContain("Junho");
    expect(prompt).not.toContain("개의 새 항목");
  });
});
