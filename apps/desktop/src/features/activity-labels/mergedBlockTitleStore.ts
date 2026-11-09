import { useEffect, useState } from "react";
import type { MergedBlockTitleCard } from "@drifty/domain";

/*
 * Names made for merged Your Day blocks (weekCardBlocks retitle), kept on this device under the
 * key of the cards they were made from (mergedBlockTitleKey). A changed card set gets a new key,
 * so an old name never covers new cards. The lane notes the blocks still waiting for a name.
 */

export const MERGED_BLOCK_TITLES_STORAGE_KEY = "drifty.mergedBlockTitles.v1";
const CHANGED_EVENT = "drifty:merged-block-titles-changed";
const MAX_ENTRIES = 400;

type Stored = Record<string, { readonly title: string; readonly savedAt: number }>;

function readStored(): Stored {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MERGED_BLOCK_TITLES_STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Stored : {};
  } catch {
    return {};
  }
}

export function readMergedBlockTitles(): ReadonlyMap<string, string> {
  return new Map(Object.entries(readStored()).flatMap(([key, value]) => (typeof value?.title === "string" && value.title ? [[key, value.title] as const] : [])));
}

/** An empty title records that the model's answer was not usable: the block keeps its card name
 *  and is not asked about again. */
export function saveMergedBlockTitle(key: string, title: string, now = Date.now()): void {
  const next = { ...readStored(), [key]: { title, savedAt: now } };
  const kept = Object.entries(next).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(MERGED_BLOCK_TITLES_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* Keep the block's card name. */ }
  pending.delete(key);
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Merged blocks shown without a name of their own yet; whoever makes names reads them here. */
const pending = new Map<string, { readonly day: string; readonly cards: readonly MergedBlockTitleCard[]; readonly apps: readonly string[] }>();

const listeners = new Set<() => void>();

export function noteMergedBlockTitleRequests(day: string, requests: readonly { readonly key: string; readonly cards: readonly MergedBlockTitleCard[]; readonly apps: readonly string[] }[]): void {
  const stored = readStored();
  let added = false;
  for (const request of requests) {
    if (stored[request.key] || pending.has(request.key)) continue;
    pending.set(request.key, { day, cards: request.cards, apps: request.apps });
    added = true;
  }
  if (added) listeners.forEach((listener) => listener());
}

/** Called when a merged block starts waiting for a name; returns the unsubscribe. */
export function subscribeMergedBlockTitleRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function pendingMergedBlockTitleRequests(): ReadonlyMap<string, { readonly day: string; readonly cards: readonly MergedBlockTitleCard[]; readonly apps: readonly string[] }> {
  return pending;
}

/** The stored names, following saves in this and other windows. */
export function useMergedBlockTitles(): ReadonlyMap<string, string> {
  const [titles, setTitles] = useState(readMergedBlockTitles);
  useEffect(() => {
    const sync = () => setTitles(readMergedBlockTitles());
    const onStorage = (event: StorageEvent) => { if (event.key === MERGED_BLOCK_TITLES_STORAGE_KEY) sync(); };
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return titles;
}
