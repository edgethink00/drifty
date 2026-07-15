/**
 * Tween compact breakdown charts FROM the previous period's data on mount.
 *
 * Day and Week render the Breakdown in separate component subtrees, so
 * switching Day↔Week unmounts one and mounts the other — the segment DOM nodes
 * are recreated, not updated, which means a plain CSS `transition` can't ease
 * from the old value (a fresh node has no previous state). We remember the last
 * rendered value per chart at module scope (survives the remount) and replay it
 * from previous→current so the bar and donut morph from the pre-switch data.
 *
 * The bar animates `width` with the Web Animations API — a WAAPI animation
 * overrides the element's inline style, so it wins over React re-renders. The
 * donut can't use that trick (WKWebView animates neither the `d` property via
 * WAAPI nor via CSS transition), so it drives the arc geometry from React state:
 * `useAnimatedDonutRatios` returns interpolating ratios that the component turns
 * into `d`, so React itself paints every frame and nothing fights the attribute.
 */

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const DURATION_MS = 520;
const EASING = "cubic-bezier(0.33, 1, 0.68, 1)";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ── Split bar (width via WAAPI) ────────────────────────────────────────────
const previousBarValues = new Map<string, Map<string, string>>();

export type CompactBarTweenItem = {
  /** Stable identity of the segment (category key). */
  readonly key: string;
  readonly el: Element | null;
  /** Current width value, e.g. "42%". */
  readonly value: string;
};

/**
 * Animate each segment's width from the value it last held (remembered across
 * remounts under `cacheKey`) to its current value. `cacheKey` must be shared by
 * the Day and Week variants of the same bar so they tween into each other.
 */
export function tweenCompactBar(cacheKey: string, items: readonly CompactBarTweenItem[]): void {
  const next = new Map<string, string>();
  for (const item of items) next.set(item.key, item.value);

  if (!prefersReducedMotion()) {
    const previous = previousBarValues.get(cacheKey);
    for (const item of items) {
      const from = previous?.get(item.key);
      if (item.el && from != null && from !== item.value) {
        try {
          item.el.animate([{ width: from }, { width: item.value }], { duration: DURATION_MS, easing: EASING });
        } catch {
          // Fall through: the element already shows the current value.
        }
      }
    }
  }

  previousBarValues.set(cacheKey, next);
}

// ── Donut (arc ratios via React state) ─────────────────────────────────────
const previousDonutRatios = new Map<string, Map<string, number>>();

function ratiosEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other == null || Math.abs(other - value) > 0.0005) return false;
  }
  return true;
}

/**
 * Return arc ratios that interpolate FROM the previous period's donut TO the
 * given `target`, so the ring morphs across the Day↔Week remount instead of
 * snapping. `cacheKey` must be shared by the Day and Week variants of the same
 * donut. The component builds each arc's `d` from the returned ratios, so React
 * paints every animation frame. No-op (returns the target) under reduced motion.
 */
export function useAnimatedDonutRatios(cacheKey: string, target: Map<string, number>): Map<string, number> {
  const [rendered, setRendered] = useState<Map<string, number>>(() => previousDonutRatios.get(cacheKey) ?? target);
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const frameRef = useRef<number | null>(null);

  // Re-run whenever the target ratios change (period switch, day nav, data load).
  const targetSignature = [...target.entries()].map(([key, value]) => `${key}:${value.toFixed(4)}`).join(",");

  useEffect(() => {
    if (
      prefersReducedMotion() ||
      typeof requestAnimationFrame === "undefined" ||
      typeof performance === "undefined" ||
      ratiosEqual(renderedRef.current, target)
    ) {
      previousDonutRatios.set(cacheKey, target);
      setRendered(target);
      return;
    }

    // Animate from whatever is on screen now to the target. The module cache is
    // updated only once the tween COMPLETES: if the component remounts mid-tween
    // (React StrictMode in dev, or a parent reshuffle), the fresh instance still
    // reads the pre-tween ratios and keeps morphing instead of snapping.
    const from = renderedRef.current;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / DURATION_MS);
      const eased = easeOutCubic(progress);
      const next = new Map<string, number>();
      for (const [key, targetValue] of target) {
        const fromValue = from.get(key) ?? targetValue;
        next.set(key, fromValue + (targetValue - fromValue) * eased);
      }
      setRendered(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        previousDonutRatios.set(cacheKey, target);
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
    // renderedRef is read (not a dependency); the tween restarts on target change.
  }, [cacheKey, targetSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  return rendered;
}
