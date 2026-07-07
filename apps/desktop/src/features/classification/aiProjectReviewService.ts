import {
  buildProjectPassPrompt,
  summarizeProjectPassChunk,
  compactActivityRuns,
  formatProjectRunLine,
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
  type ProjectPassPromptProject,
  type ProjectPassTrigger,
  type ProductivityLabel,
  type ProjectRun,
  type TrackerApi,
} from "@drifty/domain";

/** Auto-apply a correction only at or above this confidence (trust gate). */
export const PROJECT_CORRECTION_MIN_CONFIDENCE = 0.8;
/** Cap on run lines per inference chunk; longer spans split across calls. Kept
 *  modest so the JSON output (one assignment + optional correction per run)
 *  fits comfortably within the model's output-token budget. */
export const PROJECT_PASS_MAX_CHUNK_RUNS = 80;
/** A scheduled pass is "stale" (re-runnable on open) after this many ms. */
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

export function parseProjectPassOutput(content: string): ProjectPassOutput | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as Partial<ProjectPassOutput>;
    return {
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
    };
  } catch {
    return null;
  }
}

/** Split runs into contiguous chunks no larger than the per-call cap. */
export function chunkProjectRuns(runs: ProjectRun[], maxRuns = PROJECT_PASS_MAX_CHUNK_RUNS): ProjectRun[][] {
  if (runs.length <= maxRuns) return runs.length ? [runs] : [];
  const chunks: ProjectRun[][] = [];
  for (let index = 0; index < runs.length; index += maxRuns) {
    chunks.push(runs.slice(index, index + maxRuns));
  }
  return chunks;
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

/** SHA-256 over the run lines + active project definitions + prompt version. */
export async function projectPassChunkFingerprint(
  runs: ProjectRun[],
  projects: ProjectPassPromptProject[],
): Promise<string> {
  const projectSignature = projects
    .map((project) => `${project.id}:${project.name}:${project.description}:${project.anchors.map((a) => `${a.kind}=${a.value}`).join(",")}`)
    .join("|");
  const canonical = `${PROJECT_PASS_PROMPT_VERSION}\n${projectSignature}\n${runs.map(formatProjectRunLine).join("\n")}`;
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
  readonly runs: ProjectRun[];
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
  const runsById = new Map(args.runs.map((run) => [run.id, run]));

  const assignments: ProjectAssignmentRecord[] = [];
  for (const assignment of args.output.assignments) {
    const run = runsById.get(assignment.id);
    if (!run || run.minor) continue;
    const confident = typeof assignment.confidence === "number" && assignment.confidence >= assignMin;
    const projectId =
      confident && assignment.projectId && args.validProjectIds.has(assignment.projectId) ? assignment.projectId : null;
    for (const segmentId of run.segmentIds) {
      assignments.push({
        segmentId,
        projectId,
        source: "ai",
        confidence: typeof assignment.confidence === "number" ? assignment.confidence : null,
        reason: assignment.reason ?? null,
        chunkFingerprint: args.chunkFingerprint,
        assignedAt: args.now,
      });
    }
  }

  const correctionClassifications: ActivityClassificationRecord[] = [];
  const correctionEvents: Array<Omit<AiReviewEventInput, "passId">> = [];
  for (const correction of args.output.corrections) {
    const run = runsById.get(correction.id);
    if (!run || run.minor) continue;
    if (typeof correction.confidence !== "number" || correction.confidence < correctMin) continue;

    for (const segmentId of run.segmentIds) {
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
  const projectNameById = new Map(activeProjects.map((project) => [project.id, project.name]));

  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const runs = compactActivityRuns(segments, { includeTitleContext: options.includeTitleContext ?? true });
  if (runs.length === 0) {
    return { ran: false, skippedReason: "no activity in range", chunks: 0, assignments: 0, corrections: 0, tokensIn: 0, tokensOut: 0 };
  }

  const revertedSegmentIds = new Set(
    await tracker
      .getAiReviewEvents({ start: range.start, end: range.end })
      .then((events) => events.filter((event) => event.revertedAt).map((event) => event.segmentId))
      .catch(() => []),
  );

  const chunks = chunkProjectRuns(runs);
  options.onProgress?.(0, chunks.length);
  const bufferedAssignments: ProjectAssignmentRecord[] = [];
  const bufferedClassifications: ActivityClassificationRecord[] = [];
  const bufferedEvents: Array<Omit<AiReviewEventInput, "passId">> = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let model: string | null = null;
  let provider: string | null = null;

  let previousChunkSummary: string | null = null;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkRuns = chunks[index];
    const fingerprint = await projectPassChunkFingerprint(chunkRuns, promptProjects);
    const prompt = buildProjectPassPrompt({
      runs: chunkRuns,
      workProfile: options.workProfile ?? null,
      projects: promptProjects,
      previousChunkSummary,
    });
    const { output, usage } = await inference(prompt);
    tokensIn += usage.tokensIn ?? 0;
    tokensOut += usage.tokensOut ?? 0;
    model = usage.model ?? model;
    provider = usage.provider ?? provider;
    options.onProgress?.(index + 1, chunks.length);
    if (!output) continue;

    const resolved = resolveProjectPassApply({
      output,
      runs: chunkRuns,
      segmentsById,
      validProjectIds,
      revertedSegmentIds,
      chunkFingerprint: fingerprint,
      now: options.now(),
    });
    bufferedAssignments.push(...resolved.assignments);
    bufferedClassifications.push(...resolved.correctionClassifications);
    bufferedEvents.push(...resolved.correctionEvents);

    // Carry this chunk's tail (runs + the project the model assigned them) into
    // the next chunk so day continuity survives the 80-run boundary.
    if (index + 1 < chunks.length) {
      const assignedProjectById = new Map(output.assignments.map((assignment) => [assignment.id, assignment.projectId]));
      previousChunkSummary = summarizeProjectPassChunk(chunkRuns, assignedProjectById, projectNameById);
    }
  }

  // Record the pass once with full stats, then flush all writes against its id.
  const passRecord = await tracker.recordProjectPass({
    rangeStart: range.start,
    rangeEnd: range.end,
    trigger,
    model,
    provider,
    runsCount: runs.length,
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
