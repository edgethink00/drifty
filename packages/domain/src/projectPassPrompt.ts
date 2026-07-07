import type { ProjectAnchor } from "./commands";
import { formatProjectRunLine, type ProjectRun } from "./projectRun";

export const PROJECT_PASS_PROMPT_VERSION = "pp-v1";

/** Minimum confidence below which the model is told to prefer no-project over a guess. */
export const PROJECT_ASSIGNMENT_MIN_CONFIDENCE = 0.6;

export interface ProjectPassPromptProject {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly anchors: readonly ProjectAnchor[];
  /** Confirmed/corrected run lines used as few-shot grounding. */
  readonly exemplars: readonly string[];
}

export interface ProjectPassPromptInput {
  readonly runs: readonly ProjectRun[];
  readonly workProfile: string | null;
  readonly projects: readonly ProjectPassPromptProject[];
  readonly previousChunkSummary?: string | null;
}

function anchorLine(anchors: readonly ProjectAnchor[]): string | null {
  if (anchors.length === 0) return null;
  const byKind = (kind: ProjectAnchor["kind"]) =>
    anchors
      .filter((anchor) => anchor.kind === kind)
      .map((anchor) => anchor.value);
  const groups: string[] = [];
  const apps = byKind("app");
  const domains = byKind("domain");
  const keywords = byKind("keyword");
  if (apps.length) groups.push(`apps [${apps.join(", ")}]`);
  if (domains.length) groups.push(`domains [${domains.join(", ")}]`);
  if (keywords.length) groups.push(`keywords [${keywords.join(", ")}]`);
  return groups.length ? `  Known signals: ${groups.join("; ")}` : null;
}

function projectBlock(project: ProjectPassPromptProject): string {
  const lines = [`- ${project.id} "${project.name}": ${project.description}`];
  const signals = anchorLine(project.anchors);
  if (signals) lines.push(signals);
  if (project.exemplars.length) {
    lines.push(`  Confirmed examples:`);
    for (const exemplar of project.exemplars) lines.push(`    ${exemplar}`);
  }
  return lines.join("\n");
}

/**
 * Build the single-message prompt for the heavy project pass. Emits two
 * independent output sections — project assignments and classification
 * corrections — from one inference over the whole chunk.
 */
export function buildProjectPassPrompt(input: ProjectPassPromptInput): string {
  const projectList = input.projects.length
    ? input.projects.map(projectBlock).join("\n")
    : "(none defined — return an empty assignments array and focus on corrections)";

  const runLines = input.runs.map(formatProjectRunLine).join("\n");

  return [
    "You are reviewing one user's day of computer activity to (1) attribute activity",
    "runs to the user's projects and (2) correct earlier per-segment classifications",
    "that are wrong in day-level context.",
    "",
    `User work profile: ${input.workProfile?.trim() ? input.workProfile.trim() : "(not provided)"}`,
    "",
    "Projects (the only valid project ids):",
    projectList,
    "",
    "Activity runs (chronological):",
    runLines,
    "",
    `Previous chunk summary (context only): ${input.previousChunkSummary?.trim() ? input.previousChunkSummary.trim() : "none"}`,
    "",
    "Rules:",
    "- Assign each run to at most one project id, or null when it belongs to none",
    "  (personal, generic browsing, entertainment unrelated to any project). Use",
    "  surrounding runs as context, not just the run in isolation.",
    `- Prefer null over guessing below ${PROJECT_ASSIGNMENT_MIN_CONFIDENCE} confidence.`,
    "- Only assign to a project id listed above; never invent ids.",
    "- Independently, emit a correction when a run's current category or productivity",
    "  is wrong given day-level context (for example, social-media activity that is",
    "  actually part of a project's work). Only correct when clearly justified; never",
    "  restate labels that are already correct, and never correct manual or rule labels.",
    "- Categories: workspace, learning, communication, music, game, social_media,",
    "  entertainment, shopping, utility, unknown. Productivity: focus, neutral, drift.",
    "- Reasons must be short and must not quote raw titles, URLs, or work profile details.",
    'Return JSON only in the shape {"assignments":[{"id":string,"projectId":string|null,"confidence":number,"reason":string}],"corrections":[{"id":string,"category":string|null,"productivity":string|null,"confidence":number,"reason":string}]}.',
  ].join("\n");
}

/** How many trailing runs to carry into the next chunk's summary. */
export const PROJECT_PASS_SUMMARY_TAIL_RUNS = 6;

/**
 * Compact carry-forward summary of a just-processed chunk: its trailing runs
 * paired with the project the model assigned them. Passed as `previousChunkSummary`
 * to the next chunk so day continuity survives the 80-run chunk boundary. Kept to
 * the last few runs so prompt size stays bounded regardless of day length.
 */
export function summarizeProjectPassChunk(
  runs: readonly ProjectRun[],
  assignedProjectById: ReadonlyMap<string, string | null>,
  projectNameById: ReadonlyMap<string, string>,
): string {
  const tail = runs.slice(-PROJECT_PASS_SUMMARY_TAIL_RUNS);
  if (tail.length === 0) return "none";
  return tail
    .map((run) => {
      const projectId = assignedProjectById.get(run.id) ?? null;
      const label = projectId ? projectNameById.get(projectId) ?? projectId : "no project";
      return `${formatProjectRunLine(run)} -> ${label}`;
    })
    .join("\n");
}
