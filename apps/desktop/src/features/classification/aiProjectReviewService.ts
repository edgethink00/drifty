import {
  buildProjectPassPrompt,
  buildProjectPassAnalysisWindows,
  formatProjectPassAnalysisWindowLine,
  isFailedForegroundCaptureSegment,
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  PROJECT_ASSIGNMENT_MIN_CONFIDENCE,
  PROJECT_PASS_PROMPT_VERSION,
  type ActivityCategory,
  type ActivitySegment,
  type ActivityClassificationRecord,
  type AiReviewEventInput,
  type Project,
  type ProjectWindowAssignmentRecord,
  type ProjectPassAnalysisWindow,
  type ProjectPassContextPolicy,
  type ProjectPassPromptInput,
  type ProjectPassPromptProject,
  type ProjectPassTrigger,
  type ProductivityLabel,
  type TrackerApi,
} from "@drifty/domain";

export { parseProjectPassOutput } from "./projectPassOutputParser";

export const PROJECT_CORRECTION_MIN_CONFIDENCE = 0.8;
export const PROJECT_PASS_MAX_CHUNK_WINDOWS = 40;
export const PROJECT_PASS_CONTEXT_WINDOW_OVERLAP = 4;
export const PROJECT_PASS_MAX_PARALLEL_CHUNKS = 3;
export const PROJECT_PASS_STALE_MS = 3 * 60 * 60 * 1000;

const VALID_CATEGORIES = new Set<string>(CATEGORY_ORDER);
const VALID_PRODUCTIVITY = new Set<string>(PRODUCTIVITY_ORDER);

export interface ProjectPassAssignment {
  readonly id: string;
  readonly projectId: string | null;
  readonly confidence: number;
  readonly reason?: string;
}

export interface ProjectPassCorrection {
  readonly id: string;
  readonly category: string | null;
  readonly productivity: string | null;
  readonly confidence: number;
  readonly reason?: string;
}

export interface ProjectPassOutput {
  readonly assignments: ProjectPassAssignment[];
  readonly corrections: ProjectPassCorrection[];
}

export interface ProjectPassInferenceUsage {
  readonly model?: string | null;
  readonly provider?: string | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
  readonly latencyMs?: number | null;
}

export interface ProjectPassInferenceResult {
  readonly output: ProjectPassOutput | null;
  readonly usage: ProjectPassInferenceUsage;
}

/**
 * Provider-agnostic inference. Concrete wiring (OpenRouter / Cloud) is injected.
 * `promptInput` carries the structured chunk so the Drifty Cloud path can send
 * structure and let the edge build the prompt server-side (Option D); local /
 * BYO-key providers ignore it and use the pre-built `prompt`.
 */
export type ProjectPassInference = (prompt: string, promptInput?: ProjectPassPromptInput) => Promise<ProjectPassInferenceResult>;

export function chunkProjectPassWindows(windows: ProjectPassAnalysisWindow[], maxWindows = PROJECT_PASS_MAX_CHUNK_WINDOWS): ProjectPassAnalysisWindow[][] {
  if (windows.length <= maxWindows) return windows.length ? [windows] : [];
  const chunks: ProjectPassAnalysisWindow[][] = [];
  for (let index = 0; index < windows.length; index += maxWindows) {
    chunks.push(windows.slice(index, index + maxWindows));
  }
  return chunks;
}

interface ProjectPassChunkPlan {
  readonly coreWindows: ProjectPassAnalysisWindow[];
  readonly beforeContextWindows: ProjectPassAnalysisWindow[];
  readonly afterContextWindows: ProjectPassAnalysisWindow[];
}

function planProjectPassChunks(
  windows: ProjectPassAnalysisWindow[],
  maxWindows = PROJECT_PASS_MAX_CHUNK_WINDOWS,
  contextWindowOverlap = PROJECT_PASS_CONTEXT_WINDOW_OVERLAP,
): ProjectPassChunkPlan[] {
  const chunks = chunkProjectPassWindows(windows, maxWindows);
  return chunks.map((coreWindows, index) => {
    const coreStart = index * maxWindows;
    const coreEnd = coreStart + coreWindows.length;
    return {
      coreWindows,
      beforeContextWindows: windows.slice(Math.max(0, coreStart - contextWindowOverlap), coreStart),
      afterContextWindows: windows.slice(coreEnd, coreEnd + contextWindowOverlap),
    };
  });
}

