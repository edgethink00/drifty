import type { ActivityClassificationRecord, ActivitySegment, ClassificationMetrics } from "@dtime/domain";
import { describe, expect, it, vi } from "vitest";
import { CLOUD_API_CLIENT_VERSION, CLOUD_API_CONTRACT_VERSION } from "../../lib/cloudContract";
import { AI_CLASSIFICATION_BACKGROUND_THRESHOLD, AI_CLASSIFICATION_FOCUSED_IDLE_MS, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, diffAiClassificationUsageSummary, estimateAiClassificationCostUsd, projectAiClassificationCost, type AiClassificationUsageSummary } from "./aiClassificationService";

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
  it("uses model-specific pricing for Gemini, OpenRouter free, and OpenRouter paid rows", () => {
    expect(estimateAiClassificationCostUsd("gemini-3.1-flash-lite", 1_000_000, 1_000_000)).toBeCloseTo(1.75);
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

  async function importServiceWithSegments(segments: ActivitySegment[], options: { session?: unknown; reusable?: (fingerprints: string[]) => Record<string, ActivityClassificationRecord> } = {}) {
    vi.resetModules();

    const invoke = vi.fn().mockResolvedValue({
      data: {
        model: "gemini-3.1-flash-lite",
        results: segments.map((segment) => ({
          id: segment.id,
          category: "workspace",
          productivity: "focus",
          confidence: 0.8,
          reason: "Work context",
        })),
      },
      error: null,
    });
    const getUnclassifiedSegments = vi.fn().mockResolvedValue(segments);
    const saveClassifications = vi.fn((records: unknown[]) => Promise.resolve({ saved: records.length }));
    const getClassificationMetrics = vi.fn().mockResolvedValue(baseMetrics);
    const getReusableAiClassifications = vi.fn((fingerprints: string[]) => Promise.resolve(options.reusable?.(fingerprints) ?? {}));
    const getSession = vi.fn().mockResolvedValue({
      data: { session: "session" in options ? options.session : { access_token: "token" } },
    });
    const nativeInvoke = vi.fn().mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              results: segments.map((segment) => ({
                id: segment.id,
                category: "workspace",
                productivity: "focus",
                confidence: 0.82,
                reason: "Local work context",
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
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: nativeInvoke }));
    vi.doMock("../../lib/api/trackerClient", () => ({
      trackerClient: {
        getUnclassifiedSegments,
        getReusableAiClassifications,
        saveClassifications,
        getClassificationMetrics,
      },
    }));

    const service = await import("./aiClassificationService");
    return { ...service, invoke, nativeInvoke, getSession, getUnclassifiedSegments, getReusableAiClassifications, saveClassifications, getClassificationMetrics };
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

  function cleanupServiceMocks() {
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

  it("sends only minimized allowed fields to the Edge Function", async () => {
    const segment = createUnknownSegment(1, {
      bundleId: "com.secret.RawApp",
      browserName: "Arc",
      siteDomain: "example.com",
      siteTitle: "Example private page",
      siteUrl: "https://example.com/private/raw-url",
      youtubeTitle: "Allowed video title",
      youtubeChannelName: "Allowed channel",
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
        "title",
        "urlHost",
        "windowTitle",
      ].sort());
      expect(body.items[0]).toEqual(expect.objectContaining({
        id: "segment-1",
        appName: "MysteryApp",
        domain: "example.com",
        urlHost: "example.com",
        title: "Example private page",
        windowTitle: "Unmapped task 1",
        durationSeconds: 300,
      }));
      expect(body.items[0]).not.toHaveProperty("startedAt");
      expect(body.items[0]).not.toHaveProperty("endedAt");
      expect(body.items[0]).not.toHaveProperty("bundleId");
      expect(body.items[0]).not.toHaveProperty("browserName");
      expect(JSON.stringify(body)).not.toContain("raw youtube description must stay local");
      expect(JSON.stringify(body)).not.toContain("private/raw-url");
      expect(JSON.stringify(body)).not.toContain("keywords");
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
      expect(getSession).not.toHaveBeenCalled();
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
      expect(getSession).toHaveBeenCalledTimes(1);
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
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "segment-1", category: "workspace", aiResult: true })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("sends YouTube search pages to AI instead of saving a deterministic entertainment rule", async () => {
    const segment = createUnknownSegment(1, {
      appName: "Safari",
      browserName: "Safari",
      siteDomain: "youtube.com",
      siteTitle: "YouTube Search",
      siteUrl: "https://www.youtube.com/results?search_query=typescript",
    });

    try {
      const { runAiClassification, invoke, saveClassifications } = await importServiceWithSegments([segment]);
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
        segmentId: "segment-1",
        source: "llm",
        aiResult: true,
      })]);
      expect(saveClassifications.mock.calls[0]?.[0]).not.toEqual([expect.objectContaining({
        segmentId: "segment-1",
        source: "rule",
        aiResult: false,
      })]);
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
