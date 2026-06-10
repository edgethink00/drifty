import type { ActivityClassificationRecord, ActivitySegment, ClassificationMetrics } from "@drifty/domain";
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
    const saveClassifications = vi.fn((records: unknown[]) => Promise.resolve({ saved: records.length }));
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
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: nativeInvoke }));
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
    return { ...service, invoke, nativeInvoke, getSession, getUnclassifiedSegments, getTimeline, getReusableAiClassifications, saveClassifications, getClassificationMetrics };
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
    writeOnboardingState("user-1", { workType: "Software Development", workDomain: "AI" });

    try {
      const { runAiClassification, invoke } = await importServiceWithSegments([segment], {
        session: { access_token: "token", user: { id: "user-1" } },
      });
      await runAiClassification({ day: "2026-05-22" });

      const body = invoke.mock.calls[0]?.[1]?.body as Record<string, unknown>;
      expect(body.workProfile).toBe("Software Development in AI");
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

      expect(firstFingerprint).toMatch(/^drifty-v2-/);
      expect(secondFingerprint).toMatch(/^drifty-v2-/);
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
      expect(saveClassifications).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "segment-1", category: "workspace", aiResult: true, promptVersion: "v2-work-profile" })]);
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

  it("does not inherit YouTube browse classification from a video 181 seconds away", async () => {
    const browse = createYouTubeBrowseSegment(1, "https://www.youtube.com/");
    const neighbor = createYouTubeVideoSegment(2, {
      startedAt: "2026-05-22T09:08:01.000Z",
      endedAt: "2026-05-22T09:13:01.000Z",
      durationSeconds: 300,
    });

    try {
      const { runAiClassification, invoke, saveClassifications } = await importServiceWithSegments([browse], { timeline: [neighbor] });
      const result = await runAiClassification({ day: "2026-05-22" });

      expect(result.status).toBe("saved");
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ segmentId: "segment-1", source: "llm", aiResult: true })]);
    } finally {
      cleanupServiceMocks();
    }
  });

  it("uses nearest classified YouTube video with confidence, duration, and start-time tie breakers", async () => {
    const browse = createYouTubeBrowseSegment(1, "https://www.youtube.com/feed/subscriptions");
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

  it("keeps inherited YouTube home, feed, search, and channel pages out of Edge and local AI payloads", async () => {
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
      expect(saveClassifications).toHaveBeenCalledTimes(1);
      expect(saveClassifications.mock.calls[0]?.[0]).toHaveLength(4);
      expect(saveClassifications.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(browseSegments.map((segment) => expect.objectContaining({ segmentId: segment.id, source: "system", aiResult: false }))));
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