function toPromptProject(project: Project): ProjectPassPromptProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    anchors: project.anchors,
  };
}

export async function projectPassChunkFingerprint(
  windows: ProjectPassAnalysisWindow[],
  projects: ProjectPassPromptProject[],
  workProfile: string | null = null,
  surroundingContext: {
    readonly beforeContextWindows: readonly ProjectPassAnalysisWindow[];
    readonly afterContextWindows: readonly ProjectPassAnalysisWindow[];
  } = { beforeContextWindows: [], afterContextWindows: [] },
): Promise<string> {
  const projectSignature = projects
    .map((project) => `${project.id}:${project.name}:${project.description}:${project.anchors.map((a) => `${a.kind}=${a.value}`).join(",")}`)
    .join("|");
  const canonical = [
    PROJECT_PASS_PROMPT_VERSION,
    `workProfile=${workProfile?.trim() ?? ""}`,
    projectSignature,
    "before:",
    surroundingContext.beforeContextWindows.map(formatProjectPassAnalysisWindowLine).join("\n"),
    "core:",
    windows.map(formatProjectPassAnalysisWindowLine).join("\n"),
    "after:",
    surroundingContext.afterContextWindows.map(formatProjectPassAnalysisWindowLine).join("\n"),
  ].join("\n");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `pp-${hex}`;
}

export interface ResolvedProjectApply {
  readonly windowAssignments: ProjectWindowAssignmentRecord[];
  readonly correctionClassifications: ActivityClassificationRecord[];
  readonly correctionEvents: Array<Omit<AiReviewEventInput, "passId">>;
}

export interface ResolveProjectApplyArgs {
  readonly output: ProjectPassOutput;
  readonly windows: ProjectPassAnalysisWindow[];
  readonly segmentsById: Map<string, ActivitySegment>;
  readonly validProjectIds: Set<string>;
  readonly revertedSegmentIds: Set<string>;
  readonly chunkFingerprint: string;
  readonly now: string;
  readonly assignMinConfidence?: number;
  readonly correctMinConfidence?: number;
}

const UNTOUCHABLE_SOURCES = new Set(["manual", "rule"]);

/**
 * Pure resolution of a model's chunk output into DB writes. Enforces the trust
 * invariants: assignments below threshold collapse to null, corrections require
 * the high-confidence gate, and manual/rule/reverted classifications are never
 * overwritten.
 */
export function resolveProjectPassApply(args: ResolveProjectApplyArgs): ResolvedProjectApply {
  const assignMin = args.assignMinConfidence ?? PROJECT_ASSIGNMENT_MIN_CONFIDENCE;
  const correctMin = args.correctMinConfidence ?? PROJECT_CORRECTION_MIN_CONFIDENCE;
  const windowsById = new Map(args.windows.map((window) => [window.id, window]));

  const outputAssignmentByWindowId = new Map(args.output.assignments.map((assignment) => [assignment.id, assignment]));
  const windowAssignments: ProjectWindowAssignmentRecord[] = [];
  for (const window of args.windows) {
    const assignment = outputAssignmentByWindowId.get(window.id);
    if (!assignment) continue;
    const confident = typeof assignment?.confidence === "number" && assignment.confidence >= assignMin;
    const projectId =
      confident && assignment?.projectId && args.validProjectIds.has(assignment.projectId) ? assignment.projectId : null;
    windowAssignments.push({
      windowId: window.id,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      durationSeconds: window.durationSeconds,
      segmentOverlaps: [...window.segmentOverlaps],
      projectId,
      teamProjectId: null,
      source: "ai",
      confidence: typeof assignment?.confidence === "number" ? assignment.confidence : null,
      reason: assignment?.reason ?? null,
      chunkFingerprint: args.chunkFingerprint,
      assignedAt: args.now,
    });
  }

  const correctionClassifications: ActivityClassificationRecord[] = [];
  const correctionEvents: Array<Omit<AiReviewEventInput, "passId">> = [];
  for (const correction of args.output.corrections) {
    const window = windowsById.get(correction.id);
    if (!window) continue;
    if (typeof correction.confidence !== "number" || correction.confidence < correctMin) continue;

    for (const segmentId of window.correctionSegmentIds) {
      if (args.revertedSegmentIds.has(segmentId)) continue;
      const segment = args.segmentsById.get(segmentId);
      const current = segment?.classification;
      if (!current) continue;
      if (UNTOUCHABLE_SOURCES.has(current.source)) continue;

      const nextCategory = (correction.category ?? current.category) as ActivityCategory;
      const nextProductivity = (correction.productivity ?? current.productivity) as ProductivityLabel;
      if (!VALID_CATEGORIES.has(nextCategory) || !VALID_PRODUCTIVITY.has(nextProductivity)) continue;
      if (nextCategory === current.category && nextProductivity === current.productivity) continue;

      correctionClassifications.push({
        segmentId,
        category: nextCategory,
        productivity: nextProductivity,
        source: "ai_review",
        confidence: correction.confidence,
        reason: correction.reason ?? null,
        inputFingerprint: current.inputFingerprint ?? `segment:${segmentId}`,
        model: null,
      });
      correctionEvents.push({
        segmentId,
        prevCategory: current.category,
        prevProductivity: current.productivity,
        prevSource: current.source,
        newCategory: nextCategory,
        newProductivity: nextProductivity,
        confidence: correction.confidence,
        reason: correction.reason ?? null,
      });
    }
  }

  return { windowAssignments, correctionClassifications, correctionEvents };
}

