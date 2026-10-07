import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { resolveIntelligenceRoute } from "../settings/intelligenceRouting";
import { createProjectPassInference } from "./projectPassInference";
import { buildProjectPassAnalysisWindows, type ActivityCategory, type ActivityClassificationRecord, type ActivitySegment, type Project, type ProductivityLabel, type StoredClassificationSource, type TrackerApi } from "@drifty/domain";
import {
  chunkProjectPassWindows,
  parseProjectPassOutput,
  projectPassChunkFingerprint,
  PROJECT_PASS_MAX_CHUNK_WINDOWS,
  resolveProjectPassApply,
  runProjectPass,
  type ProjectPassInference,
  type ProjectPassOutput,
} from "./aiProjectReviewService";

function seg(
  fields: Pick<ActivitySegment, "id" | "startedAt" | "endedAt" | "durationSeconds" | "appName"> & Partial<ActivitySegment>,
): ActivitySegment {
  return { platform: "macos", source: "accessibility", ...fields };
}

function classified(
  id: string,
  startedAt: string,
  endedAt: string,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
  source: StoredClassificationSource = "llm",
): ActivitySegment {
  return seg({
    id,
    startedAt,
    endedAt,
    durationSeconds: Math.max(0, (Date.parse(endedAt) - Date.parse(startedAt)) / 1000),
    appName,
    classification: { category, productivity, source, confidence: 0.8, inputFingerprint: `fp-${id}` },
  });
}

const EXPECTED_CONTEXT_WINDOW_OVERLAP = 4;
const EXPECTED_MAX_PARALLEL_CHUNKS = 3;
const CONTEXT_POLICY = { siteUrl: true, windowTitle: true, contentContext: true } as const;

describe("parseProjectPassOutput", () => {
  it("parses clean and fenced JSON", () => {
    expect(parseProjectPassOutput('{"assignments":[],"corrections":[]}')).toEqual({ assignments: [], corrections: [] });
    expect(parseProjectPassOutput('noise ```json\n{"assignments":[{"id":"w0","projectId":"p1","confidence":0.9}],"corrections":[]}\n``` tail')).toEqual({
      assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }],
      corrections: [],
    });
  });

  it("ignores earlier non-json braces and parses the first valid object", () => {
    expect(parseProjectPassOutput('diagnostic {not json} then {"assignments":[{"id":"w0","projectId":null,"confidence":0.7}],"corrections":[]}')).toEqual({
      assignments: [{ id: "w0", projectId: null, confidence: 0.7 }],
      corrections: [],
    });
  });

  it("returns null on garbage", () => {
    expect(parseProjectPassOutput("not json at all")).toBeNull();
    expect(parseProjectPassOutput('{"assignments": oops}')).toBeNull();
  });
});

describe("chunkProjectPassWindows", () => {
  it("splits windows over the cap", () => {
    const windows = buildProjectPassAnalysisWindows(
      Array.from({ length: 5 }, (_, i) =>
        seg({ id: `${i}`, startedAt: `2026-04-06T${String(9 + i).padStart(2, "0")}:00:00+00:00`, endedAt: `2026-04-06T${String(9 + i).padStart(2, "0")}:03:00+00:00`, durationSeconds: 180, appName: `App${i}` }),
      ),
    );
    expect(chunkProjectPassWindows(windows, 2)).toHaveLength(3);
    expect(chunkProjectPassWindows(windows, 100)).toHaveLength(1);
    expect(chunkProjectPassWindows([], 2)).toHaveLength(0);
  });
});

