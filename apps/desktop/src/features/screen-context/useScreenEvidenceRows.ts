import { useEffect, useState, useSyncExternalStore } from "react";
import type { ScreenEvidencePage } from "@drifty/domain";
import type { ScreenContextClient } from "./screenContextClient";
import type { ActivityEvidenceSelection } from "./activityEvidenceSelection";
import { decodeScreenPage } from "./screenContextWire";

export type ScreenEvidenceRow = ScreenEvidencePage["records"][number];
export type ScreenEvidenceSource =
  | { readonly kind: "activity"; readonly selection: ActivityEvidenceSelection }
  | { readonly kind: "recent" };
const MAX_PAGES = 12;
const CHANGED = "screen_context_account_changed";

/** Reads every page of row metadata (no frames) under one account generation, oldest first. */
export async function loadScreenEvidenceRows(client: ScreenContextClient, source: ScreenEvidenceSource,
  accept: (rows: ScreenEvidenceRow[], generation: number) => void): Promise<void> {
  const rows: ScreenEvidenceRow[] = [];
  const page: { cursor: ScreenEvidencePage["nextCursor"]; generation: number | null } = { cursor: null, generation: null };
  for (let index = 0; index < MAX_PAGES; index += 1) {
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
    page.cursor = reply.next;
  }
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort((a, b) => a.observedAtMs - b.observedAtMs || a.id.localeCompare(b.id));
  if (page.generation !== null && client.canDisplay(page.generation)) accept(unique, page.generation);
}

/** Row metadata for a source once the account connection is ready; null while unknown. */
export function useScreenEvidenceRows(client: ScreenContextClient, source: ScreenEvidenceSource | null): readonly ScreenEvidenceRow[] | null {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [state, setState] = useState<{ readonly generation: number; readonly rows: ScreenEvidenceRow[] } | null>(null);
  const key = source ? JSON.stringify(source) : null;
  const ready = snapshot.connection === "ready";
  useEffect(() => {
    setState(null);
    if (!source || !ready || !client.isDesktop()) return;
    let alive = true;
    void loadScreenEvidenceRows(client, source, (rows, generation) => { if (alive) setState({ rows, generation }); }).catch(() => undefined);
    return () => { alive = false; };
    // The serialized key stands for the source; a new object with the same selection is the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, ready, snapshot.generation]);
  return state && client.canDisplay(state.generation) ? state.rows : null;
}