export interface RunProjectPassOptions {
  readonly range: { readonly start: string; readonly end: string };
  readonly trigger: ProjectPassTrigger;
  readonly tracker: TrackerApi;
  readonly inference: ProjectPassInference;
  readonly now: () => string;
  readonly startOfDayMinutes?: number;
  readonly contextPolicy: ProjectPassContextPolicy;
  /** User work profile for prompt grounding (privacy-gated by the caller). Null when opted out. */
  readonly workProfile?: string | null;
  /** Reports chunk progress: (completed, total). Fired once with (0, total) up front. */
  readonly onProgress?: (done: number, total: number) => void;
}

export interface ProjectPassSummary {
  readonly ran: boolean;
  readonly skippedReason?: string;
  readonly chunks: number;
  readonly assignments: number;
  readonly corrections: number;
  /** Corrections rejected by current user choices or disappeared local data. */
  readonly skippedCorrections?: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /**
   * Chunks whose inference produced no usable output (HTTP error, unparseable
   * body). These are failures, not "nothing matched", so callers must not
   * present them as a completed empty result.
   */
  readonly failedChunks: number;
}

interface ProjectPassChunkResult {
  readonly usage: ProjectPassInferenceUsage;
  readonly windowAssignments: ProjectWindowAssignmentRecord[];
  readonly correctionClassifications: ActivityClassificationRecord[];
  readonly correctionEvents: Array<Omit<AiReviewEventInput, "passId">>;
  readonly cached: boolean;
  readonly failed?: boolean;
}

let inFlight: Promise<ProjectPassSummary> | null = null;
let inFlightRangeKey: string | null = null;
let queuedTail: Promise<unknown> | null = null;

function projectPassRangeKey(range: { readonly start: string; readonly end: string }): string {
  return `${range.start}..${range.end}`;
}

/**
 * Serialize passes so scheduled + on-open + manual triggers never overlap.
 *
 * Coalescing is keyed on the analyzed range: a caller asking for a WIDER window
 * (project creation backfills the latest 7 days) must not be handed the running
 * today-only pass's promise and told its window is complete. Different ranges
 * queue behind the current run instead of sharing its result.
 */
export function runProjectPass(options: RunProjectPassOptions): Promise<ProjectPassSummary> {
  const rangeKey = projectPassRangeKey(options.range);
  if (inFlight && inFlightRangeKey === rangeKey) return inFlight;

  const start = (): Promise<ProjectPassSummary> => {
    inFlightRangeKey = rangeKey;
    inFlight = runProjectPassInner(options).finally(() => {
      inFlight = null;
      inFlightRangeKey = null;
    });
    return inFlight;
  };

  // Include the first pass in the queue tail. A resolved initial tail lets
  // the next range start while that first pass is still doing inference or
  // persistence. Keep the tail until the entire queue drains, including the
  // brief gap between a completed pass and the next one starting.
  const queued = queuedTail ? queuedTail.then(start, start) : start();
  const settled = queued.then(() => undefined, () => undefined);
  queuedTail = settled;
  void settled.then(() => {
    if (queuedTail === settled) queuedTail = null;
  });
  return queued;
}

