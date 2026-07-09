import type { ActivityClassificationRecord, ActivitySegment, AdaptiveContentContext, ClassificationMetrics } from "@drifty/domain";
import { describe, expect, it, vi } from "vitest";
import { CLOUD_API_CLIENT_VERSION, CLOUD_API_CONTRACT_VERSION } from "../../lib/cloudContract";
import { AI_CLASSIFICATION_BACKGROUND_THRESHOLD, AI_CLASSIFICATION_FOCUSED_IDLE_MS, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, diffAiClassificationUsageSummary, estimateAiClassificationCostUsd, projectAiClassificationCost, type AiClassificationUsageSummary } from "./aiClassificationService";

const AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY = "drifty.aiPrivacyRequestSettings.v1";
const DEV_MODE_STORAGE_KEY = "drifty.dev.mode";
const ENHANCED_CONTEXT_ENABLED_STORAGE_KEY = "drifty.dev.enhancedContext.enabled";
const ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY = "drifty.dev.enhancedContext.captureLocal";
const ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY = "drifty.dev.enhancedContext.retryLowConfidence";
const ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY = "drifty.dev.enhancedContext.debugLogging";
const ENHANCED_CONTEXT_DOCUMENT_KNOWLEDGE_STORAGE_KEY = "drifty.dev.enhancedContext.source.documentKnowledge";
const ENHANCED_CONTEXT_COMMUNICATION_METADATA_STORAGE_KEY = "drifty.dev.enhancedContext.source.communicationMetadata";

const baseUsage: AiClassificationUsageSummary = {
  requests: 1,
  llmRequests: 1,
  itemsRequested: 10,
  cacheHits: 0,
  cacheMisses: 10,
  errors: 0,
  quotaErrors: 0,
  configErrors: 0,
  requestErrors: 0,
  parseErrors: 0,
  schemaErrors: 0,
  lastErrorType: null,
  lastErrorMessage: null,
  lastErrorStatus: null,
  lastErrorAt: null,
  latencyMsTotal: 1200,
  averageLatencyMs: 1200,
  promptTokens: 1000,
  responseTokens: 500,
  totalTokens: 1500,
  estimatedCostUsd: 0.02,
};

const baseMetrics: ClassificationMetrics = {
  totalSegments: 100,
  classifiedSegments: 60,
  unclassifiedSegments: 40,
  aiClassifiedSegments: 10,
  staleClassifications: 0,
};

describe("projectAiClassificationCost", () => {
  it("scales measured selected-day cost by processed sample coverage", () => {
    const projection = projectAiClassificationCost(baseUsage, baseMetrics);

    expect(projection).toEqual({
      processedItems: 10,
      candidateItems: 100,
      multiplier: 10,
      measuredCostUsd: 0.02,
      dailyProjectedCostUsd: 0.2,
      monthlyProjectedCostUsd: 6,
    });
  });

  it("returns zero projections when no items were processed", () => {
    const projection = projectAiClassificationCost({ ...baseUsage, itemsRequested: 0 }, baseMetrics);

    expect(projection.processedItems).toBe(0);
    expect(projection.candidateItems).toBe(100);
    expect(projection.multiplier).toBe(0);
    expect(projection.dailyProjectedCostUsd).toBe(0);
    expect(projection.monthlyProjectedCostUsd).toBe(0);
  });

  it("returns zero projections when there are no selected-day candidates", () => {
    const projection = projectAiClassificationCost(baseUsage, { ...baseMetrics, totalSegments: 0 });

    expect(projection.processedItems).toBe(10);
    expect(projection.candidateItems).toBe(0);
    expect(projection.multiplier).toBe(0);
    expect(projection.dailyProjectedCostUsd).toBe(0);
    expect(projection.monthlyProjectedCostUsd).toBe(0);
  });

  it("uses totalSegments rather than only unclassifiedSegments for candidates", () => {
    const projection = projectAiClassificationCost(baseUsage, {
      ...baseMetrics,
      totalSegments: 120,
      unclassifiedSegments: 5,
    });

    expect(projection.candidateItems).toBe(120);
    expect(projection.multiplier).toBe(12);
    expect(projection.dailyProjectedCostUsd).toBeCloseTo(0.24);
    expect(projection.monthlyProjectedCostUsd).toBeCloseTo(7.2);
  });
});

describe("estimateAiClassificationCostUsd", () => {
  it("treats Gemini and OpenRouter free rows as free and estimates DeepSeek V4 Flash paid rows", () => {
    expect(estimateAiClassificationCostUsd("gemini-3.1-flash-lite", 1_000_000, 1_000_000)).toBe(0);
    expect(estimateAiClassificationCostUsd("deepseek/deepseek-v4-flash:free", 1_000_000, 1_000_000)).toBe(0);
    expect(estimateAiClassificationCostUsd("deepseek/deepseek-v4-flash", 1_000_000, 1_000_000)).toBeCloseTo(0.42);
  });

  it("returns zero for unknown model pricing rather than guessing", () => {
    expect(estimateAiClassificationCostUsd("unknown-model", 1_000_000, 1_000_000)).toBe(0);
  });
});

describe("diffAiClassificationUsageSummary", () => {
  it("returns a clamped measured usage delta for projection and display fields", () => {
    const delta = diffAiClassificationUsageSummary(
      { ...baseUsage, requests: 2, llmRequests: 2, itemsRequested: 10, cacheHits: 1, promptTokens: 1000, responseTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.02, latencyMsTotal: 1200, averageLatencyMs: 600 },
      { ...baseUsage, requests: 3, llmRequests: 3, itemsRequested: 20, cacheHits: 4, promptTokens: 5000, responseTokens: 1500, totalTokens: 6500, estimatedCostUsd: 0.07, latencyMsTotal: 2700, averageLatencyMs: 900 },
    );

    expect(delta.requests).toBe(1);
    expect(delta.llmRequests).toBe(1);
    expect(delta.itemsRequested).toBe(10);
    expect(delta.cacheHits).toBe(3);
    expect(delta.promptTokens).toBe(4000);
    expect(delta.responseTokens).toBe(1000);
    expect(delta.totalTokens).toBe(5000);
    expect(delta.estimatedCostUsd).toBeCloseTo(0.05);
    expect(delta.latencyMsTotal).toBe(1500);
    expect(delta.averageLatencyMs).toBe(1500);
  });

  it("clamps negative usage deltas to zero", () => {
    const delta = diffAiClassificationUsageSummary(
      { ...baseUsage, requests: 4, itemsRequested: 20, promptTokens: 2000, responseTokens: 1000, totalTokens: 3000, estimatedCostUsd: 0.04 },
      { ...baseUsage, requests: 3, itemsRequested: 10, promptTokens: 1000, responseTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.02 },
    );

    expect(delta.requests).toBe(0);
    expect(delta.itemsRequested).toBe(0);
    expect(delta.promptTokens).toBe(0);
    expect(delta.responseTokens).toBe(0);
    expect(delta.totalTokens).toBe(0);
    expect(delta.estimatedCostUsd).toBe(0);
  });
});