describe("projectPassChunkFingerprint", () => {
  const windows = buildProjectPassAnalysisWindows([seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:30:00+00:00", durationSeconds: 1800, appName: "Code" })]);
  const project = { id: "p1", name: "P", description: "d", anchors: [] };

  it("is stable for identical inputs and changes with project definition or work profile", async () => {
    const a = await projectPassChunkFingerprint(windows, [project]);
    const b = await projectPassChunkFingerprint(windows, [project]);
    const c = await projectPassChunkFingerprint(windows, [{ ...project, description: "changed" }]);
    const d = await projectPassChunkFingerprint(windows, [project], "Different job");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a.startsWith("pp-")).toBe(true);
  });

  it("changes when the read-only context around an identical core chunk changes", async () => {
    const contextA = buildProjectPassAnalysisWindows([
      seg({ id: "before-a", startedAt: "2026-04-06T08:57:00+00:00", endedAt: "2026-04-06T09:00:00+00:00", durationSeconds: 180, appName: "Mail" }),
    ]);
    const contextB = buildProjectPassAnalysisWindows([
      seg({ id: "before-b", startedAt: "2026-04-06T08:57:00+00:00", endedAt: "2026-04-06T09:00:00+00:00", durationSeconds: 180, appName: "Slack" }),
    ]);
    const a = await projectPassChunkFingerprint(windows, [project], null, {
      beforeContextWindows: contextA,
      afterContextWindows: [],
    });
    const b = await projectPassChunkFingerprint(windows, [project], null, {
      beforeContextWindows: contextB,
      afterContextWindows: [],
    });
    expect(a).not.toBe(b);
  });
});

describe("resolveProjectPassApply — trust invariants", () => {
  const segments = [
    classified("1", "2026-04-06T09:00:00+00:00", "2026-04-06T09:03:00+00:00", "Chrome", "social_media", "drift"),
    classified("2", "2026-04-06T10:00:00+00:00", "2026-04-06T10:03:00+00:00", "Code", "workspace", "focus", "manual"),
  ];
  const windows = buildProjectPassAnalysisWindows(segments);
  const segmentsById = new Map(segments.map((s) => [s.id, s]));
  const base = {
    windows,
    segmentsById,
    validProjectIds: new Set(["p1"]),
    revertedSegmentIds: new Set<string>(),
    chunkFingerprint: "pp-test",
    now: "2026-04-06T23:00:00+00:00",
  };

  it("assigns confident, valid projects and collapses the rest to null", () => {
    const output: ProjectPassOutput = {
      assignments: [
        { id: "w0", projectId: "p1", confidence: 0.9 },
        { id: "w1", projectId: "p1", confidence: 0.5 },
      ],
      corrections: [],
    };
    const resolved = resolveProjectPassApply({ ...base, output });
    const byId = new Map(resolved.windowAssignments.map((a) => [a.windowId, a.projectId]));
    expect(byId.get("w0")).toBe("p1");
    expect(byId.get("w1")).toBeNull(); // below assign threshold
    expect(resolved.windowAssignments[0].segmentOverlaps).toEqual([{ segmentId: "1", durationSeconds: 180 }]);
  });

  it("drops hallucinated project ids to null", () => {
    const resolved = resolveProjectPassApply({ ...base, output: { assignments: [{ id: "w0", projectId: "ghost", confidence: 0.99 }], corrections: [] } });
    expect(resolved.windowAssignments[0].projectId).toBeNull();
  });

  it("applies a high-confidence correction and records the prior state", () => {
    const resolved = resolveProjectPassApply({ ...base, output: { assignments: [], corrections: [{ id: "w0", category: "social_media", productivity: "focus", confidence: 0.9 }] } });
    expect(resolved.correctionClassifications).toHaveLength(1);
    expect(resolved.correctionClassifications[0]).toMatchObject({ segmentId: "1", productivity: "focus", source: "ai_review" });
    expect(resolved.correctionEvents[0]).toMatchObject({ segmentId: "1", prevProductivity: "drift", newProductivity: "focus", prevSource: "llm" });
  });

  it("ignores corrections below the confidence gate", () => {
    const resolved = resolveProjectPassApply({ ...base, output: { assignments: [], corrections: [{ id: "w0", category: null, productivity: "focus", confidence: 0.79 }] } });
    expect(resolved.correctionClassifications).toHaveLength(0);
  });

  it("never overwrites a manual classification", () => {
    const resolved = resolveProjectPassApply({ ...base, output: { assignments: [], corrections: [{ id: "w1", category: "entertainment", productivity: "drift", confidence: 0.99 }] } });
    expect(resolved.correctionClassifications).toHaveLength(0);
  });

  it("skips no-op corrections", () => {
    const resolved = resolveProjectPassApply({ ...base, output: { assignments: [], corrections: [{ id: "w0", category: "social_media", productivity: "drift", confidence: 0.95 }] } });
    expect(resolved.correctionClassifications).toHaveLength(0);
  });

  it("skips corrections with an invalid category", () => {
    const resolved = resolveProjectPassApply({ ...base, output: { assignments: [], corrections: [{ id: "w0", category: "nonsense", productivity: "focus", confidence: 0.95 }] } });
    expect(resolved.correctionClassifications).toHaveLength(0);
  });

  it("does not re-correct a reverted segment", () => {
    const resolved = resolveProjectPassApply({
      ...base,
      revertedSegmentIds: new Set(["1"]),
      output: { assignments: [], corrections: [{ id: "w0", category: "social_media", productivity: "focus", confidence: 0.95 }] },
    });
    expect(resolved.correctionClassifications).toHaveLength(0);
  });
});

function mockTracker(overrides: Partial<TrackerApi> = {}): { tracker: TrackerApi; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    getTimeline: vi.fn(async () => [
      classified("1", "2026-04-06T09:00:00+00:00", "2026-04-06T09:03:00+00:00", "Chrome", "social_media", "drift"),
    ]),
    getProjects: vi.fn(async (): Promise<Project[]> => [
      { id: "p1", name: "SNS", description: "social work", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" },
    ]),
    getProjectWindowAssignments: vi.fn(async () => []),
    getAiReviewEvents: vi.fn(async () => []),
    recordProjectPass: vi.fn(async () => ({ id: 7, ranAt: "2026-04-06T23:00:00+00:00" })),
    saveProjectWindowAssignments: vi.fn(async () => ({ saved: 0, skippedManual: 0 })),
    saveClassifications: vi.fn(async (records: ActivityClassificationRecord[]) => ({ saved: records.length })),
    saveAiReviewEvents: vi.fn(async () => ({ saved: 0 })),
    getTeamProjects: vi.fn(async () => []),
    getTeamProjectAssignments: vi.fn(async () => []),
    saveTeamProjectAssignments: vi.fn(async () => ({ saved: 0, skippedManual: 0 })),
  };
  return { tracker: { ...spies, ...overrides } as unknown as TrackerApi, spies };
}

describe("runProjectPass orchestration", () => {
  it("persists corrections for the captured-evidence surface despite a different elapsed majority", async () => {
    const raw = [
      seg({ id: "a", startedAt: "2026-04-06T09:00:00Z", endedAt: "2026-04-06T09:03:00Z", durationSeconds: 19, appName: "Code", classification: { category: "workspace", productivity: "focus", source: "llm", confidence: 0.9 } }),
      seg({ id: "b", deviceId: "pc", platform: "windows", startedAt: "2026-04-06T09:01:30Z", endedAt: "2026-04-06T09:03:00Z", durationSeconds: 20, appName: "Editor", classification: { category: "workspace", productivity: "focus", source: "llm", confidence: 0.9 } }),
    ];
    const { tracker, spies } = mockTracker({ getTimeline: vi.fn(async () => raw) as TrackerApi["getTimeline"] });
    const inference = vi.fn<ProjectPassInference>(async (_prompt, input) => ({
      output: { assignments: [], corrections: [{ id: input!.coreWindows[0].id, category: "social_media", productivity: "drift", confidence: 0.99 }] },
      usage: {},
    }));
    await runProjectPass({
      range: { start: "2026-04-06T00:00:00Z", end: "2026-04-07T00:00:00Z" }, trigger: "manual",
      tracker, inference, now: () => "2026-04-07T00:00:00Z", contextPolicy: CONTEXT_POLICY,
    });
    expect(inference.mock.calls[0][1]!.coreWindows[0].appName).toBe("Editor");
    expect(spies.saveClassifications).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "b", category: "social_media", productivity: "drift" })]);
  });

  it("uses elapsed union for raw synced-device prompts and persisted overlaps", async () => {
    const raw = [
      seg({ id: "local", startedAt: "2026-04-06T09:00:00Z", endedAt: "2026-04-06T09:06:00Z", durationSeconds: 60, appName: "Code" }),
      seg({ id: "remote", deviceId: "pc", platform: "windows", startedAt: "2026-04-06T09:00:00Z", endedAt: "2026-04-06T09:06:00Z", durationSeconds: 60, appName: "Editor" }),
    ];
    const { tracker, spies } = mockTracker({ getTimeline: vi.fn(async () => raw) as TrackerApi["getTimeline"] });
    const inference = vi.fn<ProjectPassInference>(async (_prompt, input) => ({
      output: { assignments: input!.coreWindows.map(w => ({ id: w.id, projectId: "p1", confidence: 0.9 })), corrections: [] },
      usage: {},
    }));
    await runProjectPass({
      range: { start: "2026-04-06T00:00:00Z", end: "2026-04-07T00:00:00Z" },
      trigger: "manual", tracker, inference, now: () => "2026-04-07T00:00:00Z", contextPolicy: CONTEXT_POLICY,
    });
    const windows = inference.mock.calls.flatMap(call => call[1]!.coreWindows);
    expect(windows.map(w => w.durationSeconds)).toEqual([30, 30]);
    expect(windows.every(w => w.segmentOverlaps.reduce((n, s) => n + s.durationSeconds, 0) === w.durationSeconds)).toBe(true);
    const saved = spies.saveProjectWindowAssignments.mock.calls[0] as unknown as [typeof windows];
    expect(saved[0].map(w => w.durationSeconds)).toEqual([30, 30]);
    expect(saved[0].map(w => w.segmentOverlaps)).toEqual([
      [{ segmentId: "local", durationSeconds: 15 }, { segmentId: "remote", durationSeconds: 15 }],
      [{ segmentId: "local", durationSeconds: 15 }, { segmentId: "remote", durationSeconds: 15 }],
    ]);
    expect(raw.map(s => s.durationSeconds)).toEqual([60, 60]);
  });

  it("omits old Windows capture failures from analysis prompts and saved overlaps", async () => {
    const failedCapture = seg({
      id: "failed",
      startedAt: "2026-04-06T09:03:00+00:00",
      endedAt: "2026-04-06T09:06:00+00:00",
      durationSeconds: 180,
      appName: "Unavailable",
      bundleId: null,
      platform: "windows",
      source: "unknown",
    });
    const { tracker, spies } = mockTracker({
      getTimeline: vi.fn(async () => [
        classified("1", "2026-04-06T09:00:00+00:00", "2026-04-06T09:03:00+00:00", "Chrome", "social_media", "drift"),
        failedCapture,
      ]) as TrackerApi["getTimeline"],
    });
    const inference = vi.fn<ProjectPassInference>(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
      usage: {},
    }));

    await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "manual",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(inference).toHaveBeenCalledTimes(1);
    expect(inference.mock.calls[0][1]?.coreWindows.map((window) => window.appName)).toEqual(["Chrome"]);
    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([
      expect.objectContaining({ segmentOverlaps: [{ segmentId: "1", durationSeconds: 180 }] }),
    ]);
  });

  it("skips inference when a range contains only old Windows capture failures", async () => {
    const { tracker, spies } = mockTracker({
      getTimeline: vi.fn(async () => [seg({
        id: "failed",
        startedAt: "2026-04-06T09:00:00+00:00",
        endedAt: "2026-04-06T09:03:00+00:00",
        durationSeconds: 180,
        appName: "Unavailable",
        bundleId: null,
        platform: "windows",
        source: "unknown",
      })]) as TrackerApi["getTimeline"],
    });
    const inference = vi.fn<ProjectPassInference>(async () => ({ output: { assignments: [], corrections: [] }, usage: {} }));

    const summary = await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "manual",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(summary).toEqual(expect.objectContaining({ ran: false, skippedReason: "no activity in range" }));
    expect(inference).not.toHaveBeenCalled();
    expect(spies.recordProjectPass).not.toHaveBeenCalled();
  });

  it("does not hand a wider-range caller the running narrow pass's result", async () => {
    const { tracker } = mockTracker();
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let call = 0;
    const inference: ProjectPassInference = vi.fn(async () => {
      call += 1;
      if (call === 1) await firstStarted;
      return {
        output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
        usage: { model: "test-model" },
      };
    });
    const common = { trigger: "schedule" as const, tracker, inference, now: () => "2026-04-06T23:00:00+00:00", contextPolicy: CONTEXT_POLICY };

    const todayRange = { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" };
    const weekRange = { start: "2026-03-30T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" };
    const todayPass = runProjectPass({ ...common, range: todayRange });
    await vi.waitFor(() => expect(inference).toHaveBeenCalledTimes(1));
    const weekPass = runProjectPass({ ...common, range: weekRange, trigger: "backfill" });
    try {
      expect(weekPass).not.toBe(todayPass);
      // Give a wrongly started pass time to reach the provider while today's
      // request is still held open. The wider pass must wait for persistence too.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(inference).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst();
      await Promise.all([todayPass, weekPass]);
    }
    // The 7-day caller must have actually run rather than reusing the today run.
    expect(inference).toHaveBeenCalledTimes(2);
  });

  it("waits for the previous pass to persist its assignments before reading the next range", async () => {
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const save = vi.fn(async () => {
      if (save.mock.calls.length === 1) await writeGate;
      return { saved: 1, skippedManual: 0 };
    });
    const { tracker, spies } = mockTracker({ saveProjectWindowAssignments: save });
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
      usage: {},
    }));
    const common = { trigger: "schedule" as const, tracker, inference, now: () => "2026-04-06T23:00:00+00:00", contextPolicy: CONTEXT_POLICY };
    const first = runProjectPass({ ...common, range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" } });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const next = runProjectPass({ ...common, range: { start: "2026-03-30T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" } });
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(spies.getTimeline).toHaveBeenCalledTimes(1);
    } finally {
      releaseWrite();
      await Promise.all([first, next]);
    }
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("drains queued ranges in order after a failed pass and accepts a later retry", async () => {
    let rejectRead!: (error: Error) => void;
    const readGate = new Promise<ActivitySegment[]>((_, reject) => { rejectRead = reject; });
    const { tracker, spies } = mockTracker();
    spies.getTimeline.mockImplementationOnce(() => readGate);
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [], corrections: [] },
      usage: {},
    }));
    const common = { trigger: "schedule" as const, tracker, inference, now: () => "2026-04-06T23:00:00+00:00", contextPolicy: CONTEXT_POLICY };
    const ranges = [6, 5, 4].map((day) => ({ start: `2026-04-0${day}T00:00:00+00:00`, end: "2026-04-06T23:59:59+00:00" }));
    const failed = runProjectPass({ ...common, range: ranges[0] }).catch((error: unknown) => error);
    const second = runProjectPass({ ...common, range: ranges[1] });
    const third = runProjectPass({ ...common, range: ranges[2] });
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(spies.getTimeline).toHaveBeenCalledTimes(1);
    } finally {
      rejectRead(new Error("tracker unavailable"));
      expect(await failed).toEqual(new Error("tracker unavailable"));
      await Promise.all([second, third]);
    }
    expect(spies.getTimeline.mock.calls.map(([range]) => range)).toEqual(ranges);
    await runProjectPass({ ...common, range: ranges[0] });
    expect(spies.getTimeline).toHaveBeenCalledTimes(4);
    expect(inference).toHaveBeenCalledTimes(3);
  });

  it("drains active chunk requests after an error before starting a queued pass", async () => {
    const manySegments = Array.from({ length: PROJECT_PASS_MAX_CHUNK_WINDOWS * 3 + 1 }, (_, index) => {
      const start = new Date(Date.parse("2026-04-06T00:00:00Z") + index * 180_000).toISOString();
      const end = new Date(Date.parse(start) + 180_000).toISOString();
      return classified(String(index), start, end, `App${index}`, "social_media", "drift");
    });
    const timeline = vi.fn(async () => manySegments);
    const { tracker, spies } = mockTracker({
      getTimeline: timeline as TrackerApi["getTimeline"],
    });
    let rejectChunk!: (error: Error) => void;
    const errorGate = new Promise<void>((_, reject) => { rejectChunk = reject; });
    let releaseChunks!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseChunks = resolve; });
    let calls = 0;
    const inference: ProjectPassInference = vi.fn(async () => {
      const index = calls++;
      if (index === 0) await errorGate;
      else if (index < EXPECTED_MAX_PARALLEL_CHUNKS) await slowGate;
      return { output: { assignments: [], corrections: [] }, usage: {} };
    });
    const common = { trigger: "schedule" as const, tracker, inference, now: () => "2026-04-06T23:00:00+00:00", contextPolicy: CONTEXT_POLICY };
    let rejected = false;
    const failed = runProjectPass({ ...common, range: { start: "2026-04-06T00:00:00Z", end: "2026-04-07T00:00:00Z" } })
      .catch((error: unknown) => { rejected = true; return error; });
    await vi.waitFor(() => expect(inference).toHaveBeenCalledTimes(EXPECTED_MAX_PARALLEL_CHUNKS));
    const next = runProjectPass({ ...common, range: { start: "2026-04-05T00:00:00Z", end: "2026-04-07T00:00:00Z" } });
    rejectChunk(new Error("provider transport failed"));
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejected).toBe(false);
      expect(timeline).toHaveBeenCalledTimes(1);
      expect(inference).toHaveBeenCalledTimes(EXPECTED_MAX_PARALLEL_CHUNKS);
    } finally {
      releaseChunks();
      expect(await failed).toEqual(new Error("provider transport failed"));
      await next;
    }
    // The failed pass starts no remaining chunk and persists no partial result.
    expect(spies.recordProjectPass).toHaveBeenCalledTimes(1);
    expect(inference).toHaveBeenCalledTimes(EXPECTED_MAX_PARALLEL_CHUNKS + 4);
  });

  it("still coalesces concurrent callers asking for the same range", async () => {
    const { tracker } = mockTracker();
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [], corrections: [] },
      usage: {},
    }));
    const range = { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" };
    const common = { range, trigger: "schedule" as const, tracker, inference, now: () => "2026-04-06T23:00:00+00:00", contextPolicy: CONTEXT_POLICY };

    const a = runProjectPass(common);
    const b = runProjectPass(common);
    expect(b).toBe(a);
    await Promise.all([a, b]);
  });

  it("reports a failed chunk instead of presenting it as an empty result", async () => {
    const { tracker } = mockTracker();
    // A provider HTTP/parse failure surfaces as a null output, not a throw.
    const inference: ProjectPassInference = vi.fn(async () => ({ output: null, usage: { provider: "custom" } }));

    const summary = await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "backfill",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(summary.assignments).toBe(0);
    expect(summary.failedChunks).toBeGreaterThan(0);
  });

  it("reports zero failed chunks when every chunk produced output", async () => {
    const { tracker } = mockTracker();
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
      usage: {},
    }));

    const summary = await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "backfill",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(summary.failedChunks).toBe(0);
  });

  it("applies assignments + corrections and records one pass with the id used for events", async () => {
    const { tracker, spies } = mockTracker();
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [{ id: "w0", category: "social_media", productivity: "focus", confidence: 0.95 }] },
      usage: { model: "test-model", tokensIn: 100, tokensOut: 20 },
    }));

    const summary = await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "manual",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(summary.ran).toBe(true);
    expect(summary.assignments).toBe(1);
    expect(summary.corrections).toBe(1);
    expect(spies.recordProjectPass).toHaveBeenCalledTimes(1);
    expect(spies.recordProjectPass).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model", assignmentsCount: 1, correctionsCount: 0 }));
    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([expect.objectContaining({ windowId: "w0", projectId: "p1", teamProjectId: null, passId: 7, assignedAt: "2026-04-06T23:00:00+00:00" })]);
    expect(spies.saveClassifications).toHaveBeenCalledWith([expect.objectContaining({
      segmentId: "1", source: "ai_review", productivity: "focus", reviewPassId: 7,
    })]);
    expect(spies.saveAiReviewEvents).not.toHaveBeenCalled();
  });

  it("reports only persisted corrections when a user choice wins during inference", async () => {
    const save = vi.fn(async () => ({ saved: 0 }));
    const { tracker, spies } = mockTracker({ saveClassifications: save });
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [], corrections: [{ id: "w0", category: "workspace", productivity: "focus", confidence: 0.95 }] },
      usage: {},
    }));
    const summary = await runProjectPass({
      range: { start: "2026-04-06T00:00:00Z", end: "2026-04-07T00:00:00Z" },
      trigger: "manual", tracker, inference,
      now: () => "2026-04-06T23:00:00Z", contextPolicy: CONTEXT_POLICY,
    });
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ source: "ai_review", reviewPassId: 7 })]);
    expect(summary.corrections).toBe(0);
    expect(spies.saveAiReviewEvents).not.toHaveBeenCalled();
  });

  it("routes team-project assignments to the local team mirror, not the personal table", async () => {
    const { tracker, spies } = mockTracker({
      getProjects: vi.fn(async () => []) as TrackerApi["getProjects"],
      getTeamProjects: vi.fn(async () => [
        { id: "t1", organizationId: "org-1", name: "Product", description: "product work", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" },
      ]) as TrackerApi["getTeamProjects"],
    });
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "t1", confidence: 0.9 }], corrections: [] },
      usage: { model: "test-model", tokensIn: 10, tokensOut: 5 },
    }));

    await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "manual",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([expect.objectContaining({ windowId: "w0", projectId: null, teamProjectId: "t1", passId: 7 })]);
  });

  it("clears the team row when a segment is reclassified from a team to a personal project", async () => {
    const { tracker, spies } = mockTracker({
      getProjects: vi.fn(async () => [
        { id: "p1", name: "SNS", description: "", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" },
      ]) as TrackerApi["getProjects"],
      getTeamProjects: vi.fn(async () => [
        { id: "t1", organizationId: "org-1", name: "Product", description: "", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" },
      ]) as TrackerApi["getTeamProjects"],
    });
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
      usage: { model: "test-model", tokensIn: 10, tokensOut: 5 },
    }));

    await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "manual",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    // One window row owns both scopes, so the personal id replaces any prior team id.
    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([expect.objectContaining({ windowId: "w0", projectId: "p1", teamProjectId: null })]);
  });

  it("skips a chunk whose fingerprint already has fresh stored assignments", async () => {
    const { tracker, spies } = mockTracker();
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
      usage: { model: "m", tokensIn: 100, tokensOut: 20 },
    }));
    const baseOptions = {
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "manual" as const,
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    };

    // First pass has nothing cached: the chunk runs and stores an assignment.
    await runProjectPass(baseOptions);
    const fingerprint = spies.saveProjectWindowAssignments.mock.calls[0][0][0].chunkFingerprint as string;
    expect(typeof fingerprint).toBe("string");

    // Second pass sees that assignment as already stored → the chunk is skipped.
    (inference as ReturnType<typeof vi.fn>).mockClear();
    const cached = mockTracker({
      getProjectWindowAssignments: vi.fn(async () => [
        { windowId: "w0", windowStartedAt: "2026-04-06T09:00:00.000Z", windowEndedAt: "2026-04-06T09:03:00.000Z", durationSeconds: 180, segmentOverlaps: [{ segmentId: "1", durationSeconds: 180 }], projectId: "p1", teamProjectId: null, source: "ai" as const, chunkFingerprint: fingerprint, stale: false },
      ]),
    });
    const summary = await runProjectPass({ ...baseOptions, tracker: cached.tracker });

    expect(inference).not.toHaveBeenCalled();
    expect(summary.ran).toBe(false);
    expect(summary.skippedReason).toBe("already analyzed");
    expect(summary.assignments).toBe(0);
    expect(summary.tokensIn).toBe(0);
    expect(cached.spies.recordProjectPass).not.toHaveBeenCalled();
  });

  it("skips cleanly when there is no activity", async () => {
    const { tracker, spies } = mockTracker({ getTimeline: vi.fn(async () => []) as TrackerApi["getTimeline"] });
    const inference: ProjectPassInference = vi.fn(async () => ({ output: { assignments: [], corrections: [] }, usage: {} }));
    const summary = await runProjectPass({ range: { start: "a", end: "b" }, trigger: "schedule", tracker, inference, now: () => "t", contextPolicy: CONTEXT_POLICY });
    expect(summary.ran).toBe(false);
    expect(inference).not.toHaveBeenCalled();
    expect(spies.recordProjectPass).not.toHaveBeenCalled();
  });

  it("does not infer or persist when only the current incomplete window has activity", async () => {
    const { tracker, spies } = mockTracker({
      getTimeline: vi.fn(async () => [
        classified("1", "2026-04-06T09:03:00+00:00", "2026-04-06T09:04:00+00:00", "Code", "workspace", "focus"),
      ]) as TrackerApi["getTimeline"],
    });
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
      usage: {},
    }));

    const summary = await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "schedule",
      tracker,
      inference,
      now: () => "2026-04-06T09:04:30+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(summary).toEqual(expect.objectContaining({ ran: false, skippedReason: "no completed activity windows" }));
    expect(inference).not.toHaveBeenCalled();
    expect(spies.recordProjectPass).not.toHaveBeenCalled();
    expect(spies.saveProjectWindowAssignments).not.toHaveBeenCalled();
  });

  it("captures now once so completion filtering and persisted timestamps share one boundary", async () => {
    const { tracker, spies } = mockTracker();
    const inference: ProjectPassInference = vi.fn(async () => ({
      output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] },
      usage: {},
    }));
    const now = vi
      .fn<() => string>()
      .mockReturnValueOnce("2026-04-06T09:03:00+00:00")
      .mockReturnValue("2026-04-06T09:03:01+00:00");

    await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "schedule",
      tracker,
      inference,
      now,
      contextPolicy: CONTEXT_POLICY,
    });

    expect(now).toHaveBeenCalledTimes(1);
    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([
      expect.objectContaining({ assignedAt: "2026-04-06T09:03:00+00:00" }),
    ]);
  });

  it("grounds the prompt on the work profile when provided", async () => {
    const { tracker } = mockTracker();
    const prompts: string[] = [];
    const inference: ProjectPassInference = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return { output: { assignments: [], corrections: [] }, usage: {} };
    });

    await runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "manual",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      workProfile: "Founder building a Mac time tracker",
      contextPolicy: CONTEXT_POLICY,
    });

    expect(prompts[0]).toContain("User work profile: Founder building a Mac time tracker");
  });

  it("runs chunks in bounded parallel with adjacent context while applying only core window output", async () => {
    const isoAt = (minute: number) =>
      `2026-04-06T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+00:00`;
    const manySegments = Array.from({ length: PROJECT_PASS_MAX_CHUNK_WINDOWS + EXPECTED_CONTEXT_WINDOW_OVERLAP + 1 }, (_, i) =>
      classified(`${i}`, isoAt(i * 3), isoAt(i * 3 + 3), `App${i}`, "social_media", "drift"),
    );
    const { tracker, spies } = mockTracker({ getTimeline: vi.fn(async () => manySegments) as TrackerApi["getTimeline"] });
    const prompts: string[] = [];
    let activeInferences = 0;
    let resolveParallelInference: ((started: boolean) => void) | null = null;
    const parallelInferenceStarted = new Promise<boolean>((resolve) => {
      resolveParallelInference = resolve;
    });
    let releaseInferences: () => void = () => undefined;
    const inferenceRelease = new Promise<void>((resolve) => {
      releaseInferences = resolve;
    });
    let maxInFlight = 0;
    const inference: ProjectPassInference = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      activeInferences += 1;
      maxInFlight = Math.max(maxInFlight, activeInferences);
      if (activeInferences > 1) resolveParallelInference?.(true);
      await inferenceRelease;
      activeInferences -= 1;
      const coreSection = prompt.split("Core analysis windows (return assignments and corrections only for these ids):")[1]?.split("Context after (read-only; do not output these ids):")[0] ?? "";
      const output = coreSection.includes(`App${PROJECT_PASS_MAX_CHUNK_WINDOWS}`)
        ? {
            assignments: [
              { id: `w${PROJECT_PASS_MAX_CHUNK_WINDOWS - 1}`, projectId: "p1", confidence: 0.99 },
              { id: `w${PROJECT_PASS_MAX_CHUNK_WINDOWS}`, projectId: "p1", confidence: 0.99 },
            ],
            corrections: [],
          }
        : { assignments: [], corrections: [] };
      return { output, usage: { tokensIn: 10, tokensOut: 2 } };
    });

    const run = runProjectPass({
      range: { start: "2026-04-06T00:00:00+00:00", end: "2026-04-06T23:59:59+00:00" },
      trigger: "backfill",
      tracker,
      inference,
      now: () => "2026-04-06T23:00:00+00:00",
      contextPolicy: CONTEXT_POLICY,
    });

    const observedParallelStart = await Promise.race([
      parallelInferenceStarted,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    const observedParallelism = maxInFlight;
    releaseInferences();
    await run;

    expect(observedParallelStart).toBe(true);
    expect(observedParallelism).toBeGreaterThan(1);
    expect(observedParallelism).toBeLessThanOrEqual(EXPECTED_MAX_PARALLEL_CHUNKS);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Context after (read-only; do not output these ids):");
    expect(prompts[0]).toContain(`App${PROJECT_PASS_MAX_CHUNK_WINDOWS}`);
    expect(prompts[1]).toContain("Context before (read-only; do not output these ids):");
    expect(prompts[1]).toContain(`App${PROJECT_PASS_MAX_CHUNK_WINDOWS - 1}`);
    expect(prompts[1]).toContain("Core analysis windows (return assignments and corrections only for these ids):");
    expect(prompts[1]).toContain(`App${PROJECT_PASS_MAX_CHUNK_WINDOWS}`);
    expect(prompts[1]).toContain("Context after (read-only; do not output these ids):");
    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([expect.objectContaining({ windowId: `w${PROJECT_PASS_MAX_CHUNK_WINDOWS}`, projectId: "p1" })]);
    expect(spies.saveProjectWindowAssignments).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ windowId: `w${PROJECT_PASS_MAX_CHUNK_WINDOWS - 1}` })]),
    );
  });
});


