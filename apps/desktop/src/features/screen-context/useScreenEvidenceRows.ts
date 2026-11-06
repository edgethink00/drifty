import { useEffect, useState, useSyncExternalStore } from "react";
import type { ScreenEvidencePage } from "@drifty/domain";
import type { ScreenContextClient } from "./screenContextClient";
import type { ActivityEvidenceSelection } from "./activityEvidenceSelection";
import { decodeScreenDetail, decodeScreenPage, decodeScreenStatus } from "./screenContextWire";

export type ScreenEvidenceRow = ScreenEvidencePage["records"][number];
export type ScreenEvidenceSource =
  | { readonly kind: "activity"; readonly selection: ActivityEvidenceSelection }
  | { readonly kind: "recent" }
  | { readonly kind: "evidence"; readonly recordId: string };
const MAX_PAGES = 12;
// An activity replays every screen it kept: up to 60 pages of 20 cover 3h20m at the 10-second
// interval, longer than one timeline card (three hours).
const MAX_ACTIVITY_PAGES = 60;
const CHANGED = "screen_context_account_changed";
const REMEMBERED_SOURCES = 32;

type Remembered = { readonly generation: number; readonly rows: readonly ScreenEvidenceRow[] };
/**
 * The row lists (times and ids, no screens or text) read in this window, so an activity opened
 * again shows its screens at once. Each belongs to the account generation it was read under, like
 * the frame cache: a changed or expired connection, or a deletion, hides and drops them.
 */
const remembered = new WeakMap<ScreenContextClient, Map<string, Remembered>>();

function remember(client: ScreenContextClient, key: string, rows: readonly ScreenEvidenceRow[], generation: number): void {
  const memory = remembered.get(client) ?? new Map<string, Remembered>();
  remembered.set(client, memory);
  for (const [prior, entry] of memory) if (entry.generation !== generation) memory.delete(prior);
  memory.delete(key);
  memory.set(key, { generation, rows });
  for (const oldest of memory.keys()) {
    if (memory.size <= REMEMBERED_SOURCES) break;
    memory.delete(oldest);
  }
}

/** A source's rows from an earlier read, while they may still be shown; screens past their expiry are left out. */
export function recallScreenEvidenceRows(client: ScreenContextClient, source: ScreenEvidenceSource): readonly ScreenEvidenceRow[] | null {
  const memory = remembered.get(client);
  const key = JSON.stringify(source);
  const entry = memory?.get(key);
  if (!memory || !entry) return null;
  if (!client.isCurrent(entry.generation)) {
    memory.delete(key);
    return null;
  }
  if (!client.canDisplay(entry.generation)) return null;
  const now = Date.now();
  if (!entry.rows.some((row) => row.expiresAtMs <= now)) return entry.rows;
  // Kept, so every render until the next read gets the same list.
  const rows = entry.rows.filter((row) => row.expiresAtMs > now);
  memory.set(key, { generation: entry.generation, rows });
  return rows;
}

/**
 * Reads the pages of row metadata (no frames) under one account generation, oldest first. When more
 * pages follow the first, `first` hears that page at once, so a replay can take its place early.
 */