describe("runAiClassification cloud contract", () => {
  function ensureTestWindow() {
    if (typeof window !== "undefined") return;
    const values = new Map<string, string>();
    const localStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn((key: string) => { values.delete(key); }),
      clear: vi.fn(() => { values.clear(); }),
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);
  }

  function createUnknownSegment(index: number, overrides: Partial<ActivitySegment> = {}): ActivitySegment {
    return {
      id: `segment-${index}`,
      startedAt: "2026-05-22T09:00:00.000Z",
      endedAt: "2026-05-22T09:05:00.000Z",
      durationSeconds: 300,
      appName: "MysteryApp",
      windowTitle: `Unmapped task ${index}`,
      platform: "macos",
      source: "accessibility",
      ...overrides,
    };
  }

  async function importServiceWithSegments(segments: ActivitySegment[], options: {
    session?: unknown;
    reusable?: (fingerprints: string[]) => Record<string, ActivityClassificationRecord>;
    timeline?: ActivitySegment[];
    edgeResult?: Partial<ActivityClassificationRecord>;
    nativeStatus?: number;
    saveError?: Error;
  } = {}) {
    vi.resetModules();
    ensureTestWindow();

    const invoke = vi.fn().mockResolvedValue({
      data: {
        model: "gemini-3.1-flash-lite",
        results: segments.map((segment) => ({
          id: segment.id,
          category: options.edgeResult?.category ?? "workspace",
          productivity: options.edgeResult?.productivity ?? "focus",
          confidence: options.edgeResult?.confidence ?? 0.8,
          reason: options.edgeResult?.reason ?? "Work context",
        })),
      },
      error: null,
    });
    const getUnclassifiedSegments = vi.fn().mockResolvedValue(segments);
    const getTimeline = vi.fn().mockResolvedValue(options.timeline ?? []);
    const saveClassifications = vi.fn((records: unknown[]) => {
      if (options.saveError) return Promise.reject(options.saveError);
      return Promise.resolve({ saved: records.length });
    });
    const getClassificationMetrics = vi.fn().mockResolvedValue(baseMetrics);
    const getReusableAiClassifications = vi.fn((fingerprints: string[]) => Promise.resolve(options.reusable?.(fingerprints) ?? {}));
    const getSession = vi.fn().mockResolvedValue({
      data: { session: "session" in options ? options.session : { access_token: "token" } },
    });
    const nativeInvoke = vi.fn().mockResolvedValue({
      status: options.nativeStatus ?? 200,
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              results: segments.map((segment) => ({
                id: segment.id,
                category: options.edgeResult?.category ?? "workspace",
                productivity: options.edgeResult?.productivity ?? "focus",
                confidence: options.edgeResult?.confidence ?? 0.82,
                reason: options.edgeResult?.reason ?? "Local work context",
              })),
            }),
          },
        }],
        usage: { prompt_tokens: 120, completion_tokens: 24 },
      }),
      latencyMs: 321,
    });

    vi.doMock("../../lib/supabase/client", () => ({
      supabase: {
        auth: { getSession },
        functions: { invoke },
      },
    }));
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: nativeInvoke, isTauri: () => false }));
    vi.doMock("../../lib/api/trackerClient", () => ({
      trackerClient: {
        getUnclassifiedSegments,
        getTimeline,
        getReusableAiClassifications,
        saveClassifications,
        getClassificationMetrics,
      },
    }));

    const service = await import("./aiClassificationService");
    const debugLog = await import("../settings/debugLog");
    return { ...service, ...debugLog, invoke, nativeInvoke, getSession, getUnclassifiedSegments, getTimeline, getReusableAiClassifications, saveClassifications, getClassificationMetrics };
  }

  function createYouTubeBrowseSegment(index: number, siteUrl: string): ActivitySegment {
    return createUnknownSegment(index, {
      appName: "Safari",
      browserName: "Safari",
      siteDomain: "youtube.com",
      siteTitle: "YouTube",
      siteUrl,
    });
  }

  function createYouTubeVideoSegment(index: number, overrides: Partial<ActivitySegment> = {}): ActivitySegment {
    return createUnknownSegment(index, {
      appName: "Safari",
      browserName: "Safari",
      siteDomain: "youtube.com",
      siteTitle: "Video",
      siteUrl: `https://www.youtube.com/watch?v=video${index}`,
      youtubeVideoId: `video${index}`,
      classification: {
        category: "learning",
        productivity: "focus",
        source: "manual",
        confidence: 0.94,
        reason: "Test video classification",
      },
      ...overrides,
    });
  }

  function createReusableRecord(inputFingerprint: string, overrides: Partial<ActivityClassificationRecord> = {}): ActivityClassificationRecord {
    return {
      segmentId: "cached-source-segment",
      inputFingerprint,
      category: "learning",
      productivity: "focus",
      source: "llm",
      confidence: 0.93,
      reason: "Copied from a previous local AI result",
      model: "gemini-3.1-flash-lite",
      promptVersion: "v1",
      taxonomyVersion: "v1",
      requestId: "previous-request",
      latencyMs: 111,
      aiResult: true,
      stale: false,
      classifiedAt: "2026-05-20T12:00:00.000Z",
      ...overrides,
    };
  }

  function createNotionAdaptiveContext(segmentId: string): AdaptiveContentContext {
    return {
      version: 1,
      segmentId,
      collectedAt: "2026-07-08T09:00:00.000Z",
      localStorage: "stored_local",
      items: [
        {
          id: "notion-parent",
          depth: 1,
          kind: "parentPage",
          sourceFamily: "document_knowledge",
          values: ["Product research"],
          extractionConfidence: "high",
          localStorage: "stored_local",
          providerPolicy: "metadata_only",
          sensitivity: [],
        },
        {
          id: "notion-heading",
          depth: 2,
          kind: "heading",
          sourceFamily: "document_knowledge",
          values: ["Moderator outreach"],
          extractionConfidence: "high",
          localStorage: "stored_local",
          providerPolicy: "metadata_only",
          sensitivity: [],
        },
        {
          id: "blocked-body",
          depth: 3,
          kind: "messageBody",
          sourceFamily: "communication_metadata",
          values: ["blocked raw body password=hunter2"],
          extractionConfidence: "high",
          localStorage: "stored_local",
          providerPolicy: "blocked",
          sensitivity: ["message_body", "secret_like"],
        },
      ],
    };
  }

  function createBlockedAdaptiveContext(segmentId: string): AdaptiveContentContext {
    return {
      version: 1,
      segmentId,
      collectedAt: "2026-07-08T09:00:00.000Z",
      localStorage: "stored_local",
      items: [
        {
          id: "blocked-body",
          depth: 3,
          kind: "messageBody",
          sourceFamily: "communication_metadata",
          values: ["blocked raw body password=hunter2"],
          extractionConfidence: "high",
          localStorage: "stored_local",
          providerPolicy: "blocked",
          sensitivity: ["message_body", "secret_like"],
        },
      ],
    };
  }

  function enableEnhancedContextRetry() {
    ensureTestWindow();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(ENHANCED_CONTEXT_ENABLED_STORAGE_KEY, "1");
    window.localStorage.setItem(ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY, "1");
    window.localStorage.setItem(ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY, "1");
    window.localStorage.setItem(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY, "1");
    window.localStorage.setItem(ENHANCED_CONTEXT_DOCUMENT_KNOWLEDGE_STORAGE_KEY, "1");
  }

  function localAiResponse(segmentId: string, result: {
    readonly category: string;
    readonly productivity: string;
    readonly confidence: number;
    readonly reason: string;
  }) {
    return {
      status: 200,
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ results: [{ id: segmentId, ...result }] }),
          },
        }],
        usage: { prompt_tokens: 120, completion_tokens: 24 },
      }),
      latencyMs: 321,
    };
  }

  function promptFromNativeCall(nativeInvoke: ReturnType<typeof vi.fn>, callIndex: number): string {
    const request = nativeInvoke.mock.calls[callIndex]?.[1]?.request as { messages?: Array<{ content?: unknown }> } | undefined;
    const content = request?.messages?.[0]?.content;
    return typeof content === "string" ? content : "";
  }

  function writeOnboardingState(userId: string, overrides: Record<string, unknown> = {}) {
    ensureTestWindow();
    window.localStorage.setItem(`drifty:onboarding:v2:${userId}`, JSON.stringify({
      version: 2,
      completed: true,
      displayName: "Test User",
      workType: null,
      workTypeOther: "",
      workDomain: null,
      workDomainOther: "",
      jobType: null,
      jobTypeOther: "",
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-05-20T12:00:00.000Z",
      ...overrides,
    }));
  }

  function writeAiPrivacyRequestSettings(optional: {
    readonly siteUrl?: boolean;
    readonly title?: boolean;
    readonly windowTitle?: boolean;
    readonly contentContext?: boolean;
    readonly workProfile?: boolean;
  }) {
    ensureTestWindow();
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      optional,
    }));
  }

  function cleanupServiceMocks() {
    ensureTestWindow();
    window.localStorage.clear();
    vi.doUnmock("../../lib/supabase/client");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../lib/api/trackerClient");
    vi.resetModules();
  }

  it("exports realtime scheduler thresholds", () => {
    expect(AI_CLASSIFICATION_BACKGROUND_THRESHOLD).toBe(20);
    expect(AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD).toBe(5);
    expect(AI_CLASSIFICATION_FOCUSED_IDLE_MS).toBe(20 * 60 * 1000);
  });

  it("sends optional onboarding work profile context to classify-activity", async () => {
    const segment = createUnknownSegment(1);
    writeOnboardingState("user-1", {
      jobType: "Coding, Writing",
      workType: "Coding",
      workDomain: "AI",
    });

    try {
      const { runAiClassification, invoke } = await importServiceWithSegments([segment], {
        session: { access_token: "token", user: { id: "user-1" } },
      });
      await runAiClassification({ day: "2026-05-22" });

      const body = invoke.mock.calls[0]?.[1]?.body as Record<string, unknown>;
      expect(body.workProfile).toBe("Coding, Writing in AI");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends client and contract metadata to classify-activity", async () => {
    vi.resetModules();

    const segment: ActivitySegment = {
      id: "segment-1",
      startedAt: "2026-05-22T09:00:00.000Z",
      endedAt: "2026-05-22T09:05:00.000Z",
      durationSeconds: 300,
      appName: "MysteryApp",
      windowTitle: "Unmapped task",
      platform: "macos",
      source: "accessibility",
    };
    const invoke = vi.fn().mockResolvedValue({
      data: {
        model: "gemini-3.1-flash-lite",
        results: [{
          id: "segment-1",
          category: "workspace",
          productivity: "focus",
          confidence: 0.8,
          reason: "Work context",
        }],
      },
      error: null,
    });
    const saveClassifications = vi.fn().mockResolvedValue({ saved: 1 });
    const getClassificationMetrics = vi.fn().mockResolvedValue(baseMetrics);

    vi.doMock("../../lib/supabase/client", () => ({
      supabase: {
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "token" } } }) },
        functions: { invoke },
      },
    }));
    vi.doMock("../../lib/api/trackerClient", () => ({
      trackerClient: {
        getUnclassifiedSegments: vi.fn().mockResolvedValue([segment]),
        getReusableAiClassifications: vi.fn().mockResolvedValue({}),
        saveClassifications,
        getClassificationMetrics,
      },
    }));

    try {
      const { runAiClassification } = await import("./aiClassificationService");
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(invoke).toHaveBeenCalledWith("classify-activity", {
        body: expect.objectContaining({
          clientVersion: CLOUD_API_CLIENT_VERSION,
          contractVersion: CLOUD_API_CONTRACT_VERSION,
          items: [expect.objectContaining({ id: "segment-1", appName: "MysteryApp" })],
        }),
      });
      expect(saveClassifications).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("../../lib/supabase/client");
      vi.doUnmock("../../lib/api/trackerClient");
      vi.resetModules();
    }
  });

  it("caps oversized tracker fetches and Edge payloads to 20 items", async () => {
    const segments = Array.from({ length: 25 }, (_, index) => createUnknownSegment(index));

    try {
      const { runAiClassification, invoke, getUnclassifiedSegments } = await importServiceWithSegments(segments);
      await runAiClassification({ day: "2026-05-22", limit: 50 }, 50);

      expect(getUnclassifiedSegments).toHaveBeenCalledWith({ day: "2026-05-22", limit: 20 });
      expect(invoke).toHaveBeenCalledWith("classify-activity", {
        body: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ id: "segment-0" })]),
        }),
      });
      const body = invoke.mock.calls[0]?.[1]?.body as { items: unknown[] };
      expect(body.items).toHaveLength(20);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("uses a 5-item Edge payload for focused idle unknown-threshold batches", async () => {
    const segments = Array.from({ length: 5 }, (_, index) => createUnknownSegment(index));

    try {
      const { runAiClassificationForUnknownThreshold, invoke, getUnclassifiedSegments } = await importServiceWithSegments(segments);
      await runAiClassificationForUnknownThreshold({ day: "2026-05-22", limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);

      expect(getUnclassifiedSegments).toHaveBeenCalledWith({ day: "2026-05-22", limit: 20 });
      const body = invoke.mock.calls[0]?.[1]?.body as { items: unknown[] };
      expect(body.items).toHaveLength(5);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("reuses below-threshold cached fingerprints without waiting for a provider batch", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassificationForUnknownThreshold, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([segment], {
        reusable: (fingerprints) => ({ [fingerprints[0]]: createReusableRecord(fingerprints[0], { category: "learning" }) }),
      });
      const result = await runAiClassificationForUnknownThreshold({ day: "2026-05-22", limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);

      expect(result.status).toBe("saved");
      expect(result.selectedSegments).toBe(1);
      expect(result.savedRecords).toBe(1);
      expect(getReusableAiClassifications).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "segment-1", category: "learning", aiResult: true })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("waits instead of calling a provider when reuse leaves too few threshold misses", async () => {
    const segments = Array.from({ length: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, (_, index) => createUnknownSegment(index));

    try {
      const { runAiClassificationForUnknownThreshold, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments(segments, {
        reusable: (fingerprints) => Object.fromEntries(
          fingerprints.slice(0, 4).map((fingerprint) => [fingerprint, createReusableRecord(fingerprint, { category: "learning" })]),
        ),
      });
      const result = await runAiClassificationForUnknownThreshold({ day: "2026-05-22", limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);

      expect(result.status).toBe("saved");
      expect(result.selectedSegments).toBe(4);
      expect(result.savedRecords).toBe(4);
      expect(getReusableAiClassifications).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toHaveLength(4);
      expect(result.message).toContain("Only 1 unknown AI classification candidate found; waiting for 5");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("saves rule classifications while waiting for enough post-rule unknown candidates", async () => {
    const deterministicSegment = createUnknownSegment(99, {
      appName: "Visual Studio Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "Project implementation",
    });
    const segments = [
      ...Array.from({ length: 4 }, (_, index) => createUnknownSegment(index)),
      deterministicSegment,
    ];

    try {
      const { runAiClassificationForUnknownThreshold, invoke, saveClassifications } = await importServiceWithSegments(segments);
      const result = await runAiClassificationForUnknownThreshold({ day: "2026-05-22", limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);

      expect(result.status).toBe("saved");
      expect(result.selectedSegments).toBe(1);
      expect(result.savedRecords).toBe(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "segment-99", aiResult: false })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("saves contextless browser activity as system unknown instead of calling cloud AI", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: null,
      browserAutomationStatus: "denied",
      browserAutomationError: "Not authorized to send Apple events to Google Chrome.",
      source: "nsworkspace",
    });

    try {
      const { runAiClassification, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([segment]);
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(result.selectedSegments).toBe(1);
      expect(result.savedRecords).toBe(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(getReusableAiClassifications).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        category: "unknown",
        productivity: "neutral",
        source: "system",
        aiResult: false,
        reason: expect.stringContaining("denied"),
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("saves blank new-tab browser activity as system unknown instead of calling cloud AI", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: "newtab",
      siteTitle: "New Tab",
      windowTitle: "New Tab - Google Chrome - Ari",
      source: "nsworkspace",
    });

    try {
      const { runAiClassification, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([segment]);
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(result.savedRecords).toBe(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(getReusableAiClassifications).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        category: "unknown",
        productivity: "neutral",
        source: "system",
        aiResult: false,
        reason: expect.stringContaining("empty page"),
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("saves macOS system surfaces like loginwindow as system unknown instead of calling cloud AI", async () => {
    const segment = createUnknownSegment(1, {
      appName: "loginwindow",
      windowTitle: null,
      source: "nsworkspace",
    });

    try {
      const { runAiClassification, invoke, saveClassifications } = await importServiceWithSegments([segment]);
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(result.savedRecords).toBe(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        category: "unknown",
        productivity: "neutral",
        source: "system",
        aiResult: false,
        reason: expect.stringContaining("system surface"),
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("still classifies browser activity whose title starts like a blank marker but has a real site", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: "notion.so",
      siteTitle: "New Tab Settings Guide",
      windowTitle: "New Tab Settings Guide - Google Chrome",
      source: "nsworkspace",
    });

    try {
      const { runAiClassification, invoke } = await importServiceWithSegments([segment]);
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("counts contextless browser system skips before threshold AI batches", async () => {
    const segments = Array.from({ length: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, (_, index) => createUnknownSegment(index, {
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: null,
      browserAutomationStatus: "unavailable",
      browserAutomationError: "Google Chrome accessibility address bar fallback found no readable address field.",
      source: "nsworkspace",
    }));

    try {
      const { runAiClassificationForUnknownThreshold, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments(segments);
      const result = await runAiClassificationForUnknownThreshold({ day: "2026-05-22", limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);

      expect(result.status).toBe("saved");
      expect(result.selectedSegments).toBe(AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);
      expect(result.savedRecords).toBe(AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);
      expect(invoke).not.toHaveBeenCalled();
      expect(getReusableAiClassifications).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            segmentId: "segment-0",
            source: "system",
            aiResult: false,
            reason: expect.stringContaining("unavailable"),
          }),
        ]),
      );
    } finally {
      cleanupServiceMocks();
    }
  });

  it("counts inherited YouTube browse records before threshold reuse summaries", async () => {
    const browse = createYouTubeBrowseSegment(90, "https://www.youtube.com/@drifty/videos");
    const unknownSegments = Array.from({ length: 4 }, (_, index) => createUnknownSegment(index));
    const neighbor = createYouTubeVideoSegment(91, {
      startedAt: "2026-05-22T08:58:00.000Z",
      endedAt: "2026-05-22T09:00:00.000Z",
      durationSeconds: 120,
    });

    try {
      const { runAiClassificationForUnknownThreshold, invoke, saveClassifications } = await importServiceWithSegments([browse, ...unknownSegments], {
        timeline: [neighbor],
        reusable: (fingerprints) => Object.fromEntries(
          fingerprints.map((fingerprint) => [fingerprint, createReusableRecord(fingerprint, { category: "learning" })]),
        ),
      });
      const result = await runAiClassificationForUnknownThreshold({ day: "2026-05-22", limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD }, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD);

      expect(result.status).toBe("saved");
      expect(result.selectedSegments).toBe(5);
      expect(result.savedRecords).toBe(5);
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(2);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ segmentId: "segment-90", source: "system", aiResult: false })]);
      expect(saveClassifications.mock.calls[1]?.[0]).toHaveLength(4);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends only minimized allowed fields to the Edge Function", async () => {
    const segment = createUnknownSegment(1, {
      bundleId: "com.secret.RawApp",
      browserName: "Arc",
      siteDomain: "example.com",
      siteTitle: "Example private page",
      siteUrl: "https://example.com/private/raw-url",
      youtubeTitle: "Allowed video title",
      youtubeChannelName: "Allowed channel",
      youtubeCategory: "Education",
      youtubeDescription: "raw youtube description must stay local",
      youtubeKeywords: ["raw", "keywords"],
    });

    try {
      const { runAiClassification, invoke } = await importServiceWithSegments([segment]);
      await runAiClassification({ day: "2026-05-22" });

      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<Record<string, unknown>> };
      expect(body.items).toHaveLength(1);
      expect(Object.keys(body.items[0]).sort()).toEqual([
        "appName",
        "domain",
        "durationSeconds",
        "id",
        "inputFingerprint",
        "siteUrl",
        "title",
        "urlHost",
        "windowTitle",
        "youtubeCategory",
        "youtubeChannelName",
      ].sort());
      expect(body.items[0]).toEqual(expect.objectContaining({
        id: "segment-1",
        appName: "MysteryApp",
        domain: "example.com",
        urlHost: "example.com",
        siteUrl: "https://example.com/private/raw-url",
        title: "Example private page",
        windowTitle: "Unmapped task 1",
        youtubeCategory: "Education",
        youtubeChannelName: "Allowed channel",
        durationSeconds: 300,
      }));
      expect(body.items[0]).not.toHaveProperty("startedAt");
      expect(body.items[0]).not.toHaveProperty("endedAt");
      expect(body.items[0]).not.toHaveProperty("bundleId");
      expect(body.items[0]).not.toHaveProperty("browserName");
      expect(JSON.stringify(body)).not.toContain("raw youtube description must stay local");
      expect(JSON.stringify(body)).not.toContain("keywords");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("includes allowed YouTube channel names and categories in cloud requests and cache fingerprints", async () => {
    const firstSegment = createUnknownSegment(1, {
      siteDomain: "example.com",
      siteTitle: "Same video title",
      youtubeTitle: "Same video title",
      youtubeChannelName: "Learning Channel",
      youtubeCategory: "Education",
    });
    const secondSegment = createUnknownSegment(2, {
      siteDomain: "example.com",
      siteTitle: "Same video title",
      youtubeTitle: "Same video title",
      youtubeChannelName: "Entertainment Channel",
      youtubeCategory: "Comedy",
    });

    try {
      const { runAiClassification, invoke, getReusableAiClassifications } = await importServiceWithSegments([firstSegment, secondSegment]);
      await runAiClassification({ day: "2026-05-22" });

      const reusableFingerprints = getReusableAiClassifications.mock.calls[0]?.[0] as readonly string[];
      expect(reusableFingerprints).toHaveLength(2);
      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<Record<string, unknown>> };
      expect(body.items).toEqual([
        expect.objectContaining({ youtubeCategory: "Education", youtubeChannelName: "Learning Channel" }),
        expect.objectContaining({ youtubeCategory: "Comedy", youtubeChannelName: "Entertainment Channel" }),
      ]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends derived Reddit community context when optional URL or title evidence is enabled", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Safari",
      browserName: "Safari",
      siteDomain: "reddit.com",
      siteTitle: "r/productivityapp - app recommendations",
      siteUrl: "https://www.reddit.com/r/productivityapp/comments/private-thread?utm_source=raw#comments",
      windowTitle: "r/productivityapp - Reddit",
    });

    try {
      const { runAiClassification, invoke } = await importServiceWithSegments([segment]);
      await runAiClassification({ day: "2026-05-22" });

      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<Record<string, unknown>> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toEqual(expect.objectContaining({
        domain: "reddit.com",
        urlHost: "reddit.com",
        siteUrl: "https://www.reddit.com/r/productivityapp/comments/private-thread",
        title: "r/productivityapp - app recommendations",
        windowTitle: "r/productivityapp - Reddit",
        redditCommunity: "productivityapp",
      }));
      expect(JSON.stringify(body)).not.toContain("utm_source");
      expect(JSON.stringify(body)).not.toContain("#comments");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("removes legacy-disabled site URL, titles, work profile, and unsent values from cloud requests and cache fingerprints", async () => {
    const firstSegment = createUnknownSegment(1, {
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: null,
      siteTitle: "Private docs",
      siteUrl: "https://user:pass@example.com/work/plan?token=secret#section",
      windowTitle: "Private window",
      youtubeTitle: "Private YouTube title",
      youtubeChannelName: "Raw channel metadata",
      youtubeCategory: "Education",
      youtubeIsShorts: false,
    });
    const secondSegment = createUnknownSegment(2, {
      ...firstSegment,
      id: "segment-2",
      siteTitle: "Changed private docs",
      siteUrl: "https://example.com/work/plan?token=changed#other",
      windowTitle: "Changed private window",
      youtubeTitle: "Changed private YouTube title",
      youtubeChannelName: "Changed channel metadata",
      youtubeCategory: "People & Blogs",
      youtubeIsShorts: true,
    });

    writeAiPrivacyRequestSettings({ siteUrl: false, title: false, workProfile: false });
    writeOnboardingState("user-1", { workType: "Software Development", workDomain: "AI" });

    try {
      const { runAiClassification, invoke, getReusableAiClassifications } = await importServiceWithSegments([firstSegment, secondSegment], {
        session: { access_token: "token", user: { id: "user-1" } },
      });
      await runAiClassification({ day: "2026-05-22" });

      const reusableFingerprints = getReusableAiClassifications.mock.calls[0]?.[0] as readonly string[];
      expect(reusableFingerprints).toHaveLength(1);
      expect(reusableFingerprints[0]).toMatch(/^drifty-v3-/);

      const body = invoke.mock.calls[0]?.[1]?.body as { workProfile?: unknown; items: Array<Record<string, unknown>> };
      expect(body.workProfile).toBeUndefined();
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toEqual(expect.objectContaining({
        id: "segment-1",
        domain: "example.com",
        urlHost: "example.com",
        durationSeconds: 300,
      }));
      expect(body.items[0]).not.toHaveProperty("siteUrl");
      expect(body.items[0]).not.toHaveProperty("windowTitle");
      expect(body.items[0]).not.toHaveProperty("title");
      expect(JSON.stringify(body)).not.toContain("secret");
      expect(JSON.stringify(body)).not.toContain("Private docs");
      expect(JSON.stringify(body)).not.toContain("Private window");
      expect(JSON.stringify(body)).not.toContain("Software Development in AI");
      expect(JSON.stringify(body)).not.toContain("Raw channel metadata");
      expect(JSON.stringify(body)).not.toContain("People & Blogs");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends window titles separately from disabled content context", async () => {
    const firstSegment = createUnknownSegment(1, {
      siteDomain: "example.com",
      siteTitle: "Private page title",
      windowTitle: "Useful window title",
      youtubeTitle: "Private YouTube title",
      youtubeChannelName: "Private channel",
      youtubeCategory: "Education",
    });
    const secondSegment = createUnknownSegment(2, {
      ...firstSegment,
      id: "segment-2",
      siteTitle: "Changed private page title",
      windowTitle: "Useful window title",
      youtubeTitle: "Changed private YouTube title",
      youtubeChannelName: "Changed private channel",
      youtubeCategory: "Music",
    });

    writeAiPrivacyRequestSettings({ siteUrl: false, windowTitle: true, contentContext: false, workProfile: false });

    try {
      const { runAiClassification, invoke, getReusableAiClassifications } = await importServiceWithSegments([firstSegment, secondSegment]);
      await runAiClassification({ day: "2026-05-22" });

      const reusableFingerprints = getReusableAiClassifications.mock.calls[0]?.[0] as readonly string[];
      expect(reusableFingerprints).toHaveLength(1);
      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<Record<string, unknown>> };
      expect(body.items[0]).toEqual(expect.objectContaining({
        domain: "example.com",
        urlHost: "example.com",
        windowTitle: "Useful window title",
      }));
      expect(body.items[0]).not.toHaveProperty("title");
      expect(body.items[0]).not.toHaveProperty("youtubeChannelName");
      expect(body.items[0]).not.toHaveProperty("youtubeCategory");
      expect(JSON.stringify(body)).not.toContain("Private page title");
      expect(JSON.stringify(body)).not.toContain("Private channel");
      expect(JSON.stringify(body)).not.toContain("Education");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends content context separately from disabled window titles", async () => {
    const firstSegment = createUnknownSegment(1, {
      siteDomain: "example.com",
      siteTitle: "Useful page title",
      windowTitle: "Private window title",
      youtubeTitle: "Useful YouTube title",
      youtubeChannelName: "Useful channel",
      youtubeCategory: "Education",
    });
    const secondSegment = createUnknownSegment(2, {
      ...firstSegment,
      id: "segment-2",
      siteTitle: "Useful page title",
      windowTitle: "Changed private window title",
      youtubeChannelName: "Changed useful channel",
    });

    writeAiPrivacyRequestSettings({ siteUrl: false, windowTitle: false, contentContext: true, workProfile: false });

    try {
      const { runAiClassification, invoke, getReusableAiClassifications } = await importServiceWithSegments([firstSegment, secondSegment]);
      await runAiClassification({ day: "2026-05-22" });

      const reusableFingerprints = getReusableAiClassifications.mock.calls[0]?.[0] as readonly string[];
      expect(reusableFingerprints).toHaveLength(2);
      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<Record<string, unknown>> };
      expect(body.items[0]).toEqual(expect.objectContaining({
        title: "Useful page title",
        youtubeChannelName: "Useful channel",
        youtubeCategory: "Education",
      }));
      expect(body.items[0]).not.toHaveProperty("windowTitle");
      expect(JSON.stringify(body)).not.toContain("Private window title");
      expect(JSON.stringify(body)).not.toContain("Changed private window title");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("omits Reddit community context when optional URL and title evidence are disabled", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Safari",
      browserName: "Safari",
      siteDomain: "reddit.com",
      siteTitle: "r/productivityapp - app recommendations",
      siteUrl: "https://www.reddit.com/r/productivityapp/comments/private-thread?utm_source=raw",
      windowTitle: "r/productivityapp - Reddit",
    });

    writeAiPrivacyRequestSettings({ siteUrl: false, title: false, workProfile: false });

    try {
      const { runAiClassification, invoke } = await importServiceWithSegments([segment]);
      await runAiClassification({ day: "2026-05-22" });

      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<Record<string, unknown>> };
      expect(body.items[0]).toEqual(expect.objectContaining({
        domain: "reddit.com",
        urlHost: "reddit.com",
        durationSeconds: 300,
      }));
      expect(body.items[0]).not.toHaveProperty("redditCommunity");
      expect(body.items[0]).not.toHaveProperty("siteUrl");
      expect(body.items[0]).not.toHaveProperty("title");
      expect(body.items[0]).not.toHaveProperty("windowTitle");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends sanitized site URL when enabled and fingerprints path changes but not query or hash", async () => {
    const matchingQuerySegment = createUnknownSegment(1, {
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: null,
      siteUrl: "https://user:pass@example.com/work/plan?token=secret#section",
      siteTitle: "Ignored title one",
      windowTitle: "Ignored window one",
    });
    const matchingPathSegment = createUnknownSegment(2, {
      ...matchingQuerySegment,
      id: "segment-2",
      siteUrl: "https://example.com/work/plan?token=changed#other",
      siteTitle: "Ignored title two",
      windowTitle: "Ignored window two",
    });
    const differentPathSegment = createUnknownSegment(3, {
      ...matchingQuerySegment,
      id: "segment-3",
      siteUrl: "https://example.com/work/spec?token=secret#section",
      siteTitle: "Ignored title three",
      windowTitle: "Ignored window three",
    });

    writeAiPrivacyRequestSettings({ siteUrl: true, title: false, workProfile: false });

    try {
      const { runAiClassification, invoke, getReusableAiClassifications } = await importServiceWithSegments([
        matchingQuerySegment,
        matchingPathSegment,
        differentPathSegment,
      ]);
      await runAiClassification({ day: "2026-05-22" });

      const reusableFingerprints = getReusableAiClassifications.mock.calls[0]?.[0] as readonly string[];
      expect(reusableFingerprints).toHaveLength(2);
      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<Record<string, unknown>> };
      expect(body.items[0]).toEqual(expect.objectContaining({
        domain: "example.com",
        urlHost: "example.com",
        siteUrl: "https://example.com/work/plan",
      }));
      expect(body.items[1]).toEqual(expect.objectContaining({
        siteUrl: "https://example.com/work/plan",
      }));
      expect(body.items[2]).toEqual(expect.objectContaining({
        siteUrl: "https://example.com/work/spec",
      }));
      expect(JSON.stringify(body)).not.toContain("user:pass");
      expect(JSON.stringify(body)).not.toContain("token=");
      expect(JSON.stringify(body)).not.toContain("#section");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("removes legacy-disabled titles and work profile from local prompts and local reusable fingerprints", async () => {
    const firstSegment = createUnknownSegment(1, {
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "example.com",
      siteTitle: "Private page title",
      siteUrl: "https://example.com/work",
      windowTitle: "Private window title",
      youtubeTitle: "Private YouTube title",
      youtubeChannelName: "Private channel",
      youtubeCategory: "Education",
    });
    const secondSegment = createUnknownSegment(2, {
      ...firstSegment,
      id: "segment-2",
      siteTitle: "Changed private page title",
      windowTitle: "Changed private window title",
      youtubeTitle: "Changed private YouTube title",
      youtubeChannelName: "Changed private channel",
      youtubeCategory: "Music",
    });

    writeAiPrivacyRequestSettings({ siteUrl: false, title: false, workProfile: false });
    writeOnboardingState("local", { workType: "Software Development", workDomain: "AI" });

    try {
      const { runAiClassification, nativeInvoke, getReusableAiClassifications } = await importServiceWithSegments([firstSegment, secondSegment], { session: null });
      await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "openrouter_byok", apiKey: "sk-or-v1-test", model: "qwen/qwen3.6-flash" },
      });

      const reusableFingerprints = getReusableAiClassifications.mock.calls[0]?.[0] as readonly string[];
      expect(reusableFingerprints).toHaveLength(1);
      const request = nativeInvoke.mock.calls[0]?.[1]?.request as { messages: Array<{ content: string }> };
      expect(request.messages[0].content).not.toContain("User work profile:");
      expect(request.messages[0].content).not.toContain("Private page title");
      expect(request.messages[0].content).not.toContain("Private window title");
      expect(request.messages[0].content).not.toContain("Private YouTube title");
      expect(request.messages[0].content).not.toContain("Private channel");
      expect(request.messages[0].content).not.toContain("Education");
      expect(request.messages[0].content).not.toContain("https://example.com/work");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("includes sanitized Other work profile values in the local prompt", async () => {
    const segment = createUnknownSegment(1);
    writeOnboardingState("local", {
      workType: "Other",
      workTypeOther: "  AI   product\nstrategy\u0000 ",
      workDomain: "Other",
      workDomainOther: " developer   tools ",
    });

    try {
      const { runAiClassification, nativeInvoke } = await importServiceWithSegments([segment], { session: null });
      await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "openrouter_byok", apiKey: "sk-or-v1-test", model: "qwen/qwen3.6-flash" },
      });

      const request = nativeInvoke.mock.calls[0]?.[1]?.request as { messages: Array<{ content: string }> };
      expect(request.messages[0].content).toContain("User work profile: Other: AI product strategy in Other: developer tools.");
      expect(request.messages[0].content).toContain("Do not include raw titles, domains, or work profile details in the reason.");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("changes AI input fingerprints when the onboarding work profile changes", async () => {
    const segment = createUnknownSegment(1);

    try {
      writeOnboardingState("local", { workType: "Software Development", workDomain: "AI" });
      const firstImport = await importServiceWithSegments([segment], { session: null });
      await firstImport.runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "openrouter_byok", apiKey: "sk-or-v1-test", model: "qwen/qwen3.6-flash" },
      });
      const firstFingerprint = firstImport.getReusableAiClassifications.mock.calls[0]?.[0]?.[0];
      cleanupServiceMocks();

      writeOnboardingState("local", { workType: "Writing", workDomain: "Media" });
      const secondImport = await importServiceWithSegments([segment], { session: null });
      await secondImport.runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "openrouter_byok", apiKey: "sk-or-v1-test", model: "qwen/qwen3.6-flash" },
      });
      const secondFingerprint = secondImport.getReusableAiClassifications.mock.calls[0]?.[0]?.[0];

      expect(firstFingerprint).toMatch(/^drifty-v3-/);
      expect(secondFingerprint).toMatch(/^drifty-v3-/);
      expect(firstFingerprint).not.toBe(secondFingerprint);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("runs OpenRouter BYOK classification locally without a Supabase session", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, invoke, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "openrouter_byok", apiKey: "sk-or-v1-test", model: "qwen/qwen3.6-flash" },
      });

      expect(result.status).toBe("saved");
      expect(invoke).not.toHaveBeenCalled();
      expect(nativeInvoke).toHaveBeenCalledWith("ai_classification_openai_chat", {
        request: expect.objectContaining({
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "sk-or-v1-test",
          model: "qwen/qwen3.6-flash",
          provider: {
            data_collection: "deny",
            zdr: true,
          },
          headers: expect.objectContaining({
            "HTTP-Referer": "https://drifty.so",
            "X-OpenRouter-Title": "Drifty",
          }),
        }),
      });
      const request = nativeInvoke.mock.calls[0]?.[1]?.request as Record<string, unknown>;
      expect(request.models).toBeUndefined();
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        aiResult: true,
        model: "qwen/qwen3.6-flash",
        latencyMs: 321,
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends OpenRouter fallback models as an ordered models array", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: {
          provider: "openrouter_byok",
          apiKey: "sk-or-v1-test",
          model: "openai/gpt-4o-mini",
          fallbackModels: ["anthropic/claude-3.5-haiku", "google/gemini-flash-1.5"],
        },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledWith("ai_classification_openai_chat", {
        request: expect.objectContaining({
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "sk-or-v1-test",
          models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku", "google/gemini-flash-1.5"],
          provider: {
            data_collection: "deny",
            zdr: true,
          },
          headers: expect.objectContaining({
            "HTTP-Referer": "https://drifty.so",
            "X-OpenRouter-Title": "Drifty",
          }),
        }),
      });
      const request = nativeInvoke.mock.calls[0]?.[1]?.request as Record<string, unknown>;
      expect(request.model).toBeUndefined();
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        aiResult: true,
        model: "openai/gpt-4o-mini",
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("defaults blank OpenRouter primary model and removes blank, Auto, or duplicate fallbacks", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: {
          provider: "openrouter_byok",
          apiKey: "sk-or-v1-test",
          model: "   ",
          fallbackModels: ["", " openrouter/auto ", "  deepseek/deepseek-v4-flash  ", "anthropic/claude-3.5-haiku", "anthropic/claude-3.5-haiku", "  "],
        },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledWith("ai_classification_openai_chat", {
        request: expect.objectContaining({
          models: ["deepseek/deepseek-v4-flash", "anthropic/claude-3.5-haiku"],
          provider: {
            data_collection: "deny",
            zdr: true,
          },
        }),
      });
      const request = nativeInvoke.mock.calls[0]?.[1]?.request as Record<string, unknown>;
      expect(request.model).toBeUndefined();
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        aiResult: true,
        model: "deepseek/deepseek-v4-flash",
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("limits OpenRouter BYOK classification fallback requests to three total model IDs", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, nativeInvoke } = await importServiceWithSegments([segment], { session: null });
      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: {
          provider: "openrouter_byok",
          apiKey: "sk-or-v1-test",
          model: "deepseek/deepseek-v4-flash",
          fallbackModels: [
            "qwen/qwen3.6-35b-a3b",
            "qwen/qwen3.6-27b",
            "z-ai/glm-4.7-flash",
            "mistralai/mistral-small-2603",
          ],
        },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledWith("ai_classification_openai_chat", {
        request: expect.objectContaining({
          models: [
            "deepseek/deepseek-v4-flash",
            "qwen/qwen3.6-35b-a3b",
            "qwen/qwen3.6-27b",
          ],
          provider: {
            data_collection: "deny",
            zdr: true,
          },
        }),
      });
    } finally {
      cleanupServiceMocks();
    }
  });

  it("preserves self-hosted requests as single model", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, nativeInvoke } = await importServiceWithSegments([segment], { session: null });
      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: {
          provider: "self_hosted",
          baseUrl: "http://localhost:11434/v1",
          model: "llama3.2",
        },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledWith("ai_classification_openai_chat", {
        request: expect.objectContaining({
          baseUrl: "http://localhost:11434/v1",
          model: "llama3.2",
        }),
      });
      const request = nativeInvoke.mock.calls[0]?.[1]?.request as Record<string, unknown>;
      expect(request.models).toBeUndefined();
    } finally {
      cleanupServiceMocks();
    }
  });

  it("starts and retries managed local classification when the selected endpoint is down", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke
        .mockResolvedValueOnce({
          state: "running",
          selectedModelId: "drifty-qwen3-5-4b-default",
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          message: "Managed local AI runtime is running.",
          artifactDir: null,
          progress: null,
        })
        .mockRejectedValueOnce("error sending request for url (http://127.0.0.1:39217/v1/chat/completions)")
        .mockResolvedValueOnce({
          state: "running",
          selectedModelId: "drifty-qwen3-5-4b-default",
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          message: "Managed local AI runtime is running.",
          artifactDir: null,
          progress: null,
        })
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify({
            choices: [{
              message: {
                content: `<think>\n\n</think>\n\n${JSON.stringify({
                  results: [{
                    id: segment.id,
                    category: "workspace",
                    productivity: "focus",
                    confidence: 0.82,
                    reason: "Local work context",
                  }],
                })}`,
              },
            }],
            usage: { prompt_tokens: 120, completion_tokens: 24 },
          }),
          latencyMs: 88,
        });

      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: {
          provider: "managed_local",
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          modelId: "drifty-qwen3-5-4b-default",
        },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenNthCalledWith(1, "managed_ai_status");
      expect(nativeInvoke).toHaveBeenNthCalledWith(2, "ai_classification_openai_chat", {
        request: expect.objectContaining({
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          maxTokens: 4096,
          timeoutMs: 180_000,
          reasoningFormat: "none",
          chatTemplateKwargs: { enable_thinking: false },
        }),
      });
      expect(nativeInvoke).toHaveBeenNthCalledWith(3, "managed_ai_start", { modelId: "drifty-qwen3-5-4b-default" });
      expect(nativeInvoke).toHaveBeenNthCalledWith(4, "ai_classification_openai_chat", {
        request: expect.objectContaining({
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          maxTokens: 4096,
          timeoutMs: 180_000,
          reasoningFormat: "none",
          chatTemplateKwargs: { enable_thinking: false },
        }),
      });
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        aiResult: true,
        model: "drifty-qwen3.5-4b-local",
        latencyMs: 88,
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("switches managed local runtime before classification when a different model is running", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke
        .mockResolvedValueOnce({
          state: "running",
          selectedModelId: "drifty-qwen3-5-2b-economy",
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-2b-local",
          message: "Managed local AI runtime is running.",
          artifactDir: null,
          progress: null,
        })
        .mockResolvedValueOnce({
          state: "running",
          selectedModelId: "drifty-qwen3-5-4b-default",
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          message: "Managed local AI runtime is running.",
          artifactDir: null,
          progress: null,
        })
        .mockResolvedValueOnce({
          status: 200,
          body: JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  results: [{
                    id: segment.id,
                    category: "workspace",
                    productivity: "focus",
                    confidence: 0.82,
                    reason: "Local work context",
                  }],
                }),
              },
            }],
          }),
          latencyMs: 91,
        });

      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: {
          provider: "managed_local",
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          modelId: "drifty-qwen3-5-4b-default",
        },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenNthCalledWith(1, "managed_ai_status");
      expect(nativeInvoke).toHaveBeenNthCalledWith(2, "managed_ai_start", { modelId: "drifty-qwen3-5-4b-default" });
      expect(nativeInvoke).toHaveBeenNthCalledWith(3, "ai_classification_openai_chat", {
        request: expect.objectContaining({
          baseUrl: "http://127.0.0.1:39217/v1",
          model: "drifty-qwen3.5-4b-local",
          maxTokens: 4096,
          timeoutMs: 180_000,
        }),
      });
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        aiResult: true,
        model: "drifty-qwen3.5-4b-local",
        latencyMs: 91,
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("reuses cached fingerprint classifications before Supabase and saves a copied AI record for the current segment", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, invoke, getSession, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([segment], {
        session: null,
        reusable: (fingerprints) => ({ [fingerprints[0]]: createReusableRecord(fingerprints[0]) }),
      });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(invoke).not.toHaveBeenCalled();
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(getReusableAiClassifications).toHaveBeenCalledTimes(1);
      expect(getReusableAiClassifications.mock.calls[0]?.[0]).toHaveLength(1);
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        source: "llm",
        aiResult: true,
        category: "learning",
      })]);
      const savedRecord = saveClassifications.mock.calls[0]?.[0]?.[0] as ActivityClassificationRecord;
      expect(savedRecord.inputFingerprint).toBe(getReusableAiClassifications.mock.calls[0]?.[0]?.[0]);
      expect(savedRecord.segmentId).not.toBe("cached-source-segment");
    } finally {
      cleanupServiceMocks();
    }
  });

  it("saves cached hits and sends only fingerprint misses to Supabase", async () => {
    const segments = [createUnknownSegment(1), createUnknownSegment(2)];

    try {
      const { runAiClassification, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments(segments, {
        reusable: (fingerprints) => ({ [fingerprints[0]]: createReusableRecord(fingerprints[0], { category: "utility" }) }),
      });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(getReusableAiClassifications.mock.calls[0]?.[0]).toHaveLength(2);
      const body = invoke.mock.calls[0]?.[1]?.body as { items: Array<{ id: string; inputFingerprint: string }> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe("segment-2");
      expect(saveClassifications).toHaveBeenCalledTimes(2);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ segmentId: "segment-1", category: "utility", aiResult: true })]);
      expect(saveClassifications.mock.calls[1]?.[0]).toEqual([expect.objectContaining({ segmentId: "segment-2", category: "workspace", aiResult: true })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("reports saved reused records when remaining misses cannot use Supabase", async () => {
    const segments = [createUnknownSegment(1), createUnknownSegment(2)];

    try {
      const { runAiClassification, invoke, getSession, saveClassifications } = await importServiceWithSegments(segments, {
        session: null,
        reusable: (fingerprints) => ({ [fingerprints[0]]: createReusableRecord(fingerprints[0], { category: "utility" }) }),
      });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(result.selectedSegments).toBe(1);
      expect(result.savedRecords).toBe(1);
      expect(result.message).toContain("Saved 1 reused AI");
      expect(result.message).toContain("Run AI classification for the remaining 1 unknown segment");
      expect(getSession).toHaveBeenCalledTimes(2);
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ segmentId: "segment-1", category: "utility", aiResult: true })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("avoids native local provider invocation when every unknown fingerprint is cached", async () => {
    const segments = [createUnknownSegment(1), createUnknownSegment(2)];

    try {
      const { runAiClassification, nativeInvoke, saveClassifications } = await importServiceWithSegments(segments, {
        session: null,
        reusable: (fingerprints) => Object.fromEntries(fingerprints.map((fingerprint) => [fingerprint, createReusableRecord(fingerprint)])),
      });
      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "openrouter_byok", apiKey: "sk-or-v1-test", model: "qwen/qwen3.6-flash" },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toHaveLength(2);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("preserves current provider behavior on fingerprint miss", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([segment]);
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(getReusableAiClassifications).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "segment-1", category: "workspace", aiResult: true, promptVersion: "v6-productivity-rubric" })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("keeps first-pass local provider payload free of enhanced context and preserves old behavior when Dev retry toggles are off", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Notion",
      siteDomain: "notion.so",
      siteTitle: "Reddit",
      adaptiveContentContext: createNotionAdaptiveContext("segment-1"),
    });

    try {
      const { runAiClassification, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke.mockResolvedValueOnce(localAiResponse("segment-1", {
        category: "unknown",
        productivity: "neutral",
        confidence: 0.5,
        reason: "Insufficient evidence",
      }));

      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledTimes(1);
      const prompt = promptFromNativeCall(nativeInvoke, 0);
      expect(prompt).not.toContain("Enhanced retry context");
      expect(prompt).not.toContain("Product research");
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        category: "unknown",
        confidence: 0.5,
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("runs exactly one enhanced retry for a low-confidence local result and saves the improved safe-context result", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Notion",
      siteDomain: "notion.so",
      siteTitle: "Reddit",
      adaptiveContentContext: createNotionAdaptiveContext("segment-1"),
    });
    enableEnhancedContextRetry();
    window.localStorage.setItem(ENHANCED_CONTEXT_COMMUNICATION_METADATA_STORAGE_KEY, "1");

    try {
      const { runAiClassification, nativeInvoke, getReusableAiClassifications, saveClassifications, readRecentEnhancedContextDebugEvents } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke
        .mockResolvedValueOnce(localAiResponse("segment-1", {
          category: "unknown",
          productivity: "neutral",
          confidence: 0.5,
          reason: "Insufficient evidence from title only",
        }))
        .mockResolvedValueOnce(localAiResponse("segment-1", {
          category: "workspace",
          productivity: "focus",
          confidence: 0.82,
          reason: "Work research context",
        }));

      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledTimes(2);
      expect(promptFromNativeCall(nativeInvoke, 0)).not.toContain("Enhanced retry context");
      const retryPrompt = promptFromNativeCall(nativeInvoke, 1);
      expect(retryPrompt).toContain("Enhanced retry context");
      expect(retryPrompt).toContain("Product research");
      expect(retryPrompt).toContain("Moderator outreach");
      expect(retryPrompt).not.toContain("blocked raw body");
      expect(retryPrompt).not.toContain("hunter2");

      const firstPassFingerprint = getReusableAiClassifications.mock.calls[0]?.[0]?.[0];
      const savedRecord = saveClassifications.mock.calls[0]?.[0]?.[0] as ActivityClassificationRecord;
      expect(savedRecord).toEqual(expect.objectContaining({
        segmentId: "segment-1",
        category: "workspace",
        confidence: 0.82,
      }));
      expect(savedRecord.inputFingerprint).toMatch(/^drifty-v3-/);
      expect(savedRecord.inputFingerprint).not.toBe(firstPassFingerprint);

      const events = readRecentEnhancedContextDebugEvents();
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "egress_decision",
          status: "allowed",
          reason: "sensitive_surface",
          egress: expect.objectContaining({
            providerSafeItemCount: 2,
            decisionCounts: expect.objectContaining({ metadata_only: 2, blocked: 1 }),
            dropReasonCounts: expect.objectContaining({ raw_collector_output: 1 }),
          }),
        }),
        expect.objectContaining({
          kind: "retry_decision",
          status: "retry_sent",
          reason: "unknown_category",
          retry: {
            threshold: 0.55,
            firstPassConfidence: 0.5,
            firstPassCategory: "unknown",
            providerSafeItemCount: 2,
          },
        }),
        expect.objectContaining({
          kind: "retry_decision",
          status: "selected",
          reason: "unknown_category",
          retry: {
            threshold: 0.55,
            firstPassConfidence: 0.5,
            firstPassCategory: "unknown",
            providerSafeItemCount: 2,
            selectedResult: "enhanced_retry",
          },
        }),
      ]));
    } finally {
      cleanupServiceMocks();
    }
  });

  it("skips enhanced retry for high-confidence local results even when safe context exists", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Notion",
      siteDomain: "notion.so",
      siteTitle: "Reddit",
      adaptiveContentContext: createNotionAdaptiveContext("segment-1"),
    });
    enableEnhancedContextRetry();

    try {
      const { runAiClassification, nativeInvoke, readRecentEnhancedContextDebugEvents } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke.mockResolvedValueOnce(localAiResponse("segment-1", {
        category: "workspace",
        productivity: "focus",
        confidence: 0.86,
        reason: "Clear work context from primary evidence",
      }));

      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledTimes(1);
      expect(readRecentEnhancedContextDebugEvents()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "retry_decision",
          status: "retry_skipped",
          reason: "high_confidence",
          retry: {
            threshold: 0.55,
            firstPassConfidence: 0.86,
            firstPassCategory: "workspace",
            providerSafeItemCount: 2,
          },
        }),
      ]));
    } finally {
      cleanupServiceMocks();
    }
  });

  it("skips enhanced retry when policy leaves no provider-safe context and records the decision", async () => {
    const segment = createUnknownSegment(1, {
      adaptiveContentContext: createBlockedAdaptiveContext("segment-1"),
    });
    enableEnhancedContextRetry();

    try {
      const { runAiClassification, nativeInvoke, readRecentEnhancedContextDebugEvents } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke.mockResolvedValueOnce(localAiResponse("segment-1", {
        category: "unknown",
        productivity: "neutral",
        confidence: 0.42,
        reason: "Insufficient evidence from title only",
      }));

      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledTimes(1);
      expect(readRecentEnhancedContextDebugEvents()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "egress_decision",
          egress: expect.objectContaining({
            providerSafeItemCount: 0,
            decisionCounts: expect.objectContaining({ local_only: 1 }),
            dropReasonCounts: expect.objectContaining({ raw_collector_output: 1 }),
          }),
        }),
        expect.objectContaining({
          kind: "retry_decision",
          status: "retry_skipped",
          reason: "no_provider_safe_context",
          retry: {
            threshold: 0.55,
            firstPassConfidence: 0.42,
            firstPassCategory: "unknown",
            providerSafeItemCount: 0,
          },
        }),
      ]));
    } finally {
      cleanupServiceMocks();
    }
  });

  it("does not retry the same first-pass fingerprint more than once", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Notion",
      siteDomain: "notion.so",
      siteTitle: "Reddit",
      adaptiveContentContext: createNotionAdaptiveContext("segment-1"),
    });
    enableEnhancedContextRetry();

    try {
      const { runAiClassification, nativeInvoke, readRecentEnhancedContextDebugEvents } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke
        .mockResolvedValueOnce(localAiResponse("segment-1", {
          category: "unknown",
          productivity: "neutral",
          confidence: 0.5,
          reason: "Insufficient evidence from title only",
        }))
        .mockResolvedValueOnce(localAiResponse("segment-1", {
          category: "workspace",
          productivity: "focus",
          confidence: 0.82,
          reason: "Work research context",
        }))
        .mockResolvedValueOnce(localAiResponse("segment-1", {
          category: "unknown",
          productivity: "neutral",
          confidence: 0.5,
          reason: "Insufficient evidence from title only",
        }));

      await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });
      await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });

      expect(nativeInvoke).toHaveBeenCalledTimes(3);
      const prompts = nativeInvoke.mock.calls.map((_, index) => promptFromNativeCall(nativeInvoke, index));
      expect(prompts.filter((prompt) => prompt.includes("Enhanced retry context"))).toHaveLength(1);
      expect(readRecentEnhancedContextDebugEvents()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "retry_decision",
          status: "retry_skipped",
          reason: "already_retried",
          retry: {
            threshold: 0.55,
            firstPassConfidence: 0.5,
            firstPassCategory: "unknown",
            providerSafeItemCount: 2,
          },
        }),
      ]));
    } finally {
      cleanupServiceMocks();
    }
  });

  it("keeps the first-pass result when enhanced retry does not improve a low-confidence classification", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Notion",
      siteDomain: "notion.so",
      siteTitle: "Reddit",
      adaptiveContentContext: createNotionAdaptiveContext("segment-1"),
    });
    enableEnhancedContextRetry();

    try {
      const { runAiClassification, nativeInvoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      nativeInvoke.mockReset();
      nativeInvoke
        .mockResolvedValueOnce(localAiResponse("segment-1", {
          category: "utility",
          productivity: "neutral",
          confidence: 0.54,
          reason: "Possibly account setup",
        }))
        .mockResolvedValueOnce(localAiResponse("segment-1", {
          category: "unknown",
          productivity: "neutral",
          confidence: 0.9,
          reason: "Still insufficient evidence",
        }));

      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });

      expect(result.status).toBe("saved");
      expect(nativeInvoke).toHaveBeenCalledTimes(2);
      const firstPassFingerprint = getReusableAiClassifications.mock.calls[0]?.[0]?.[0];
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        inputFingerprint: firstPassFingerprint,
        category: "utility",
        confidence: 0.54,
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("classifies a supplied live segment with cloud AI without saving synthetic current snapshots", async () => {
    const segment = createUnknownSegment(1, {
      id: "current:2026-05-22T09:05:00.000Z",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "Video",
      siteUrl: "https://www.youtube.com/watch?v=lecture",
      youtubeVideoId: "lecture",
      youtubeCategory: "Entertainment",
    });

    try {
      const { classifyLiveActivityWithAi, invoke, saveClassifications } = await importServiceWithSegments([segment], {
        edgeResult: {
          category: "entertainment",
          productivity: "drift",
          confidence: 0.86,
          reason: "AI confirms drift video",
        },
      });
      const result = await classifyLiveActivityWithAi(segment);

      expect(result.kind).toBe("classified");
      if (result.kind !== "classified") throw new Error("Expected live AI classification to return a classified result.");
      expect(result.classification).toEqual(expect.objectContaining({
        segmentId: segment.id,
        category: "entertainment",
        productivity: "drift",
        source: "llm",
        aiResult: true,
      }));
      expect(invoke).toHaveBeenCalledWith("classify-activity", {
        body: expect.objectContaining({
          items: [expect.objectContaining({
            id: segment.id,
            domain: "youtube.com",
            urlHost: "youtube.com",
            title: "Video",
            durationSeconds: 300,
          })],
        }),
      });
      expect(saveClassifications).not.toHaveBeenCalled();
    } finally {
      cleanupServiceMocks();
    }
  });

  it("saves supplied live segment classifications when persistence is requested", async () => {
    const segment = createUnknownSegment(1, {
      id: "42",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "Video",
      siteUrl: "https://www.youtube.com/watch?v=lecture",
      youtubeVideoId: "lecture",
      youtubeCategory: "Entertainment",
    });

    try {
      const { classifyLiveActivityWithAi, saveClassifications } = await importServiceWithSegments([segment], {
        edgeResult: {
          category: "entertainment",
          productivity: "drift",
          confidence: 0.86,
          reason: "AI confirms drift video",
        },
      });
      const result = await classifyLiveActivityWithAi(segment, { persistLiveResult: true });

      expect(result.kind).toBe("classified");
      expect(saveClassifications).toHaveBeenCalledWith([
        expect.objectContaining({
          segmentId: "42",
          category: "entertainment",
          productivity: "drift",
          source: "llm",
          aiResult: true,
        }),
      ]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("keeps supplied live segment classifications when optional persistence fails", async () => {
    const segment = createUnknownSegment(1, {
      id: "42",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "Video",
      siteUrl: "https://www.youtube.com/watch?v=lecture",
      youtubeVideoId: "lecture",
      youtubeCategory: "Entertainment",
    });

    try {
      const { classifyLiveActivityWithAi, saveClassifications } = await importServiceWithSegments([segment], {
        edgeResult: {
          category: "entertainment",
          productivity: "drift",
          confidence: 0.86,
          reason: "AI confirms drift video",
        },
        saveError: new Error("tracker unavailable"),
      });
      const result = await classifyLiveActivityWithAi(segment, { persistLiveResult: true });

      expect(result).toMatchObject({
        kind: "classified",
        classification: {
          segmentId: "42",
          category: "entertainment",
          productivity: "drift",
        },
      });
      expect(saveClassifications).toHaveBeenCalledTimes(1);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("reuses cached AI classifications for supplied live segments without a provider call or save", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "Video",
      siteUrl: "https://www.youtube.com/watch?v=focus",
      youtubeVideoId: "focus",
      youtubeCategory: "Education",
    });

    try {
      const { classifyLiveActivityWithAi, invoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([segment], {
        reusable: (fingerprints) => ({ [fingerprints[0]]: createReusableRecord(fingerprints[0], { category: "learning", productivity: "focus" }) }),
      });
      const result = await classifyLiveActivityWithAi(segment);

      expect(result.kind).toBe("classified");
      if (result.kind !== "classified") throw new Error("Expected live AI classification reuse to return a classified result.");
      expect(result.classification).toEqual(expect.objectContaining({
        segmentId: segment.id,
        category: "learning",
        productivity: "focus",
        source: "llm",
      }));
      expect(getReusableAiClassifications).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).not.toHaveBeenCalled();
    } finally {
      cleanupServiceMocks();
    }
  });

  it("returns unavailable for supplied live segments when local AI provider fails", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "Video",
      siteUrl: "https://www.youtube.com/watch?v=maybe-work",
      youtubeVideoId: "maybe-work",
      youtubeCategory: "People & Blogs",
    });

    try {
      const { classifyLiveActivityWithAi, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], {
        session: null,
        nativeStatus: 503,
      });
      const result = await classifyLiveActivityWithAi(segment, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.2" },
      });

      expect(result.kind).toBe("unavailable");
      if (result.kind !== "unavailable") throw new Error("Expected failed local live AI classification to be unavailable.");
      expect(result.reason).toContain("Local AI classification failed");
      expect(nativeInvoke).toHaveBeenCalledTimes(1);
      expect(saveClassifications).not.toHaveBeenCalled();
    } finally {
      cleanupServiceMocks();
    }
  });

  it("inherits YouTube browse classification from a nearby video within 180 seconds", async () => {
    const browse = createYouTubeBrowseSegment(1, "https://www.youtube.com/results?search_query=typescript");
    const neighbor = createYouTubeVideoSegment(2, {
      startedAt: "2026-05-22T09:07:30.000Z",
      endedAt: "2026-05-22T09:12:30.000Z",
      durationSeconds: 300,
      classification: {
        category: "entertainment",
        productivity: "drift",
        source: "manual",
        confidence: 0.96,
        reason: "Test video drift classification",
      },
    });

    try {
      const { runAiClassification, invoke, nativeInvoke, getTimeline, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments([browse], { timeline: [browse, neighbor] });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(result.savedRecords).toBe(1);
      expect(getTimeline).toHaveBeenCalledWith({ start: "2026-05-22T08:57:00.000Z", end: "2026-05-22T09:08:00.000Z" });
      expect(getReusableAiClassifications).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(nativeInvoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([expect.objectContaining({
        segmentId: "segment-1",
        category: "entertainment",
        productivity: "drift",
        source: "system",
        confidence: 0.85,
        reason: "Inherited classification from nearby YouTube video activity.",
        aiResult: false,
        model: null,
        promptVersion: null,
        taxonomyVersion: "v1",
        latencyMs: null,
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("does not inherit from a video 181 seconds away and falls back to sustained-browse drift without AI", async () => {
    const browse = createYouTubeBrowseSegment(1, "https://www.youtube.com/");
    const neighbor = createYouTubeVideoSegment(2, {
      startedAt: "2026-05-22T09:08:01.000Z",
      endedAt: "2026-05-22T09:13:01.000Z",
      durationSeconds: 300,
    });

    try {
      const { runAiClassification, invoke, saveClassifications } = await importServiceWithSegments([browse], { timeline: [neighbor] });
      const result = await runAiClassification({ day: "2026-05-22" });

      // Too far to inherit (181s > 180s), and a bare browse page has no content for AI —
      // so the sustained-browse=drift fallback classifies it deterministically.
      expect(result.status).toBe("saved");
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ segmentId: "segment-1", source: "youtube", category: "entertainment", productivity: "drift", aiResult: false }),
      ]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("falls back a brief isolated YouTube browse page to neutral unknown without AI", async () => {
    const browse = createYouTubeBrowseSegment(1, "https://www.youtube.com/");
    browse.durationSeconds = 12;
    browse.endedAt = "2026-05-22T09:00:12.000Z";

    try {
      const { runAiClassification, invoke, saveClassifications } = await importServiceWithSegments([browse], { timeline: [] });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ segmentId: "segment-1", source: "youtube", category: "unknown", productivity: "neutral", aiResult: false }),
      ]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("uses nearest classified YouTube video with confidence, duration, and start-time tie breakers", async () => {
    const browse = createYouTubeBrowseSegment(1, "https://www.youtube.com/results?search_query=workspace");
    const lowerConfidence = createYouTubeVideoSegment(2, {
      startedAt: "2026-05-22T08:59:00.000Z",
      endedAt: "2026-05-22T09:00:00.000Z",
      durationSeconds: 60,
      classification: { category: "entertainment", productivity: "drift", source: "manual", confidence: 0.7, reason: "Test" },
    });
    const shorter = createYouTubeVideoSegment(3, {
      startedAt: "2026-05-22T09:06:00.000Z",
      endedAt: "2026-05-22T09:07:00.000Z",
      durationSeconds: 60,
      classification: { category: "learning", productivity: "focus", source: "manual", confidence: 0.9, reason: "Test" },
    });
    const longer = createYouTubeVideoSegment(4, {
      startedAt: "2026-05-22T08:57:00.000Z",
      endedAt: "2026-05-22T09:00:00.000Z",
      durationSeconds: 180,
      classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 0.9, reason: "Test" },
    });

    try {
      const { runAiClassification, saveClassifications } = await importServiceWithSegments([browse], { timeline: [lowerConfidence, shorter, longer] });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([expect.objectContaining({
        segmentId: "segment-1",
        category: "workspace",
        productivity: "focus",
        source: "system",
      })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("keeps deterministic and inherited YouTube browse pages out of Edge and local AI payloads", async () => {
    const browseSegments = [
      createYouTubeBrowseSegment(1, "https://www.youtube.com/"),
      createYouTubeBrowseSegment(2, "https://www.youtube.com/feed"),
      createYouTubeBrowseSegment(3, "https://www.youtube.com/results?search_query=typescript"),
      createYouTubeBrowseSegment(4, "https://www.youtube.com/@drifty/videos"),
    ];
    const neighbor = createYouTubeVideoSegment(5, {
      startedAt: "2026-05-22T08:58:00.000Z",
      endedAt: "2026-05-22T09:00:00.000Z",
      durationSeconds: 120,
    });

    try {
      const { runAiClassification, invoke, nativeInvoke, getReusableAiClassifications, saveClassifications } = await importServiceWithSegments(browseSegments, { timeline: [neighbor] });
      const edgeResult = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "openrouter_byok", apiKey: "sk-or-v1-test", model: "qwen/qwen3.6-flash" },
      });

      expect(edgeResult.status).toBe("saved");
      expect(invoke).not.toHaveBeenCalled();
      expect(nativeInvoke).not.toHaveBeenCalled();
      expect(getReusableAiClassifications).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(2);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ segmentId: "segment-2", source: "rule", category: "entertainment", productivity: "drift", aiResult: false }),
      ]);
      expect(saveClassifications.mock.calls[1]?.[0]).toHaveLength(3);
      expect(saveClassifications.mock.calls[1]?.[0]).toEqual(expect.arrayContaining([
        expect.objectContaining({ segmentId: "segment-1", source: "system", aiResult: false }),
        expect.objectContaining({ segmentId: "segment-3", source: "system", aiResult: false }),
        expect.objectContaining({ segmentId: "segment-4", source: "system", aiResult: false }),
      ]));
    } finally {
      cleanupServiceMocks();
    }
  });

  it("saves deterministic rule rows before AI cache reuse and does not overwrite them", async () => {
    const deterministicSegment = createUnknownSegment(99, {
      appName: "Visual Studio Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "Project implementation",
    });
    const unknownSegment = createUnknownSegment(1);

    try {
      const { runAiClassification, invoke, saveClassifications } = await importServiceWithSegments([deterministicSegment, unknownSegment], {
        reusable: (fingerprints) => ({ [fingerprints[0]]: createReusableRecord(fingerprints[0], { category: "learning" }) }),
      });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(invoke).not.toHaveBeenCalled();
      expect(saveClassifications).toHaveBeenCalledTimes(2);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ segmentId: "segment-99", aiResult: false, source: "rule" })]);
      expect(saveClassifications.mock.calls[1]?.[0]).toEqual([expect.objectContaining({ segmentId: "segment-1", aiResult: true, source: "llm" })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("does not call local AI when self-hosted setup is incomplete", async () => {
    const segment = createUnknownSegment(1);

    try {
      const { runAiClassification, nativeInvoke, saveClassifications } = await importServiceWithSegments([segment], { session: null });
      const result = await runAiClassification({ day: "2026-05-22" }, 20, {
        localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "" },
      });

      expect(result.status).toBe("disabled");
      expect(nativeInvoke).not.toHaveBeenCalled();
      expect(saveClassifications).not.toHaveBeenCalled();
    } finally {
      cleanupServiceMocks();
    }
  });
});

import { clusterPayloadsByLevel, expandClusterRecords } from "./aiClassificationService";
import type { MinimizedActivityPayload } from "./localAiProviderRequest";

function payload(id: string, siteDomain: string | null, siteTitle: string | null, overrides: Partial<MinimizedActivityPayload> = {}): MinimizedActivityPayload {
  return {
    segmentId: id, inputFingerprint: `fp-${id}`, startedAt: "2026-07-03T00:00:00Z", endedAt: "2026-07-03T00:01:00Z",
    durationSeconds: 60, appName: "Google Chrome", bundleId: null, browserName: "Google Chrome",
    siteDomain, siteUrl: siteDomain ? `https://${siteDomain}/x` : null, siteTitle, windowTitle: siteTitle,
    youtubeTitle: null, youtubeChannelName: null, youtubeCategory: null, youtubeIsShorts: null,
    ...overrides,
  };
}

describe("classification level clustering", () => {
  const misses = [
    payload("a", "github.com", "user/repo issues"),
    payload("b", "github.com", "user/repo issues"),   // same domain+title as a
    payload("c", "github.com", "torvalds profile"),   // same domain, different title
    payload("d", "youtube.com", "coding tutorial"),
  ];

  it("fine keeps every segment (no clustering)", () => {
    const { representatives, membersByRepSegmentId } = clusterPayloadsByLevel(misses, "fine");
    expect(representatives).toHaveLength(4);
    expect(membersByRepSegmentId).toBeNull();
  });

  it("normal clusters by domain+title", () => {
    const { representatives, membersByRepSegmentId } = clusterPayloadsByLevel(misses, "normal");
    // a+b merge (same domain+title); c and d separate -> 3 representatives
    expect(representatives.map((r) => r.segmentId).sort()).toEqual(["a", "c", "d"]);
    expect(membersByRepSegmentId?.get("a")?.map((m) => m.segmentId)).toEqual(["a", "b"]);
  });

  it("coarse clusters by domain only", () => {
    const { representatives } = clusterPayloadsByLevel(misses, "coarse");
    // all github into one, youtube one -> 2 representatives
    expect(representatives).toHaveLength(2);
  });

  it("normal keeps different desktop apps with identical empty titles in separate clusters", () => {
    const appMisses = [
      payload("e", null, null, { appName: "Xcode", bundleId: "com.apple.dt.Xcode", browserName: null }),
      payload("f", null, null, { appName: "Figma", bundleId: "com.figma.Desktop", browserName: null }),
    ];
    const { representatives } = clusterPayloadsByLevel(appMisses, "normal");
    expect(representatives.map((r) => r.segmentId).sort()).toEqual(["e", "f"]);
  });

  it("coarse keeps different desktop apps without a domain in separate clusters", () => {
    const appMisses = [
      payload("e", null, null, { appName: "Xcode", bundleId: null, browserName: null }),
      payload("f", null, null, { appName: "Figma", bundleId: null, browserName: null }),
    ];
    const { representatives } = clusterPayloadsByLevel(appMisses, "coarse");
    expect(representatives.map((r) => r.segmentId).sort()).toEqual(["e", "f"]);
  });

  it("expandClusterRecords fans a representative result out to all members", () => {
    const { representatives, membersByRepSegmentId } = clusterPayloadsByLevel(misses, "normal");
    const repRecord = {
      segmentId: "a", inputFingerprint: "fp-a", category: "workspace", productivity: "focus",
      source: "llm", confidence: 0.9, reason: "r", model: "m", promptVersion: null,
      taxonomyVersion: null, inputHash: null, aiResult: true, stale: false, classifiedAt: "2026-07-03T00:00:00Z",
    } as unknown as import("@drifty/domain").ActivityClassificationRecord;
    const expanded = expandClusterRecords([repRecord], membersByRepSegmentId);
    const forA = expanded.filter((r) => r.segmentId === "a" || r.segmentId === "b");
    expect(forA.map((r) => r.segmentId).sort()).toEqual(["a", "b"]);
    expect(forA.every((r) => r.category === "workspace" && r.productivity === "focus")).toBe(true);
    // each fanned record carries its own segment's fingerprint
    expect(expanded.find((r) => r.segmentId === "b")?.inputFingerprint).toBe("fp-b");
  });
});