describe("Intelligence provider recovery delivery", () => {
  const range = { start: "2026-04-06T00:00:00Z", end: "2026-04-07T00:00:00Z" };
  const cloudOutput = { content: JSON.stringify({ assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] }), model: "drifty-cloud", tokensIn: 100, tokensOut: 20 };
  const preferred = { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "anthropic" as const, anthropicApiKey: "synthetic-key" };
  it("persists a Cloud assignment after a definite Anthropic rejection without changing the saved preference", async () => {
    const { tracker, spies } = mockTracker();
    const invokeAnthropicChat = vi.fn().mockResolvedValue({ status: 401, body: '{"error":{"type":"authentication_error"}}' });
    const invokeCloud = vi.fn().mockResolvedValue(cloudOutput);
    const onProviderUnavailable = vi.fn();
    const inference = createProjectPassInference(preferred, { invokeAnthropicChat, invokeCloud, canFallbackToCloud: () => true, onProviderUnavailable });
    const result = await runProjectPass({ tracker, range, trigger: "manual", inference, now: () => "2026-04-07T00:00:00Z", contextPolicy: CONTEXT_POLICY });
    expect(result).toMatchObject({ assignments: 1, failedChunks: 0, tokensIn: 100, tokensOut: 20 });
    expect(invokeAnthropicChat).toHaveBeenCalledTimes(1);
    expect(invokeCloud).toHaveBeenCalledTimes(1);
    expect(onProviderUnavailable).toHaveBeenCalledWith("authentication");
    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([expect.objectContaining({ projectId: "p1", passId: 7 })]);
    expect(spies.recordProjectPass).toHaveBeenCalledWith(expect.objectContaining({ provider: "cloud", model: "drifty-cloud" }));
    expect(preferred.provider).toBe("anthropic");
  });
  it("routes an incomplete Custom configuration to Cloud before any Custom request and saves its assignment", async () => {
    const { tracker, spies } = mockTracker();
    const route = resolveIntelligenceRoute({ setup: { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "self_hosted", selfHostedBaseUrl: "invalid", selfHostedModel: "" }, credentialState: "missing", cloudReady: true, cloudFallbackAllowed: true });
    const invokeChat = vi.fn();
    const invokeCloud = vi.fn().mockResolvedValue(cloudOutput);
    const inference = createProjectPassInference(route.setup, { invokeChat, invokeCloud });
    await runProjectPass({ tracker, range, trigger: "schedule", inference, now: () => "2026-04-07T00:00:00Z", contextPolicy: CONTEXT_POLICY });
    expect(invokeChat).not.toHaveBeenCalled();
    expect(invokeCloud).toHaveBeenCalledTimes(1);
    expect(spies.saveProjectWindowAssignments).toHaveBeenCalledWith([expect.objectContaining({ projectId: "p1" })]);
  });
  it.each([401, 429, 503])("keeps rejected/transient HTTP %s from delivering through an unauthorized Cloud route", async status => {
    const { tracker, spies } = mockTracker();
    const invokeCloud = vi.fn();
    const inference = createProjectPassInference(preferred, { invokeAnthropicChat: vi.fn().mockResolvedValue({ status, body: "{}" }), invokeCloud, canFallbackToCloud: () => false });
    const result = await runProjectPass({ tracker, range, trigger: "manual", inference, now: () => "2026-04-07T00:00:00Z", contextPolicy: CONTEXT_POLICY });
    expect(result).toMatchObject({ assignments: 0, failedChunks: 1 });
    expect(invokeCloud).not.toHaveBeenCalled();
    expect(spies.saveProjectWindowAssignments).not.toHaveBeenCalled();
  });
  it("discards late inference output after the account or provider scope changes", async () => {
    const { tracker, spies } = mockTracker();
    let current = true;
    let finish!: (value: Awaited<ReturnType<ProjectPassInference>>) => void;
    const inference = vi.fn<ProjectPassInference>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = runProjectPass({ tracker, range, trigger: "manual", inference, now: () => "2026-04-07T00:00:00Z", contextPolicy: CONTEXT_POLICY, requestScopeKey: "synthetic-scope", persistenceAllowed: () => current });
    await vi.waitFor(() => expect(inference).toHaveBeenCalledTimes(1));
    current = false;
    finish({ output: { assignments: [{ id: "w0", projectId: "p1", confidence: 0.9 }], corrections: [] }, usage: { provider: "cloud" } });
    await expect(pending).rejects.toThrow("settings changed");
    expect(spies.recordProjectPass).not.toHaveBeenCalled();
    expect(spies.saveProjectWindowAssignments).not.toHaveBeenCalled();
    expect(spies.saveClassifications).not.toHaveBeenCalled();
  });
});
