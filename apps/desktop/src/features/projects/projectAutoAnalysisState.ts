export type ProjectAutoAnalysisPhase =
  | "idle"
  | "waiting_for_model"
  | "queued"
  | "running"
  | "complete"
  | "error";

/**
 * Per-project automatic-matching phase. Keyed by project id because creating a
 * second project must not erase the first project's state and silently restore
 * a finished-looking "0m" for work that was never analyzed.
 */
export type ProjectAutoAnalysisState = Readonly<Record<string, ProjectAutoAnalysisPhase>>;

export const IDLE_PROJECT_AUTO_ANALYSIS: ProjectAutoAnalysisState = {};

export function projectAutoAnalysisPhase(state: ProjectAutoAnalysisState, projectId: string): ProjectAutoAnalysisPhase {
  return state[projectId] ?? "idle";
}

export function setProjectAutoAnalysisPhase(
  state: ProjectAutoAnalysisState,
  projectId: string,
  phase: ProjectAutoAnalysisPhase,
): ProjectAutoAnalysisState {
  return { ...state, [projectId]: phase };
}

/** Phases that still owe the user a run, in creation order of the pending set. */
export function projectsAwaitingAutoAnalysis(state: ProjectAutoAnalysisState): readonly string[] {
  return Object.entries(state)
    .filter(([, phase]) => phase === "error")
    .map(([projectId]) => projectId);
}

/**
 * Projects parked because no analysis model was connected. Connecting one is
 * the event that unblocks them, so they must not stay on "Setup needed" once
 * the slot is configured.
 */
export function projectsBlockedOnModel(state: ProjectAutoAnalysisState): readonly string[] {
  return Object.entries(state)
    .filter(([, phase]) => phase === "waiting_for_model")
    .map(([projectId]) => projectId);
}

/** The single surface-level phase for the shared matching card. */
export function aggregateProjectAutoAnalysisPhase(state: ProjectAutoAnalysisState): ProjectAutoAnalysisPhase {
  const phases = Object.values(state);
  if (phases.includes("running")) return "running";
  if (phases.includes("queued")) return "queued";
  if (phases.includes("error")) return "error";
  if (phases.includes("waiting_for_model")) return "waiting_for_model";
  return "idle";
}

/**
 * A successful pass covers the whole latest-7-days window, so it also clears
 * earlier failures: leaving a project on "Retry needed" after its time has
 * already been matched would ask the user to redo finished work.
 */
export function resolveProjectAutoAnalysisAfterPass(
  state: ProjectAutoAnalysisState,
  projectIds: readonly string[],
  outcome: "complete" | "error",
): ProjectAutoAnalysisState {
  const next: Record<string, ProjectAutoAnalysisPhase> = { ...state };
  for (const [projectId, phase] of Object.entries(next)) {
    if (outcome === "complete" && phase === "error") next[projectId] = "complete";
  }
  for (const projectId of projectIds) next[projectId] = outcome;
  return next;
}
