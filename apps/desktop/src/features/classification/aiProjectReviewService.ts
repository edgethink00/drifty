import {
  buildProjectPassPrompt,
  buildProjectPassAnalysisWindows,
  formatProjectPassAnalysisWindowLine,
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  PROJECT_ASSIGNMENT_MIN_CONFIDENCE,
  PROJECT_PASS_PROMPT_VERSION,
  type ActivityCategory,
  type ActivitySegment,
  type ActivityClassificationRecord,
  type AiReviewEventInput,
  type Project,
  type ProjectAssignmentRecord,
  type ProjectPassAnalysisWindow,
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

/** Provider-agnostic inference. Concrete wiring (OpenRouter / Cloud) is injected. */
export type ProjectPassInference = (prompt: string) => Promise<ProjectPassInferenceResult>;

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

function toPromptProject(project: Project, exemplarsByProject: Map<string, string[]>): ProjectPassPromptProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    anchors: project.anchors,
    exemplars: exemplarsByProject.get(project.id) ?? [],
  };
}

export async function projectPassChunkFingerprint(
  windows: ProjectPassAnalysisWindow[],
  projects: ProjectPassPromptProject[],
): Promise<string> {
  const projectSignature = projects
    .map((project) => `${project.id}:${project.name}:${project.description}:${project.anchors.map((a) => `${a.kind}=${a.value}`).join(",")}`)
    .join("|");
  const canonical = `${PROJECT_PASS_PROMPT_VERSION}\n${projectSignature}\n${windows.map(formatProjectPassAnalysisWindowLine).join("\n")}`;
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `pp-${hex}`;
}

export interface ResolvedProjectApply {
  readonly assignments: ProjectAssignmentRecord[];
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

interface AssignmentCandidate {
  readonly assignment: ProjectAssignmentRecord;
  readonly overlapSeconds: number;
}

function chooseAssignmentCandidate(
  existing: AssignmentCandidate | undefined,
  candidate: AssignmentCandidate,
): AssignmentCandidate {
  if (!existing) return candidate;
  if (candidate.overlapSeconds > existing.overlapSeconds) return candidate;
  const candidateConfidence = candidate.assignment.confidence ?? 0;
  const existingConfidence = existing.assignment.confidence ?? 0;
  if (candidate.overlapSeconds === existing.overlapSeconds && candidateConfidence > existingConfidence) return candidate;
  return existing;
}

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

  const assignmentsBySegmentId = new Map<string, AssignmentCandidate>();
  for (const assignment of args.output.assignments) {
    const window = windowsById.get(assignment.id);
    if (!window) continue;
    const confident = typeof assignment.confidence === "number" && assignment.confidence >= assignMin;
    const projectId =
      confident && assignment.projectId && args.validProjectIds.has(assignment.projectId) ? assignment.projectId : null;
    for (const overlap of window.segmentOverlaps) {
      const candidate: AssignmentCandidate = {
        assignment: {
          segmentId: overlap.segmentId,
          projectId,
          source: "ai",
          confidence: typeof assignment.confidence === "number" ? assignment.confidence : null,
          reason: assignment.reason ?? null,
          chunkFingerprint: args.chunkFingerprint,
          assignedAt: args.now,
        },
        overlapSeconds: overlap.durationSeconds,
      };
      assignmentsBySegmentId.set(overlap.segmentId, chooseAssignmentCandidate(assignmentsBySegmentId.get(overlap.segmentId), candidate));
    }
  }
  const assignments = Array.from(assignmentsBySegmentId.values()).map((candidate) => candidate.assignment);

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

  return { assignments, correctionClassifications, correctionEvents };
}

export interface RunProjectPassOptions {
  readonly range: { readonly start: string; readonly end: string };
  readonly trigger: ProjectPassTrigger;
  readonly tracker: TrackerApi;
  readonly inference: ProjectPassInference;
  readonly now: () => string;
  readonly startOfDayMinutes?: number;
  readonly includeTitleContext?: boolean;
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
  readonly tokensIn: number;
  readonly tokensOut: number;
}

interface ProjectPassChunkResult {
  readonly usage: ProjectPassInferenceUsage;
  readonly assignments: ProjectAssignmentRecord[];
  readonly correctionClassifications: ActivityClassificationRecord[];
  readonly correctionEvents: Array<Omit<AiReviewEventInput, "passId">>;
}

let inFlight: Promise<ProjectPassSummary> | null = null;

