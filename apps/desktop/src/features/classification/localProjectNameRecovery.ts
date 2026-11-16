import { type ProjectPassPromptInput } from "@drifty/domain";
import { projectPassOutputComplete, type ProjectPassOutput } from "./aiProjectReviewService";

/** The fallback is deliberately limited; never turn unknown names into project IDs. */
// A planned project chunk contains at most 128 core windows.
const MAX_NAME_VERIFICATIONS = 128;
const VERIFY_CONFIDENCE = 0.8;
type Verdict = { answer: "YES" | "NO"; confidence: number };

type Verify = (prompt: string) => Promise<Verdict | null>;

function anchoredProjects(window: ProjectPassPromptInput["coreWindows"][number], projects: ProjectPassPromptInput["projects"]) {
  const titleMatches = (value: string) => {
    if (value.length < 2) return false;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu");
    return window.contributors.slice(0, 3).some(contributor => contributor.contexts.some(context =>
      [context.title, context.windowTitle].some(title => title && word.test(title))));
  };
  return projects.filter(project => titleMatches(project.name.trim()) || project.anchors.some(anchor => {
    if (anchor.source !== "manual") return false;
    const value = anchor.value.trim().toLowerCase();
    if (!value) return false;
    return window.contributors.slice(0, 3).some(contributor => {
      if (anchor.kind === "app") return contributor.appName.trim().toLowerCase() === value;
      if (anchor.kind === "domain") return contributor.domain?.trim().toLowerCase() === value;
      return titleMatches(value);
    });
  }));
}

export function parseLocalProjectVerdict(content: string): Verdict | null {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/giu, "").trim();
  const fenced = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  try {
    const result: unknown = JSON.parse(fenced?.[1] ?? cleaned);
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    const { answer, confidence } = result as Record<string, unknown>;
    if ((answer !== "YES" && answer !== "NO") || typeof confidence !== "number"
      || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    return { answer, confidence };
  } catch { return null; }
}

/** Check local project matches, resolving only exact, unambiguous names. */
export async function recoverLocalProjectNames(
  output: ProjectPassOutput, input: ProjectPassPromptInput, verify: Verify,
): Promise<ProjectPassOutput | null> {
  const core = new Map(input.coreWindows.map((window) => [window.id, window]));
  const context = new Set([...input.beforeContextWindows, ...input.afterContextWindows].map((window) => window.id));
  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const names = new Map<string, typeof input.projects[number][]>();
  for (const project of input.projects) {
    const key = project.name.trim().toLowerCase();
    names.set(key, [...(names.get(key) ?? []), project]);
  }
  const assignments: ProjectPassOutput["assignments"][number][] = [];
  const seen = new Set<string>();
  const verdicts = new Map<string, Verdict | null>();
  let verifiedCount = 0;
  for (const assignment of output.assignments) {
    if (!core.has(assignment.id)) {
      if (context.has(assignment.id)) continue;
      return null;
    }
    if (seen.has(assignment.id)) return null;
    seen.add(assignment.id);
    const window = core.get(assignment.id)!;
    const anchored = assignment.projectId === null ? anchoredProjects(window, input.projects) : [];
    if (assignment.projectId === null && anchored.length !== 1) {
      assignments.push(assignment);
      continue;
    }
    const known = assignment.projectId === null ? undefined : projects.get(assignment.projectId);
    const candidates = assignment.projectId === null ? anchored : known ? [known] : names.get(assignment.projectId.trim().toLowerCase()) ?? [];
    if (candidates.length !== 1 || ++verifiedCount > MAX_NAME_VERIFICATIONS) return null;
    const project = candidates[0]!;
    if (!window.contributors[0]) return null;
    const activity = window.contributors.slice(0, 3).map(contributor => {
      const titles = contributor.contexts.slice(0, 3).map(context => context.title || context.windowTitle).filter(Boolean);
      return [contributor.appName, ...titles, contributor.domain].filter(Boolean).join(" — ");
    }).join("; ");
    const prompt = [
      "Decide whether this activity is actually part of this specific project. Use the app and title as evidence. If the activity clearly matches the project purpose answer YES; unrelated personal activities are NO.",
      `Project: ${project.name}: ${project.description}`,
      `Activity: ${activity}`,
      ...(project.anchors.some(anchor => anchor.source === "manual") ? [`User-provided project signals: ${project.anchors.filter(anchor => anchor.source === "manual").map(anchor => `${anchor.kind}=${anchor.value}`).join(", ")}`] : []),
      "Confidence is certainty in your answer: a definite NO has confidence 0.95, not 0.0.",
      'Is the activity part of the project? Return JSON only: {"answer":"YES" or "NO","confidence":0.0}',
    ].join("\n");
    let verdict = verdicts.get(prompt);
    if (verdict === undefined) {
      verdict = await verify(prompt);
      verdicts.set(prompt, verdict);
    }
    if (!verdict || verdict.confidence < VERIFY_CONFIDENCE) return null;
    const accepted = verdict.answer === "YES";
    assignments.push({ ...assignment, projectId: accepted ? project.id : null,
      confidence: assignment.projectId === null && accepted ? verdict.confidence : Math.min(assignment.confidence, verdict.confidence), reason: undefined });
  }
  const corrections = output.corrections.filter((correction) => {
    if (core.has(correction.id)) return true;
    return false;
  });
  if (output.corrections.some((correction) => !core.has(correction.id) && !context.has(correction.id))) return null;
  const recovered = { assignments, corrections };
  return projectPassOutputComplete(recovered, input) ? recovered : null;
}
