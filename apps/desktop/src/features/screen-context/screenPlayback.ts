import { useEffect, useRef } from "react";

/** Fast-forward speeds, as Dayflow offers them: 20x shows ten recorded seconds every half second. */
export const SCREEN_PLAYBACK_SPEEDS = [20, 40, 60] as const;
export type ScreenPlaybackSpeed = (typeof SCREEN_PLAYBACK_SPEEDS)[number];
const SPEED_KEY = "drifty.screenReplaySpeed.v1";
const DEFAULT_HOLD_SECONDS = 10;

/** The speed last chosen on this computer; 20x before any choice. */
export function readPlaybackSpeed(): ScreenPlaybackSpeed {
  try {
    const saved = Number(window.localStorage.getItem(SPEED_KEY));
    return SCREEN_PLAYBACK_SPEEDS.find((speed) => speed === saved) ?? SCREEN_PLAYBACK_SPEEDS[0];
  } catch {
    return SCREEN_PLAYBACK_SPEEDS[0];
  }
}

/** The next speed in the cycle, remembered for the next replay. */
export function cyclePlaybackSpeed(speed: ScreenPlaybackSpeed): ScreenPlaybackSpeed {
  const next = SCREEN_PLAYBACK_SPEEDS[(SCREEN_PLAYBACK_SPEEDS.indexOf(speed) + 1) % SCREEN_PLAYBACK_SPEEDS.length];
  try { window.localStorage.setItem(SPEED_KEY, String(next)); } catch { /* the choice lasts this session */ }
  return next;
}

/**
 * Recorded seconds one saved screen stands for: the usual gap between screens. Screens are kept
 * only while an allowed app is in front, so a stretch spent elsewhere plays as a cut to the next
 * screen instead of holding the last one for its whole length.
 */
export function screenHoldSeconds(times: readonly number[]): number {
  const gaps: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const gap = (times[index] - times[index - 1]) / 1000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return DEFAULT_HOLD_SECONDS;
  gaps.sort((a, b) => a - b);
  return Math.min(60, Math.max(1, gaps[Math.floor(gaps.length / 2)]));
}

/** Index of the first time in [startMs, endMs) of an ascending list, or -1. */
export function firstScreenIndexIn(times: readonly number[], startMs: number, endMs: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < startMs) low = middle + 1;
    else high = middle;
  }
  return low < times.length && times[low] < endMs ? low : -1;
}

type TimedLine = { readonly startMs: number; readonly endMs: number; readonly totalSeconds: number };

/**
 * The screen that stands for an activity before it plays: the middle screen of the longest Details
 * line that has screens (a card's title names its largest activity), else the middle screen.
 */
export function posterScreenIndex(times: readonly number[], lines: readonly TimedLine[] = []): number {
  if (times.length === 0) return 0;
  const ranked = lines
    .map((line) => ({ line, first: firstScreenIndexIn(times, line.startMs, line.endMs) }))
    .filter((entry) => entry.first >= 0)
    .sort((a, b) => b.line.totalSeconds - a.line.totalSeconds || a.line.startMs - b.line.startMs);
  const chosen = ranked[0];
  if (!chosen) return Math.floor((times.length - 1) / 2);
  let last = chosen.first;
  while (last + 1 < times.length && times[last + 1] < chosen.line.endMs) last += 1;
  return chosen.first + Math.floor((last - chosen.first) / 2);
}

/**
 * Steps a replay one screen at a time while playing: each screen shows for its recorded seconds
 * divided by the speed. Reaching the last screen stops the replay there.
 */
export function usePlaybackClock({ playing, speed, holdSeconds, index, count, onStep, onEnd }: {
  readonly playing: boolean;
  readonly speed: number;
  readonly holdSeconds: number;
  readonly index: number;
  readonly count: number;
  readonly onStep: (next: number) => void;
  readonly onEnd: () => void;
}): void {
  const stepRef = useRef(onStep);
  const endRef = useRef(onEnd);
  stepRef.current = onStep;
  endRef.current = onEnd;
  useEffect(() => {
    if (!playing || count < 1) return;
    const timer = setTimeout(() => {
      if (index + 1 < count) stepRef.current(index + 1);
      else endRef.current();
    }, Math.max(16, (holdSeconds / speed) * 1000));
    return () => clearTimeout(timer);
  }, [playing, speed, holdSeconds, index, count]);
}
