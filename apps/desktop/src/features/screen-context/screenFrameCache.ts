import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ScreenContextClient } from "./screenContextClient";
import type { ActivityEvidenceSelection } from "./activityEvidenceSelection";
import { decodeScreenDetail } from "./screenContextWire";

/** A screen's image as read for a replay: its data URL, null when no image was kept, or failed. */
export type ScreenFrame = { readonly url: string | null; readonly failed: boolean };

const BUDGET_CHARACTERS = 32_000_000;
const CONCURRENT_READS = 2;

/**
 * Reads the images of one replay ahead of time, most wanted first, two at a time, and keeps the
 * most recent ones within a memory budget. Everything belongs to the account generation it was
 * read under; a changed or expired account connection hides and drops it.
 */
export class ScreenFrameCache {
  private readonly entries = new Map<string, ScreenFrame>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private queue: string[] = [];
  private active = 0;
  private characters = 0;
  private version = 0;
  private disposed = false;
  private generation: number;

  constructor(private readonly client: ScreenContextClient, private readonly selection?: ActivityEvidenceSelection) {
    this.generation = client.getSnapshot().generation;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getVersion = (): number => this.version;

  /** The generation the cached screens were read under; displaying them requires canDisplay(). */
  displayGeneration(): number {
    this.syncGeneration();
    return this.generation;
  }

  /** A screen already read, or undefined while it is not (or may no longer be shown). */
  get(id: string): ScreenFrame | undefined {
    this.syncGeneration();
    if (!this.client.canDisplay(this.generation)) return undefined;
    return this.entries.get(id);
  }

  /** Asks for screens, most wanted first; replaces earlier asks that have not started. */
  want(ids: readonly string[]): void {
    if (this.disposed) return;
    this.syncGeneration();
    this.queue = [...new Set(ids)].filter((id) => !this.entries.has(id) && !this.pending.has(id));
    this.pump();
  }

  /** Starts (or restarts, after a development remount) taking asks. */
  activate(): void {
    this.disposed = false;
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.entries.clear();
    this.characters = 0;
  }

  private syncGeneration(): void {
    const current = this.client.getSnapshot().generation;
    if (current === this.generation) return;
    this.generation = current;
    this.entries.clear();
    this.characters = 0;
    this.queue = [];
  }

  private pump(): void {
    while (!this.disposed && this.active < CONCURRENT_READS && this.queue.length > 0) {
      const id = this.queue.shift();
      if (id !== undefined) void this.load(id);
    }
  }

  private async load(id: string): Promise<void> {
    const generation = this.generation;
    this.pending.add(id);
    this.active += 1;
    try {
      await this.client.consume("screen_context_read_evidence", { recordId: id, includeFrame: true, ...this.selection }, decodeScreenDetail, (value, readGeneration) => {
        if (readGeneration === this.generation) this.store(id, { url: value?.frameUrl ?? null, failed: false });
      });
    } catch {
      if (generation === this.generation) this.store(id, { url: null, failed: true });
    } finally {
      this.pending.delete(id);
      this.active -= 1;
      this.pump();
    }
  }

  private store(id: string, frame: ScreenFrame): void {
    if (this.disposed) return;
    const prior = this.entries.get(id);
    if (prior) this.characters -= prior.url?.length ?? 0;
    this.entries.delete(id);
    this.entries.set(id, frame);
    this.characters += frame.url?.length ?? 0;
    for (const [key, entry] of this.entries) {
      if (this.characters <= BUDGET_CHARACTERS || key === id) break;
      this.entries.delete(key);
      this.characters -= entry.url?.length ?? 0;
    }
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

/** One frame cache for the life of a replay surface; re-renders as screens arrive. */
export function useScreenFrameCache(client: ScreenContextClient, selection?: ActivityEvidenceSelection): ScreenFrameCache {
  const key = JSON.stringify(selection ?? null);
  const cache = useMemo(() => new ScreenFrameCache(client, JSON.parse(key) ?? undefined), [client, key]);
  useSyncExternalStore(cache.subscribe, cache.getVersion);
  useEffect(() => {
    cache.activate();
    return () => cache.dispose();
  }, [cache]);
  return cache;
}
