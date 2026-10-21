import { useCallback, useEffect, useState } from "react";

export type TimelineZoomView = "day" | "week";
export type TimelineZoomState = { readonly percent: number; readonly onChange: (percent: number) => void };
export const TIMELINE_ZOOM_DEFAULT = 150;
export const timelineZoomStorageKey = (view: TimelineZoomView): string => `drifty.timelineZoom.${view}.v1`;
/** The offered zooms: quarter steps where most reading happens (100–200%), then 250% and 300%. */
export const TIMELINE_ZOOM_STEPS: readonly number[] = [100, 125, 150, 175, 200, 250, 300];
export const isTimelineZoomPercent = (value: number): boolean => TIMELINE_ZOOM_STEPS.includes(value);

/**
 * A zoom from a link or an earlier build (any 100–300%, such as 160%) shows at its nearest step, the
 * lower one on a tie; anything else is no zoom.
 */
export function nearestTimelineZoomStep(value: number): number | null {
  if (!Number.isFinite(value) || value < 100 || value > 300) return null;
  return TIMELINE_ZOOM_STEPS.reduce((best, step) => Math.abs(step - value) < Math.abs(best - value) ? step : best);
}

export function readTimelineZoomPreference(view: TimelineZoomView): number {
  try {
    const stored = window.localStorage.getItem(timelineZoomStorageKey(view));
    return (stored === null ? null : nearestTimelineZoomStep(Number(stored))) ?? TIMELINE_ZOOM_DEFAULT;
  } catch { return TIMELINE_ZOOM_DEFAULT; }
}

/** Each dashboard remembers its own scale, also following other app windows. */
export function useTimelineZoomPreference(view: TimelineZoomView): TimelineZoomState {
  const [percent, setPercent] = useState(() => readTimelineZoomPreference(view));
  const onChange = useCallback((next: number) => {
    if (!isTimelineZoomPercent(next)) return;
    setPercent(next);
    try { window.localStorage.setItem(timelineZoomStorageKey(view), String(next)); } catch { /* Keep the live choice without storage. */ }
  }, [view]);
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== timelineZoomStorageKey(view) || event.newValue === null) return;
      const next = nearestTimelineZoomStep(Number(event.newValue));
      if (next === null) return;
      setPercent(next);
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, [view]);
  return { percent, onChange };
}