export async function loadScreenEvidenceRows(client: ScreenContextClient, source: ScreenEvidenceSource,
  accept: (rows: ScreenEvidenceRow[], generation: number) => void,
  first?: (rows: ScreenEvidenceRow[], generation: number) => void): Promise<void> {
  if (source.kind === "evidence") {
    // A citation names one original. Never substitute a nearby saved screen.
    await client.consume("screen_context_read_evidence", { recordId: source.recordId, includeFrame: false }, decodeScreenDetail, (value, generation) => {
      if (!value || value.id !== source.recordId) throw new Error("screen_context_unavailable");
      accept([{ id: value.id, observedAtMs: value.observedAtMs, expiresAtMs: value.expiresAtMs,
        textSource: value.textEvidence.source, textState: value.textEvidence.state, frameRetained: false }], generation);
    });
    return;
  }
  const rows: ScreenEvidenceRow[] = [];
  const page: { cursor: ScreenEvidencePage["nextCursor"]; generation: number | null } = { cursor: null, generation: null };
  const pages = source.kind === "activity" ? MAX_ACTIVITY_PAGES : MAX_PAGES;
  const ordered = () => [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort((a, b) => a.observedAtMs - b.observedAtMs || a.id.localeCompare(b.id));
  for (let index = 0; index < pages; index += 1) {
    const reply: { next: ScreenEvidencePage["nextCursor"]; generation: number } = { next: null, generation: -1 };
    const command = source.kind === "activity" ? "screen_context_list_activity_evidence" : "screen_context_list_evidence";
    const args = source.kind === "activity"
      ? { recordIds: source.selection.recordIds, windows: source.selection.windows, cursor: page.cursor }
      : { cursor: page.cursor };
    await client.consume(command, args, decodeScreenPage, (value, generation) => {
      rows.push(...value.records); reply.next = value.nextCursor; reply.generation = generation;
    });
    if (page.generation === null) page.generation = reply.generation;
    else if (page.generation !== reply.generation) throw new Error(CHANGED);
    if (!reply.next) break;
    if (index === 0 && first && client.canDisplay(reply.generation)) first(ordered(), reply.generation);
    page.cursor = reply.next;
  }
  const unique = ordered();
  if (page.generation !== null && client.canDisplay(page.generation)) {
    remember(client, JSON.stringify(source), unique, page.generation);
    accept(unique, page.generation);
  }
}

/**
 * What is known of a source's saved screens: still asking, its first page while the rest is read,
 * or all of them. `remembered` marks rows from an earlier read, shown before they are read again.
 */
export type ScreenEvidenceRowsView =
  | { readonly status: "loading" }
  | { readonly status: "partial"; readonly rows: readonly ScreenEvidenceRow[] }
  | { readonly status: "complete"; readonly rows: readonly ScreenEvidenceRow[]; readonly remembered: boolean };

type Loaded = {
  readonly key: string;
  readonly generation: number;
  readonly rows: readonly ScreenEvidenceRow[];
  readonly complete: boolean;
  readonly remembered: boolean;
};

function sameRows(a: readonly ScreenEvidenceRow[], b: readonly ScreenEvidenceRow[]): boolean {
  return a.length === b.length && a.every((row, index) => row.id === b[index].id && row.frameRetained === b[index].frameRetained
    && row.expiresAtMs === b[index].expiresAtMs && row.textState === b[index].textState);
}

/**
 * Row metadata for a source once the account connection is ready, or null when there is nothing to
 * ask (no source, no desktop connection, or the read failed). Rows read earlier show at once and are
 * read again behind them.
 */
export function useScreenEvidenceRows(client: ScreenContextClient, source: ScreenEvidenceSource | null): ScreenEvidenceRowsView | null {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [state, setState] = useState<Loaded | null>(null);
  const key = source ? JSON.stringify(source) : null;
  const ready = snapshot.connection === "ready";
  // The inline replay owns its native visibility watch. Settings or an upgrade
  // notice need not be mounted to keep the five-second watch alive. Native
  // validation still revokes deleted/replaced activity; a failed renewal also
  // clears this generation instead of retaining a screen without a live watch.
  useEffect(() => {
    if (!source || !ready || !client.isDesktop()) return;
    let active = true; let inFlight = false;
    const generation = snapshot.generation;
    const timer = setInterval(() => {
      if (!active || inFlight || !client.canDisplay(generation)) return;
      inFlight = true;
      void client.consume("screen_context_get_status", {}, decodeScreenStatus, () => {}).catch(() => {
        if (active && client.isCurrent(generation)) client.invalidate();
      }).finally(() => { inFlight = false; });
    }, 2000);
    return () => { active = false; clearInterval(timer); };
    // The serialized key identifies the selected source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, ready, snapshot.generation]);
  useEffect(() => {
    if (!source || !key || !ready || !client.isDesktop()) return;
    let alive = true;
    const known = recallScreenEvidenceRows(client, source);
    void loadScreenEvidenceRows(client, source, (rows, generation) => {
      if (alive) setState({ key, generation, rows: known && sameRows(known, rows) ? known : rows, complete: true, remembered: known !== null });
    }, (rows, generation) => {
      if (alive && !known) setState({ key, generation, rows, complete: false, remembered: false });
    }).catch(() => {
      if (alive) setState({ key, generation: client.getSnapshot().generation, rows: [], complete: true, remembered: false });
    });
    return () => { alive = false; };
    // The serialized key stands for the source; a new object with the same selection is the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, ready, snapshot.generation]);
  if (!source || !key || !client.isDesktop()) return null;
  if (state && state.key === key && client.isCurrent(state.generation)) {
    if (state.complete && state.rows.length === 0) return { status: "complete", rows: state.rows, remembered: state.remembered };
    if (client.canDisplay(state.generation)) {
      return state.complete ? { status: "complete", rows: state.rows, remembered: state.remembered } : { status: "partial", rows: state.rows };
    }
  }
  const known = ready ? recallScreenEvidenceRows(client, source) : null;
  if (known) return { status: "complete", rows: known, remembered: true };
  return snapshot.connection === "ready" || snapshot.connection === "binding" ? { status: "loading" } : null;
}
