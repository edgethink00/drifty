import { describe, expect, it, vi } from "vitest";
import { buildProjectPassAnalysisWindows, type ActivityCategory, type ActivitySegment, type Project, type ProductivityLabel, type StoredClassificationSource, type TrackerApi } from "@drifty/domain";
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
    durationSeconds: 600,
    appName,
    classification: { category, productivity, source, confidence: 0.8, inputFingerprint: `fp-${id}` },
  });
}

const EXPECTED_CONTEXT_WINDOW_OVERLAP = 4;
const EXPECTED_MAX_PARALLEL_CHUNKS = 3;

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
        seg({ id: `${i}`, startedAt: `2026-04-06T${String(9 + i).padStart(2, "0")}:00:00+00:00`, endedAt: `2026-04-06T${String(9 + i).padStart(2, "0")}:30:00+00:00`, durationSeconds: 1800, appName: `App${i}` }),
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

  it("is stable for identical inputs and changes with project definition", async () => {
    const a = await projectPassChunkFingerprint(windows, [project]);
    const b = await projectPassChunkFingerprint(windows, [project]);
    const c = await projectPassChunkFingerprint(windows, [{ ...project, description: "changed" }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("pp-")).toBe(true);
  });
});

describe("resolveProjectPassApply — trust invariants", () => {
  const segments = [
    classified("1", "2026-04-06T09:00:00+00:00", "2026-04-06T09:30:00+00:00", "Chrome", "social_media", "drift"),
    classified("2", "2026-04-06T10:00:00+00:00", "2026-04-06T10:30:00+00:00", "Code", "workspace", "focus", "manual"),
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
    const byId = new Map(resolved.assignments.map((a) => [a.segmentId, a.projectId]));
    expect(byId.get("1")).toBe("p1");
    expect(byId.get("2")).toBeNull(); // below assign threshold
  });

  it("drops hallucinated project ids to null", () => {
    const resolved = resolveProjectPassApply({ ...base, output: { assignments: [{ id: "w0", projectId: "ghost", confidence: 0.99 }], corrections: [] } });
    expect(resolved.assignments[0].projectId).toBeNull();
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
      classified("1", "2026-04-06T09:00:00+00:00", "2026-04-06T09:30:00+00:00", "Chrome", "social_media", "drift"),
    ]),
    getProjects: vi.fn(async (): Promise<Project[]> => [
      { id: "p1", name: "SNS", description: "social work", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" },
    ]),
    getAiReviewEvents: vi.fn(async () => []),
    recordProjectPass: vi.fn(async () => ({ id: 7, ranAt: "2026-04-06T23:00:00+00:00" })),
    saveProjectAssignments: vi.fn(async () => ({ saved: 0, skippedManual: 0 })),
    saveClassifications: vi.fn(async () => ({ saved: 0 })),
    saveAiReviewEvents: vi.fn(async () => ({ saved: 0 })),
  };
  return { tracker: { ...spies, ...overrides } as unknown as TrackerApi, spies };
}

describe("runProjectPass orchestration", () => {
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
    });

    expect(summary.ran).toBe(true);
    expect(summary.assignments).toBe(1);
    expect(summary.corrections).toBe(1);
    expect(spies.recordProjectPass).toHaveBeenCalledTimes(1);
    expect(spies.recordProjectPass).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model", assignmentsCount: 1, correctionsCount: 1 }));
    expect(spies.saveProjectAssignments).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "1", projectId: "p1", passId: 7 })]);
    expect(spies.saveAiReviewEvents).toHaveBeenCalledWith([expect.objectContaining({ segmentId: "1", passId: 7, newProductivity: "focus" })]);
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
    };

    // First pass has nothing cached: the chunk runs and stores an assignment.
    await runProjectPass(baseOptions);
    const fingerprint = spies.saveProjectAssignments.mock.calls[0][0][0].chunkFingerprint as string;
    expect(typeof fingerprint).toBe("string");

    // Second pass sees that assignment as already stored → the chunk is skipped.
    (inference as ReturnType<typeof vi.fn>).mockClear();
    const cached = mockTracker({
      getProjectAssignments: vi.fn(async () => [
        { segmentId: "1", projectId: "p1", source: "ai" as const, chunkFingerprint: fingerprint, stale: false },
      ]),
    });
    const summary = await runProjectPass({ ...baseOptions, tracker: cached.tracker });

    expect(inference).not.toHaveBeenCalled();
    expect(summary.ran).toBe(true);
    expect(summary.assignments).toBe(0);
    expect(summary.tokensIn).toBe(0);
  });

  it("skips cleanly when there is no activity", async () => {
    const { tracker, spies } = mockTracker({ getTimeline: vi.fn(async () => []) as TrackerApi["getTimeline"] });
    const inference: ProjectPassInference = vi.fn(async () => ({ output: { assignments: [], corrections: [] }, usage: {} }));
    const summary = await runProjectPass({ range: { start: "a", end: "b" }, trigger: "schedule", tracker, inference, now: () => "t" });
    expect(summary.ran).toBe(false);
    expect(inference).not.toHaveBeenCalled();
    expect(spies.recordProjectPass).not.toHaveBeenCalled();
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
    });

    expect(prompts[0]).toContain("User work profile: Founder building a Mac time tracker");
  });

  it("runs chunks in bounded parallel with adjacent context while applying only core window output", async () => {
    const isoAt = (minute: number) =>
      `2026-04-06T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+00:00`;
    const manySegments = Array.from({ length: PROJECT_PASS_MAX_CHUNK_WINDOWS + EXPECTED_CONTEXT_WINDOW_OVERLAP + 1 }, (_, i) =>
      classified(`${i}`, isoAt(i * 6), isoAt(i * 6 + 5), `App${i}`, "social_media", "drift"),
    );
    const { tracker, spies } = mockTracker({ getTimeline: vi.fn(async () => manySegments) as TrackerApi["getTimeline"] });
    const prompts: string[] = [];
    let activeInferences = 0;
    let resolveFirstInference: (() => void) | null = null;
    const firstInferenceStarted = new Promise<void>((resolve) => {
      resolveFirstInference = resolve;
    });
    let maxInFlight = 0;
    const inference: ProjectPassInference = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      activeInferences += 1;
      maxInFlight = Math.max(maxInFlight, activeInferences);
      if (prompts.length === 1) resolveFirstInference?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
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
    });

    await firstInferenceStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const observedParallelism = maxInFlight;
    await run;

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
    expect(spies.saveProjectAssignments).toHaveBeenCalledWith([expect.objectContaining({ segmentId: `${PROJECT_PASS_MAX_CHUNK_WINDOWS}`, projectId: "p1" })]);
    expect(spies.saveProjectAssignments).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ segmentId: `${PROJECT_PASS_MAX_CHUNK_WINDOWS - 1}` })]),
    );
  });
});
