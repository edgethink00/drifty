import { BROWSER_CONTENT_GUIDANCE, normalizeBrowserContentClues } from "./browserContentContext";
import type { ProjectAnchor } from "./commands";
import { formatProjectPassAnalysisWindowLine, type ProjectPassAnalysisWindow } from "./projectPassWindow";

export const PROJECT_PASS_PROMPT_VERSION = "pp-v5-browser-clues";

export const PROJECT_ASSIGNMENT_MIN_CONFIDENCE = 0.6;

export interface ProjectPassPromptProject {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly anchors: readonly ProjectAnchor[];
}

export interface ProjectPassPromptInput {
  readonly beforeContextWindows: readonly ProjectPassAnalysisWindow[];
  readonly coreWindows: readonly ProjectPassAnalysisWindow[];
  readonly afterContextWindows: readonly ProjectPassAnalysisWindow[];
  readonly workProfile: string | null;
  readonly projects: readonly ProjectPassPromptProject[];
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
  return lines.join("\n");
}

export function buildProjectPassPrompt(input: ProjectPassPromptInput): string {
  const projectList = input.projects.length
    ? input.projects.map(projectBlock).join("\n")
    : "(none defined — return an empty assignments array and focus on corrections)";

  const beforeContextLines = formatWindowLines(input.beforeContextWindows);
  const coreWindowLines = formatWindowLines(input.coreWindows);
  const afterContextLines = formatWindowLines(input.afterContextWindows);

  return [
    "You are reviewing one user's day of computer activity to (1) attribute activity",
    "analysis windows to the user's projects and (2) correct earlier per-segment classifications",
    "that are wrong in day-level context.",
    "",
    `User work profile: ${input.workProfile?.trim() ? input.workProfile.trim() : "(not provided)"}`,
    "",
    "Projects (the only valid project ids):",
    projectList,
    "",
    "Context before (read-only; do not output these ids):",
    beforeContextLines,
    "",
    "Core analysis windows (return assignments and corrections only for these ids):",
    coreWindowLines,
    "",
    "Context after (read-only; do not output these ids):",
    afterContextLines,
    "",
    ...([...input.beforeContextWindows,...input.coreWindows,...input.afterContextWindows].some(w=>w.contributors.some(c=>c.contexts.some(x=>normalizeBrowserContentClues(x.browserContext)))) ? [BROWSER_CONTENT_GUIDANCE] : []),
    "Rules:",
    "- Treat every core window as an independent decision. A title or task change may",
    "  change the project even when adjacent windows use the same app or domain.",
    "- Return exactly one assignment item for every core window id, using projectId null",
    "  when the window belongs to no project.",
    "- Assign each window to at most one project id, or null when it belongs to none",
    "  (personal, generic browsing, entertainment unrelated to any project). Use",
    "  surrounding windows as context, not just the window in isolation.",
    `- Prefer null over guessing below ${PROJECT_ASSIGNMENT_MIN_CONFIDENCE} confidence.`,
    "- Only assign to a project id listed above; never invent ids.",
    "- Independently, emit a correction when a window's current category or productivity",
    "  is wrong given day-level context (for example, social-media activity that is",
    "  actually part of a project's work). Only correct when clearly justified; never",
    "  restate labels that are already correct, and never correct manual or rule labels.",
    "- Categories: workspace, learning, communication, music, game, social_media,",
    "  entertainment, shopping, utility, unknown. Productivity: focus, neutral, drift.",
    "- Reasons must be short and must not quote raw titles, URLs, or work profile details.",
    "- Ignore surrounding context ids in the output.",
    'Return JSON only in the shape {"assignments":[{"id":string,"projectId":string|null,"confidence":number,"reason":string}],"corrections":[{"id":string,"category":string|null,"productivity":string|null,"confidence":number,"reason":string}]}.',
  ].join("\n");
}

function formatWindowLines(windows: readonly ProjectPassAnalysisWindow[]): string {
  return windows.length ? windows.map(formatProjectPassAnalysisWindowLine).join("\n") : "(none)";
}

export const PROJECT_PASS_SUMMARY_TAIL_WINDOWS = 6;

export function summarizeProjectPassChunk(
  windows: readonly ProjectPassAnalysisWindow[],
  assignedProjectById: ReadonlyMap<string, string | null>,
  projectNameById: ReadonlyMap<string, string>,
): string {
  const tail = windows.slice(-PROJECT_PASS_SUMMARY_TAIL_WINDOWS);
  if (tail.length === 0) return "none";
  return tail
    .map((window) => {
      const projectId = assignedProjectById.get(window.id) ?? null;
      const label = projectId ? projectNameById.get(projectId) ?? projectId : "no project";
      return `${formatProjectPassAnalysisWindowLine(window)} -> ${label}`;
    })
    .join("\n");
}