async function runProjectPassInner(options: RunProjectPassOptions): Promise<ProjectPassSummary> {
  const { tracker, inference, range, trigger } = options;
  const runAt = options.now();
  const [fetchedSegments, projects, teamProjects] = await Promise.all([
    tracker.getTimeline({ start: range.start, end: range.end }),
    tracker.getProjects(),
    tracker.getTeamProjects().catch(() => []),
  ]);
  // Older Windows builds stored failed foreground reads as activity. They
  // cannot contribute to an AI analysis window or a project assignment.
  const segments = fetchedSegments.filter((segment) => !isFailedForegroundCaptureSegment(segment));
  const activeProjects = projects.filter((project) => project.status === "active");
  // Classify once against the union of personal + subscribed team projects; team
  // assignments route to the local team mirror (below) and never touch the personal
  // project table's FK.
  const activeTeamProjects = teamProjects.filter((project) => project.status === "active");
  const teamProjectIds = new Set(activeTeamProjects.map((project) => project.id));
  const validProjectIds = new Set([
    ...activeProjects.map((project) => project.id),
    ...teamProjectIds,
  ]);

  const promptProjects = [
    ...activeProjects.map((project) => toPromptProject(project)),
    ...activeTeamProjects.map((project) => toPromptProject(project)),
  ];
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const windows = buildProjectPassAnalysisWindows(segments, {
    range,
    startOfDayMinutes: options.startOfDayMinutes ?? 0,
    completedThrough: runAt,
    contextPolicy: options.contextPolicy,
  });
  if (windows.length === 0) {
    return {
      ran: false,
      skippedReason: segments.length === 0 ? "no activity in range" : "no completed activity windows",
      chunks: 0,
      assignments: 0,
      corrections: 0,
      tokensIn: 0,
      tokensOut: 0,
      failedChunks: 0,
    };
  }

  const revertedSegmentIds = new Set(
    await tracker
      .getAiReviewEvents({ start: range.start, end: range.end })
      .then((events) => events.filter((event) => event.revertedAt).map((event) => event.segmentId))
      .catch(() => []),
  );

  // Skip re-analyzing chunks whose fingerprint (core windows + project defs +
  // prompt version) already has fresh fixed-window assignments.
  const cachedWindowsByFingerprint = await tracker
    .getProjectWindowAssignments({ start: range.start, end: range.end })
    .then((rows) => {
      const grouped = new Map<string, Set<string>>();
      for (const row of rows) {
        if (row.stale || !row.chunkFingerprint) continue;
        const starts = grouped.get(row.chunkFingerprint) ?? new Set<string>();
        starts.add(row.windowStartedAt);
        grouped.set(row.chunkFingerprint, starts);
      }
      return grouped;
    })
    .catch(() => new Map<string, Set<string>>());

  const chunks = planProjectPassChunks(windows);
  options.onProgress?.(0, chunks.length);
  const bufferedWindowAssignments: ProjectWindowAssignmentRecord[] = [];
  const bufferedClassifications: ActivityClassificationRecord[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let model: string | null = null;
  let provider: string | null = null;

  const results = await runProjectPassChunks(chunks, async (chunk) => {
    const fingerprint = await projectPassChunkFingerprint(
      chunk.coreWindows,
      promptProjects,
      options.workProfile ?? null,
      {
        beforeContextWindows: chunk.beforeContextWindows,
        afterContextWindows: chunk.afterContextWindows,
      },
    );
    const cachedWindowStarts = cachedWindowsByFingerprint.get(fingerprint);
    if (cachedWindowStarts && chunk.coreWindows.every((window) => cachedWindowStarts.has(window.startedAt))) {
      // Identical prompt already analyzed; reuse the stored assignments untouched.
      return { usage: {}, windowAssignments: [], correctionClassifications: [], correctionEvents: [], cached: true };
    }
    const promptInput: ProjectPassPromptInput = {
      beforeContextWindows: chunk.beforeContextWindows,
      coreWindows: chunk.coreWindows,
      afterContextWindows: chunk.afterContextWindows,
      workProfile: options.workProfile ?? null,
      projects: promptProjects,
    };
    const prompt = buildProjectPassPrompt(promptInput);
    const { output, usage } = await inference(prompt, promptInput);
    // A null output means the provider call failed or returned something we
    // could not parse. Recording it as an ordinary empty chunk would make a
    // transport failure indistinguishable from "no project matched".
    if (!output) return { usage, windowAssignments: [], correctionClassifications: [], correctionEvents: [], cached: false, failed: true };
    const resolved = resolveProjectPassApply({
      output,
      windows: chunk.coreWindows,
      segmentsById,
      validProjectIds,
      revertedSegmentIds,
      chunkFingerprint: fingerprint,
      now: runAt,
    });
    return { usage, ...resolved, cached: false };
  }, (done) => options.onProgress?.(done, chunks.length));

  for (const result of results) {
    tokensIn += result.usage.tokensIn ?? 0;
    tokensOut += result.usage.tokensOut ?? 0;
    model = result.usage.model ?? model;
    provider = result.usage.provider ?? provider;
    bufferedWindowAssignments.push(...result.windowAssignments);
    bufferedClassifications.push(...result.correctionClassifications);
  }
  const failedChunks = results.reduce((count, result) => (result.failed ? count + 1 : count), 0);

  if (results.length > 0 && results.every((result) => result.cached)) {
    return {
      ran: false,
      skippedReason: "already analyzed",
      chunks: chunks.length,
      assignments: 0,
      corrections: 0,
      tokensIn: 0,
      tokensOut: 0,
      failedChunks: 0,
    };
  }

  const passRecord = await tracker.recordProjectPass({
    rangeStart: range.start,
    rangeEnd: range.end,
    trigger,
    model,
    provider,
    runsCount: windows.length,
    tokensIn,
    tokensOut,
    assignmentsCount: bufferedWindowAssignments.length,
    // Accepted corrections increment this atomically when they are persisted.
    correctionsCount: 0,
    promptVersion: PROJECT_PASS_PROMPT_VERSION,
  });

  // One local row owns each fixed window. Personal/team ids are mutually
  // exclusive, which prevents stale attribution from surviving a scope change.
  const persistedWindowAssignments = bufferedWindowAssignments.map((assignment) => {
    const isTeam = Boolean(assignment.projectId && teamProjectIds.has(assignment.projectId));
    return {
      ...assignment,
      projectId: isTeam ? null : assignment.projectId,
      teamProjectId: isTeam ? assignment.projectId : null,
      passId: passRecord.id,
    } satisfies ProjectWindowAssignmentRecord;
  });
  if (persistedWindowAssignments.length) await tracker.saveProjectWindowAssignments(persistedWindowAssignments);
  let persistedCorrections = 0;
  if (bufferedClassifications.length) {
    const result = await tracker.saveClassifications(bufferedClassifications.map((record) => ({
      ...record, reviewPassId: passRecord.id,
    })));
    persistedCorrections = result.saved;
  }

  return {
    ran: true,
    chunks: chunks.length,
    assignments: bufferedWindowAssignments.length,
    corrections: persistedCorrections,
    skippedCorrections: bufferedClassifications.length - persistedCorrections,
    tokensIn,
    tokensOut,
    failedChunks,
  };
}

async function runProjectPassChunks(
  chunks: readonly ProjectPassChunkPlan[],
  runChunk: (chunk: ProjectPassChunkPlan) => Promise<ProjectPassChunkResult>,
  onChunkComplete: (done: number) => void,
): Promise<ProjectPassChunkResult[]> {
  const results = new Map<number, ProjectPassChunkResult>();
  let nextIndex = 0;
  let completed = 0;
  let failed = false;
  let failure: unknown;
  const workerCount = Math.min(PROJECT_PASS_MAX_PARALLEL_CHUNKS, chunks.length);
  const runWorker = async () => {
    for (;;) {
      if (failed) return;
      const index = nextIndex;
      nextIndex += 1;
      const chunk = chunks[index];
      if (!chunk) return;
      try {
        results.set(index, await runChunk(chunk));
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
        return;
      }
      completed += 1;
      onChunkComplete(completed);
    }
  };
  // A rejected chunk must not release the pass queue while sibling provider
  // requests are still active. Stop new chunks and drain those already started.
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  if (failed) throw failure;
  return chunks.flatMap((_, index) => {
    const result = results.get(index);
    return result ? [result] : [];
  });
}
