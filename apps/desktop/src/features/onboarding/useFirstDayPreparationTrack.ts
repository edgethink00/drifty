import { useEffect, useRef, useState } from "react";

import { useRemainingEstimate } from "../loading/useRemainingEstimate";
import type { RemainingLabel } from "../loading/remainingEstimate";
import {
  firstDayPreparationBand,
  firstDayPreparationIndeterminateHeadroom,
  firstDayPreparationTrackValue,
  FIRST_DAY_PREPARATION_TRACK_FLOOR,
  normalizeFirstDayPreparationPlan,
  type FirstDayPreparationPhase,
  type FirstDayPreparationPlan,
} from "./firstDayPreparationProgress";

/** How often the bar is nudged forward between real measurements. */
const TICK_MS = 320;
/** Share of the gap to the ceiling closed per tick — a decelerating creep. */
const TRICKLE_EASE = 0.075;
/**
 * How far into the *next* step the creep may reach. Staying under 1 keeps the
 * bar from arriving before the work it represents.
 */
const TRICKLE_STEP_SHARE = 0.85;
/** Assumed step size before a real one has been observed, as a share of the band. */
const DEFAULT_STEP_SHARE = 0.08;
/** Weight of the newest observed step when smoothing the step size. */
const STEP_SMOOTHING = 0.6;
/** After this long the gate admits the wait is unusual and explains itself. */
export const FIRST_DAY_PREPARATION_LONG_WAIT_MS = 25_000;

export type UseFirstDayPreparationTrackOptions = {
  readonly phase: FirstDayPreparationPhase;
  readonly plan: FirstDayPreparationPlan;
  /** 0..1 for the current phase, or null while the phase has no measurable progress. */
  readonly progress: number | null;
};

export type FirstDayPreparationTrack = {
  /** Whole-run percentage, rounded, and never lower than the last value shown. */
  readonly percent: number;
  /** True when the percentage reflects a real measurement worth printing. */
  readonly determinate: boolean;
  /** Coarse remaining-time bucket for the closing phase, when it can be trusted. */
  readonly remaining: RemainingLabel | null;
  /** True once the wait has run long enough to deserve an explanation. */
  readonly longWait: boolean;
};

/**
 * Drives the gate's single loading track.
 *
 * Three rules do the perceived-progress work: the value never moves backwards,
 * it keeps creeping between measurements so a slow batch never looks like a
 * hang, and the creep is bounded by where the in-flight step will actually land
 * so the bar cannot outrun the work.
 */
export function useFirstDayPreparationTrack({
  phase,
  plan,
  progress,
}: UseFirstDayPreparationTrackOptions): FirstDayPreparationTrack {
  // Phases the run has actually entered. The declared plan is a prediction, and
  // the gate can enter a phase it did not predict (a managed-model warmup after
  // a Cloud-looking start), so the banding follows the union of both.
  const seenRef = useRef<readonly FirstDayPreparationPhase[]>([]);
  if (phase !== "ready" && !seenRef.current.includes(phase)) {
    seenRef.current = [...seenRef.current, phase];
  }
  // Both are folds over at most three phases, so they are computed straight
  // through. Memoising them bought nothing and made a reader work out whether
  // the deps caught a ref that is reassigned during render.
  const steps = normalizeFirstDayPreparationPlan([...plan, ...seenRef.current], phase);
  const band = firstDayPreparationBand(steps, phase);
  const measured = phase === "ready" || (progress !== null && Number.isFinite(progress));
  const target = firstDayPreparationTrackValue(steps, phase, progress);
  const isClosingPhase = steps[steps.length - 1] === phase;

  const displayedRef = useRef(Math.max(target, FIRST_DAY_PREPARATION_TRACK_FLOOR));
  const lastTargetRef = useRef(target);
  const stepRef = useRef<number | null>(null);
  const ceilingRef = useRef(displayedRef.current);

  const [percent, setPercent] = useState(() => Math.round(displayedRef.current * 100));
  const [longWait, setLongWait] = useState(false);

  // Remaining-time read for the closing phase only: finishing a model download
  // says nothing about how long the classification after it will take. A phase
  // change resets the history for the same reason.
  const remaining = useRemainingEstimate({
    enabled: isClosingPhase && phase !== "ready",
    resetKey: phase,
    value: measured ? progress ?? null : null,
  });

  // The creep learns its step size per phase for the same reason.
  useEffect(() => {
    stepRef.current = null;
  }, [phase]);

  useEffect(() => {
    const timer = setTimeout(() => setLongWait(true), FIRST_DAY_PREPARATION_LONG_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Pull the bar up to every real measurement, and learn the step size so the
  // creep between measurements stays inside the work that is actually running.
  useEffect(() => {
    if (target > lastTargetRef.current) {
      const step = target - lastTargetRef.current;
      stepRef.current = stepRef.current === null
        ? step
        : stepRef.current * (1 - STEP_SMOOTHING) + step * STEP_SMOOTHING;
      lastTargetRef.current = target;
    }
    if (target > displayedRef.current) {
      displayedRef.current = target;
      setPercent((current) => Math.max(current, Math.round(target * 100)));
    }
  }, [target]);

  useEffect(() => {
    if (phase === "ready") {
      displayedRef.current = 1;
      setPercent(100);
      return;
    }
    const timer = setInterval(() => {
      const ceiling = ceilingRef.current;
      if (ceiling > displayedRef.current) {
        const next = displayedRef.current + (ceiling - displayedRef.current) * TRICKLE_EASE;
        displayedRef.current = next;
        const nextPercent = Math.round(next * 100);
        setPercent((current) => (nextPercent > current ? nextPercent : current));
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  const width = band.end - band.start;
  const ceiling = measured
    ? Math.min(band.end - 0.004, target + (stepRef.current ?? width * DEFAULT_STEP_SHARE) * TRICKLE_STEP_SHARE)
    : band.start + width * firstDayPreparationIndeterminateHeadroom(phase);
  ceilingRef.current = phase === "ready"
    ? 1
    : Math.max(target, ceiling, FIRST_DAY_PREPARATION_TRACK_FLOOR);

  return {
    percent: phase === "ready" ? 100 : Math.min(100, percent),
    determinate: measured,
    remaining,
    longWait,
  };
}
