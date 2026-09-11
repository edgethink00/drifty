import { useEffect, useRef, useState } from "react";

import {
  estimateRemainingMs,
  mergeRemainingMs,
  remainingLabel,
  sameRemainingLabel,
  type ProgressSample,
  type RemainingLabel,
} from "./remainingEstimate";

/** Samples kept for the estimate; older reads stop describing the work as it is now. */
const SAMPLE_LIMIT = 6;
/** Countdown refresh. The labels are coarse, so a second is more than enough. */
const TICK_MS = 1_000;
/**
 * Samples closer together than this are dropped. A burst of re-renders can
 * otherwise fill the whole buffer within a few milliseconds and evict the older
 * readings the estimate actually needs.
 */
const MIN_SAMPLE_GAP_MS = 750;

export type UseRemainingEstimateOptions = {
  /** 0..1 completion, or null while nothing is measurable. */
  readonly value: number | null;
  /** False parks the estimate — used while a wait is paused, finished, or off-screen. */
  readonly enabled?: boolean;
  /** Changing this throws away the history; the previous work says nothing about the new one. */
  readonly resetKey?: string;
};

/**
 * Turns a stream of progress readings into a calm remaining-time label.
 *
 * The label counts itself down between readings instead of freezing on the last
 * estimate, so a long gap between measurements still looks like time passing.
 */
export function useRemainingEstimate({
  enabled = true,
  resetKey = "",
  value,
}: UseRemainingEstimateOptions): RemainingLabel | null {
  const samplesRef = useRef<readonly ProgressSample[]>([]);
  const heldRef = useRef<{ readonly at: number; readonly ms: number } | null>(null);
  const completionRef = useRef<number | null>(null);
  const [label, setLabel] = useState<RemainingLabel | null>(null);

  useEffect(() => {
    samplesRef.current = [];
    heldRef.current = null;
    completionRef.current = null;
    setLabel(null);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled || value === null || !Number.isFinite(value)) return;
    const completion = Math.min(1, Math.max(0, value));
    completionRef.current = completion;
    const now = Date.now();
    const previous = samplesRef.current[samplesRef.current.length - 1];
    if (previous && now - previous.at < MIN_SAMPLE_GAP_MS) return;
    const samples = [...samplesRef.current, { at: now, value: completion }]
      .slice(-SAMPLE_LIMIT);
    samplesRef.current = samples;
    const estimate = estimateRemainingMs(samples);
    if (estimate === null) return;
    const held = heldRef.current;
    const projected = held ? Math.max(0, held.ms - (Date.now() - held.at)) : null;
    const merged = mergeRemainingMs(projected, estimate);
    heldRef.current = merged === null ? null : { at: Date.now(), ms: merged };
  }, [enabled, value]);

  useEffect(() => {
    if (!enabled) {
      setLabel(null);
      return;
    }
    const timer = setInterval(() => {
      const held = heldRef.current;
      const next = remainingLabel(
        held ? Math.max(0, held.ms - (Date.now() - held.at)) : null,
        completionRef.current,
      );
      setLabel((current) => (sameRemainingLabel(current, next) ? current : next));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  return label;
}
