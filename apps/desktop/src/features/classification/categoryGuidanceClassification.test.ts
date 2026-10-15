import type { ActivityClassificationRecord, ActivitySegment, ClassificationMetrics } from "@drifty/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

const CATEGORY_CUSTOMIZATION_STORAGE_KEY = "drifty.categoryCustomizations.v1";
const GUIDANCE = { learning: { name: "Dev study", description: "Coding tutorials, conference talks, and WWDC sessions." } };

const metrics: ClassificationMetrics = {
  totalSegments: 1,
  classifiedSegments: 1,
  unclassifiedSegments: 0,
  aiClassifiedSegments: 1,
  staleClassifications: 0,
};

function segment(id: string, overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id,
    startedAt: "2026-10-10T09:00:00.000Z",
    endedAt: "2026-10-10T09:10:00.000Z",
    durationSeconds: 600,
    appName: "Arc",
    browserName: "Arc",
    siteDomain: "example.tv",
    siteTitle: `Episode ${id}`,
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

function youtubeVideo(id: string, overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return segment(id, {
    siteDomain: "youtube.com",
    siteTitle: "WWDC recaps",
    siteUrl: `https://www.youtube.com/watch?v=${id}`,
    youtubeVideoId: id,
    youtubeCategory: "Entertainment",
    ...overrides,
  });
}

async function loadService(input: {
  readonly guidance?: boolean;
  readonly unclassified?: ActivitySegment[];
  readonly edgeData?: (items: Array<{ id: string }>) => Record<string, unknown>;
}) {
  vi.resetModules();
  const values = new Map<string, string>();
  if (input.guidance) values.set(CATEGORY_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(GUIDANCE));
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
  vi.stubGlobal("window", { localStorage, dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", localStorage);

  type EdgeRequest = { body: { items: Array<{ id: string; inputFingerprint: string }>; categoryGuidance?: unknown } };
  const invoke = vi.fn(async (_name: string, request: EdgeRequest) => ({
    data: input.edgeData?.(request.body.items) ?? {
      model: "anthropic/claude-haiku-5.5",
      categoryGuidanceApplied: true,
      results: request.body.items.map((item) => ({ id: item.id, category: "learning", intent: "work_support", confidence: 0.82, reason: "Matches the learning definition" })),
    },
    error: null,
  }));
  const saveClassifications = vi.fn((records: ActivityClassificationRecord[]) => Promise.resolve({ saved: records.length }));
  vi.doMock("../../lib/supabase/client", () => ({
    supabase: {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "token", user: { id: "user-1" } } } }) },
      functions: { invoke },
    },
  }));
  vi.doMock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null), isTauri: () => false }));
  vi.doMock("../../lib/api/trackerClient", () => ({
    trackerClient: {
      getUnclassifiedSegments: vi.fn().mockResolvedValue(input.unclassified ?? []),
      getTimeline: vi.fn().mockResolvedValue([]),
      getReusableAiClassifications: vi.fn().mockResolvedValue({}),
      saveClassifications,
      getClassificationMetrics: vi.fn().mockResolvedValue(metrics),
    },
  }));
  const service = await import("./aiClassificationService");
  const privacy = await import("../settings/aiPrivacyRequestSettings");
  return { ...service, readAiPrivacyRequestSettings: privacy.readAiPrivacyRequestSettings, invoke, saveClassifications };
}

describe("category guidance in AI classification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock("../../lib/supabase/client");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../lib/api/trackerClient");
  });

  it("keeps existing fingerprints for users without descriptions and scopes them for users with some", async () => {
    const service = await loadService({});
    const memory = { soul: null, episodeByItemId: {} };
    const privacy = service.readAiPrivacyRequestSettings();
    const unguided = await service.toMinimizedPayload(segment("a"), null, privacy, memory);
    const guided = await service.toMinimizedPayload(segment("a"), null, privacy, memory, [{ category: "learning", description: "Conference talks" }]);

    expect(unguided).not.toHaveProperty("categoryGuidance");
    expect(guided.inputFingerprint).not.toBe(unguided.inputFingerprint);
    expect(guided.baseInputFingerprint).toBe(unguided.inputFingerprint);
  });

  it("sends the descriptions and files the answer under the guided fingerprint when the function applied them", async () => {
    const service = await loadService({ guidance: true, unclassified: [segment("a")] });

    await service.runAiClassification({ day: "2026-10-10" });

    const body = service.invoke.mock.calls[0][1].body;
    expect(body.categoryGuidance).toEqual([{ category: "learning", name: "Dev study", description: GUIDANCE.learning.description }]);
    const saved = service.saveClassifications.mock.calls[0][0];
    expect(saved).toEqual([expect.objectContaining({ segmentId: "a", category: "learning", inputFingerprint: body.items[0].inputFingerprint })]);
  });

  it("never caches an answer from a deploy that ignored the descriptions as a guided one", async () => {
    const service = await loadService({
      guidance: true,
      unclassified: [segment("a")],
      edgeData: (items) => ({
        model: "anthropic/claude-haiku-5.5",
        results: items.map((item) => ({ id: item.id, category: "entertainment", intent: "leisure", confidence: 0.8, reason: "Leisure video" })),
      }),
    });

    await service.runAiClassification({ day: "2026-10-10" });

    const body = service.invoke.mock.calls[0][1].body;
    const saved = service.saveClassifications.mock.calls[0][0];
    expect(saved[0].category).toBe("entertainment");
    expect(saved[0].inputFingerprint).not.toBe(body.items[0].inputFingerprint);
  });

  it("lets the model read a YouTube video's topic only while descriptions exist", async () => {
    const withGuidance = await loadService({ guidance: true, unclassified: [youtubeVideo("v1")] });
    await withGuidance.runAiClassification({ day: "2026-10-10" });
    expect(withGuidance.invoke).toHaveBeenCalledTimes(1);
    expect(withGuidance.saveClassifications.mock.calls[0][0][0]).toMatchObject({ segmentId: "v1", source: "llm", category: "learning" });

    const withoutGuidance = await loadService({ unclassified: [youtubeVideo("v1")] });
    await withoutGuidance.runAiClassification({ day: "2026-10-10" });
    expect(withoutGuidance.invoke).not.toHaveBeenCalled();
    expect(withoutGuidance.saveClassifications.mock.calls[0][0][0]).toMatchObject({ segmentId: "v1", source: "rule", category: "entertainment" });
  });
});
