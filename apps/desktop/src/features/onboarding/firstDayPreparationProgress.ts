/**
 * Perceived-progress model for the first-day preparation gate.
 *
 * The gate can run three phases in a row (browser-history import, managed local
 * model download, then classification) and each one used to drive the bar from
 * zero again. A bar that restarts reads as work being thrown away, so the phases
 * are mapped onto ONE track: every phase owns a band of the bar, the band floor
 * is what earlier phases already earned, and the rendered value never moves
 * backwards. The helpers here are pure so the perceived-progress rules can be
 * asserted without rendering the gate.
 */

export type FirstDayPreparationPhase = "importing" | "downloading" | "classifying" | "ready";

/** Phases this run expects to go through, used to size each phase's band. */
export type FirstDayPreparationPlan = readonly FirstDayPreparationPhase[];

/** The gate may skip phases, but it never runs them out of this order. */
const PHASE_ORDER: readonly FirstDayPreparationPhase[] = ["importing", "downloading", "classifying"];

/**
 * Share of the bar each phase owns. Downloading a local model and classifying a
 * full day dominate the real wait; the history import is a short opening beat.
 */
const PHASE_WEIGHT: Record<FirstDayPreparationPhase, number> = {
  importing: 1,
  downloading: 3,
  classifying: 5,
  ready: 0,
};

export type FirstDayPreparationBand = {
  readonly start: number;
  readonly end: number;
};

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The plan actually used for banding: declared phases plus whichever phase is
 * live right now. The gate can enter a phase the plan did not predict (a managed
 * model warmup, say), and silently dropping it would put the live phase outside
 * the track.
 */
export function normalizeFirstDayPreparationPlan(
  plan: FirstDayPreparationPlan,
  phase: FirstDayPreparationPhase,
): readonly FirstDayPreparationPhase[] {
  const included = new Set<FirstDayPreparationPhase>(plan.filter((entry) => entry !== "ready"));
  if (phase !== "ready") included.add(phase);
  const ordered = PHASE_ORDER.filter((entry) => included.has(entry));
  return ordered.length > 0 ? ordered : ["classifying"];
}

/** The 0..1 slice of the single loading track that `phase` fills. */
export function firstDayPreparationBand(
  plan: FirstDayPreparationPlan,
  phase: FirstDayPreparationPhase,
): FirstDayPreparationBand {
  if (phase === "ready") return { start: 1, end: 1 };
  const steps = normalizeFirstDayPreparationPlan(plan, phase);
  const totalWeight = steps.reduce((sum, entry) => sum + PHASE_WEIGHT[entry], 0);
  if (totalWeight <= 0) return { start: 0, end: 1 };
  let start = 0;
  for (const step of steps) {
    const width = PHASE_WEIGHT[step] / totalWeight;
    if (step === phase) return { start, end: start + width };
    start += width;
  }
  return { start: 0, end: 1 };
}

/**
 * Where the whole track sits given this phase's own progress. A phase with no
 * measurable progress still holds the floor its predecessors earned.
 */
export function firstDayPreparationTrackValue(
  plan: FirstDayPreparationPlan,
  phase: FirstDayPreparationPhase,
  phaseProgress: number | null,
): number {
  if (phase === "ready") return 1;
  const band = firstDayPreparationBand(plan, phase);
  if (phaseProgress === null || !Number.isFinite(phaseProgress)) return band.start;
  return band.start + clampUnit(phaseProgress) * (band.end - band.start);
}

/**
 * How far into its own band a phase may creep while it has nothing to measure.
 *
 * The history import never reports a percentage, so its creep is the only signal
 * the screen has and it may cover most of the band. The other phases go
 * determinate within seconds, so they creep just enough to look alive — creeping
 * further would put the bar somewhere the first real measurement then has to
 * live with, because the bar is never allowed to fall back.
 */
const INDETERMINATE_HEADROOM: Record<FirstDayPreparationPhase, number> = {
  importing: 0.7,
  downloading: 0.12,
  classifying: 0.1,
  ready: 0,
};

export function firstDayPreparationIndeterminateHeadroom(phase: FirstDayPreparationPhase): number {
  return INDETERMINATE_HEADROOM[phase] ?? 0.1;
}

/**
 * The bar never renders emptier than this. A track that sits at a hard zero for
 * the first seconds reads as "nothing is happening" no matter what is running
 * behind it, and the opening seconds are exactly where that doubt starts.
 */
export const FIRST_DAY_PREPARATION_TRACK_FLOOR = 0.035;

/**
 * How long the finished gate holds on "ready" before the dashboard takes over.
 * Long enough to catch the answer it lands on (the check, and the numbers of
 * what was gone through), short enough that nobody experiences it as more
 * waiting; the longest focus is repeated on the first intro card. Owner
 * choice, 2026-10-04. No work is held back for it.
 */
export const FIRST_DAY_PREPARATION_READY_HOLD_MS = 1100;