/** Serialize passes so scheduled + on-open + manual triggers never overlap. */
export function runProjectPass(options: RunProjectPassOptions): Promise<ProjectPassSummary> {
  if (inFlight) return inFlight;
  inFlight = runProjectPassInner(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runProjectPassInner(options: RunProjectPassOptions): Promise<ProjectPassSummary> {
  const { tracker, inference, range, trigger } = options;
  const [segments, projects] = await Promise.all([
    tracker.getTimeline({ start: range.start, end: range.end }),
    tracker.getProjects(),
  ]);
  const activeProjects = projects.filter((project) => project.status === "active");
  const validProjectIds = new Set(activeProjects.map((project) => project.id));

  const exemplarsByProject = new Map<string, string[]>();
  const promptProjects = activeProjects.map((project) => toPromptProject(project, exemplarsByProject));
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const windows = buildProjectPassAnalysisWindows(segments, {
    range,
    startOfDayMinutes: options.startOfDayMinutes ?? 0,
    includeTitleContext: options.includeTitleContext ?? false,
  });
  if (windows.length === 0) {
    return { ran: false, skippedReason: "no activity in range", chunks: 0, assignments: 0, corrections: 0, tokensIn: 0, tokensOut: 0 };
  }

  const revertedSegmentIds = new Set(
    await tracker
      .getAiReviewEvents({ start: range.start, end: range.end })
      .then((events) => events.filter((event) => event.revertedAt).map((event) => event.segmentId))
      .catch(() => []),
  );

  const chunks = planProjectPassChunks(windows);
  options.onProgress?.(0, chunks.length);
  const bufferedAssignments: ProjectAssignmentRecord[] = [];
  const bufferedClassifications: ActivityClassificationRecord[] = [];
  const bufferedEvents: Array<Omit<AiReviewEventInput, "passId">> = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let model: string | null = null;
  let provider: string | null = null;

  const results = await runProjectPassChunks(chunks, async (chunk) => {
    const fingerprint = await projectPassChunkFingerprint(chunk.coreWindows, promptProjects);
    const prompt = buildProjectPassPrompt({
      beforeContextWindows: chunk.beforeContextWindows,
      coreWindows: chunk.coreWindows,
      afterContextWindows: chunk.afterContextWindows,
      workProfile: options.workProfile ?? null,
      projects: promptProjects,
    });
    const { output, usage } = await inference(prompt);
    if (!output) return { usage, assignments: [], correctionClassifications: [], correctionEvents: [] };
    const resolved = resolveProjectPassApply({
      output,
      windows: chunk.coreWindows,
      segmentsById,
      validProjectIds,
      revertedSegmentIds,
      chunkFingerprint: fingerprint,
      now: options.now(),
    });
    return { usage, ...resolved };
  }, (done) => options.onProgress?.(done, chunks.length));

  for (const result of results) {
    tokensIn += result.usage.tokensIn ?? 0;
    tokensOut += result.usage.tokensOut ?? 0;
    model = result.usage.model ?? model;
    provider = result.usage.provider ?? provider;
    bufferedAssignments.push(...result.assignments);
    bufferedClassifications.push(...result.correctionClassifications);
    bufferedEvents.push(...result.correctionEvents);
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
    assignmentsCount: bufferedAssignments.length,
    correctionsCount: bufferedClassifications.length,
    promptVersion: PROJECT_PASS_PROMPT_VERSION,
  });

  if (bufferedAssignments.length) {
    await tracker.saveProjectAssignments(bufferedAssignments.map((assignment) => ({ ...assignment, passId: passRecord.id })));
  }
  if (bufferedClassifications.length) {
    await tracker.saveClassifications(bufferedClassifications);
    await tracker.saveAiReviewEvents(bufferedEvents.map((event) => ({ ...event, passId: passRecord.id })));
  }

  return {
    ran: true,
    chunks: chunks.length,
    assignments: bufferedAssignments.length,
    corrections: bufferedClassifications.length,
    tokensIn,
    tokensOut,
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
  const workerCount = Math.min(PROJECT_PASS_MAX_PARALLEL_CHUNKS, chunks.length);
  const runWorker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const chunk = chunks[index];
      if (!chunk) return;
      results.set(index, await runChunk(chunk));
      completed += 1;
      onChunkComplete(completed);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return chunks.flatMap((_, index) => {
    const result = results.get(index);
    return result ? [result] : [];
  });
}
