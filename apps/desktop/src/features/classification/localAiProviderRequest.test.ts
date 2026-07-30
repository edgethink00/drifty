import { describe, expect, it } from "vitest";
import type { AdaptiveContextItem } from "@drifty/domain";
import {
  buildProviderSafeEnhancedContext,
  type EnhancedContextProviderPayload,
} from "./contentContextEgressPolicy";
import {
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
      devModeEnabled: true,
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
      devModeEnabled: true,
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
      devModeEnabled: true,
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
});
