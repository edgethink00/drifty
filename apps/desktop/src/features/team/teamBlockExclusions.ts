/**
 * Blocks a person keeps from their teams (owner decision 2026-11-08): chosen on
 * a Your Day block, kept on this computer only, as the time the block covered
 * when it was chosen. Automatic sharing leaves that time out of everything it
 * sends, so the block's name, time of day and its time in the totals stay home,
 * while the person's own day is unchanged. A block that keeps growing after the
 * choice shares the newer part. An organization admin can turn the choice off
 * for a team; then that team receives the time as before.
 */
import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "drifty.team.excludedBlocks.v1";
const CHANGED_EVENT = "drifty:team-excluded-blocks-changed";
/** Older choices than automatic sharing reaches back are dropped as new ones are made. */
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_RANGES = 2000;

export type TeamExcludedRange = { readonly start: number; readonly end: number };

/** Whether a Your Day block offers "Don't share with team". */
export const TeamBlockExclusionContext = createContext(false);

export function useTeamBlockExclusionAvailable(): boolean {
  return useContext(TeamBlockExclusionContext);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readTeamExcludedRanges(): readonly TeamExcludedRange[] {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const start = typeof item?.start === "number" ? item.start : NaN;
      const end = typeof item?.end === "number" ? item.end : NaN;
      return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
    });
  } catch {
    return [];
  }
}

function write(ranges: readonly TeamExcludedRange[], nowMs: number): void {
  const kept = ranges.filter((range) => range.end >= nowMs - KEEP_MS).slice(-MAX_RANGES);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // A full or blocked store keeps the earlier choices.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

function overlap(range: TeamExcludedRange, start: number, end: number): number {
  return Math.max(0, Math.min(range.end, end) - Math.max(range.start, start));
}

/** A block counts as kept from the team when chosen ranges cover at least half of it. */
export function isTeamRangeExcluded(ranges: readonly TeamExcludedRange[], start: number, end: number): boolean {
  if (!(end > start)) return false;
  const covered = ranges.reduce((sum, range) => sum + overlap(range, start, end), 0);
  return covered * 2 >= end - start;
}

export function setTeamBlocksExcluded(blocks: readonly TeamExcludedRange[], excluded: boolean, nowMs = Date.now()): void {
  const current = readTeamExcludedRanges();
  const rest = current.filter((range) => !blocks.some((block) => overlap(range, block.start, block.end) > 0));
  write(excluded ? [...rest, ...blocks.filter((block) => block.end > block.start)] : rest, nowMs);
}

/** The team's hours with the kept blocks cut out, for automatic sharing. */
export function subtractTeamExcludedRanges<T extends TeamExcludedRange>(spans: readonly T[], excluded: readonly TeamExcludedRange[]): TeamExcludedRange[] {
  let parts: TeamExcludedRange[] = spans.map((span) => ({ start: span.start, end: span.end }));
  for (const cut of excluded) {
    parts = parts.flatMap((part) => {
      if (cut.end <= part.start || cut.start >= part.end) return [part];
      const pieces: TeamExcludedRange[] = [];
      if (cut.start > part.start) pieces.push({ start: part.start, end: cut.start });
      if (cut.end < part.end) pieces.push({ start: cut.end, end: part.end });
      return pieces;
    });
  }
  return parts;
}

/** Whether these blocks are kept from the team, read again when any choice changes. */
export function useTeamBlocksExcluded(blocks: readonly TeamExcludedRange[]): boolean {
  const signature = blocks.map((block) => block.start + "-" + block.end).join(",");
  const read = () => blocks.length > 0 && blocks.every((block) => isTeamRangeExcluded(readTeamExcludedRanges(), block.start, block.end));
  const [excluded, setExcluded] = useState(read);
  useEffect(() => {
    setExcluded(read());
    if (typeof window === "undefined") return undefined;
    const reread = () => setExcluded(read());
    window.addEventListener(CHANGED_EVENT, reread);
    return () => window.removeEventListener(CHANGED_EVENT, reread);
    // The signature stands for the blocks' times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return excluded;
}
