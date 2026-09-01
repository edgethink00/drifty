/**
 * Personal intensity scale for Your Agents.
 *
 * Color bands follow this person's recent concurrency, not a global log
 * ladder. The visible Day/Week paints immediately from the current range and
 * any locally locked peak; a 28-day tracker peak lands in the background and
 * never blocks the first paint.
 */
import { useEffect, useMemo, useState } from "react";
import { shiftIsoDate } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import {
  AGENTS_INTENSITY_LOOKBACK_DAYS,
  buildAgentsIntensityBands,
  lockAgentsIntensityPeak,
  type AgentsIntensityBand,
} from "./agentsPageModel";

export const AGENTS_INTENSITY_SCALE_STORAGE_KEY = "drifty.agents.intensityScale.v1";

export type AgentsIntensityScaleState = {
  readonly peak: number;
  readonly lockedOnDay: string;
};

export type AgentsIntensityScale = {
  readonly peak: number;
  readonly bands: readonly AgentsIntensityBand[];
};

export function agentsIntensityLookbackStart(todayDay: string): string {
  return shiftIsoDate(todayDay, -(AGENTS_INTENSITY_LOOKBACK_DAYS - 1));
}

export function agentsIntensityLookbackRange(todayDay: string, startOfDayMinutes = 0): { start: string; end: string } {
  return getLogicalDayRange(agentsIntensityLookbackStart(todayDay), todayDay, startOfDayMinutes);
}

export function readAgentsIntensityScale(storage?: Pick<Storage, "getItem"> | null): AgentsIntensityScaleState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AGENTS_INTENSITY_SCALE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { peak?: unknown; lockedOnDay?: unknown };
    const peak = typeof parsed.peak === "number" && Number.isFinite(parsed.peak)
      ? Math.max(0, Math.floor(parsed.peak))
      : null;
    const lockedOnDay = typeof parsed.lockedOnDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.lockedOnDay)
      ? parsed.lockedOnDay
      : null;
    if (peak === null || lockedOnDay === null) return null;
    return { peak, lockedOnDay };
  } catch {
    return null;
  }
}

export function writeAgentsIntensityScale(
  state: AgentsIntensityScaleState,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  if (!storage) return;
  storage.setItem(AGENTS_INTENSITY_SCALE_STORAGE_KEY, JSON.stringify(state));
}

export function resolveAgentsIntensityScale(args: {
  readonly visiblePeak: number;
  readonly lookbackPeak: number | null;
  readonly stored: AgentsIntensityScaleState | null;
  readonly todayDay: string;
}): AgentsIntensityScaleState {
  const lookbackPeak = args.lookbackPeak ?? 0;
  const observedPeak = Math.max(args.visiblePeak, lookbackPeak);
  const previousLockedOnDay = args.lookbackPeak === null && args.stored
    ? args.todayDay
    : args.stored?.lockedOnDay;
  return lockAgentsIntensityPeak({
    previousPeak: args.stored?.peak ?? 0,
    observedPeak,
    previousLockedOnDay,
    todayDay: args.todayDay,
  });
}

export function agentsIntensityBandsForScale(
  scale: AgentsIntensityScaleState,
  visiblePeak: number,
): readonly AgentsIntensityBand[] {
  if (scale.peak <= 0 && visiblePeak <= 0) return [];
  const overflow = visiblePeak > scale.peak && scale.peak > 0;
  return buildAgentsIntensityBands(Math.max(scale.peak, 1), { overflow });
}

export function useAgentsIntensityScale(args: {
  readonly visiblePeak: number;
  readonly todayDay: string;
  readonly live: boolean;
  readonly startOfDayMinutes?: number;
}): AgentsIntensityScale {
  const { visiblePeak, todayDay, live, startOfDayMinutes = 0 } = args;
  const [stored, setStored] = useState<AgentsIntensityScaleState | null>(() => (
    typeof window === "undefined" ? null : readAgentsIntensityScale(window.localStorage)
  ));
  const [lookbackPeak, setLookbackPeak] = useState<number | null>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void trackerClient.getAgentConcurrencyPeak(agentsIntensityLookbackRange(
      todayDay,
      startOfDayMinutes,
    )).then((payload) => {
      if (cancelled) return;
      if (typeof payload?.peak !== "number" || !Number.isFinite(payload.peak)) return;
      setLookbackPeak(Math.max(0, Math.floor(payload.peak)));
    }).catch(() => {
      // Keep the visible-range / stored lock. A failed lookback must not
      // collapse the personal scale to zero.
    });
    return () => {
      cancelled = true;
    };
  }, [live, startOfDayMinutes, todayDay]);

  const resolved = useMemo(() => resolveAgentsIntensityScale({
    visiblePeak,
    lookbackPeak,
    stored,
    todayDay,
  }), [lookbackPeak, stored, todayDay, visiblePeak]);

  useEffect(() => {
    if (!live) return;
    if (stored?.peak === resolved.peak && stored.lockedOnDay === resolved.lockedOnDay) return;
    setStored(resolved);
    if (typeof window !== "undefined") writeAgentsIntensityScale(resolved, window.localStorage);
  }, [live, resolved, stored]);

  const bands = useMemo(
    () => agentsIntensityBandsForScale(live ? resolved : { peak: visiblePeak, lockedOnDay: todayDay }, visiblePeak),
    [live, resolved, todayDay, visiblePeak],
  );

  return {
    peak: live ? resolved.peak : visiblePeak,
    bands,
  };
}
