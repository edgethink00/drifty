import { useRef } from "react";

/**
 * Hold the last "fresh" value while `stale` is true, then adopt the new value
 * once it settles.
 *
 * Day-to-day navigation moves the dashboard's visible range to the new day
 * immediately, but the day's segments load a beat later — in that gap the
 * range filter yields an empty set, so the breakdown briefly collapses to
 * zeros (0m, 0%, empty bar) before the real data arrives. That empty frame
 * makes the donut/bar tween snap A→empty→B instead of morphing A→B.
 *
 * Wrapping each breakdown input in this hook keeps the PREVIOUS day's populated
 * value on screen during the load, so when the new day's data lands the charts
 * ease straight from the old shape to the new one. A genuinely data-less day is
 * unaffected: once its (empty) segments finish loading, `stale` is false and the
 * real empty value is shown.
 */
export function useStickyDuringLoad<T>(value: T, stale: boolean): T {
  const held = useRef(value);
  if (!stale) held.current = value;
  return held.current;
}
