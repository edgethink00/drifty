import { useCallback, useEffect, useRef, useState } from "react";

import {
  readTeamBoard,
  readTeamBoards,
  writeTeamBoards,
  type TeamBoardGrid,
  type TeamBoardsState,
  type TeamBoardVisibility,
  type TeamPersonalBoard,
} from "./teamBoardModel";
import type { TeamServerBoard } from "./teamSharingService";
import type { TeamResult } from "./teamTypes";

/** The server's board calls for one organization, so tests can stand in for them. */
export type TeamBoardsRemote = {
  readonly load: () => Promise<TeamResult<readonly TeamServerBoard[]>>;
  readonly save: (board: {
    readonly dashboard_id: string | null;
    readonly name: string | null;
    readonly seq: number;
    readonly visibility: TeamBoardVisibility;
    readonly grid: string;
    readonly items: readonly unknown[];
  }) => Promise<TeamResult<{ readonly dashboard_id: string } | null>>;
  readonly remove: (dashboardId: string) => Promise<TeamResult<unknown>>;
};

/** Another leader's board they show to the leaders (owner decision 2026-10-20): it opens to read and to copy. */
export type TeamSharedBoard = TeamPersonalBoard & { readonly ownerMemberKey: string };

/** "error": a change has not reached the server yet; it stays on this device and goes with the next try. */
export type TeamBoardsSync = "idle" | "loading" | "saving" | "error";

export type TeamBoardsStore = {
  readonly state: TeamBoardsState;
  readonly shared: readonly TeamSharedBoard[];
  readonly save: (next: TeamBoardsState) => void;
  readonly sync: TeamBoardsSync;
  readonly retry: () => void;
};

const SAVE_DELAY_MS = 500;

type SyncedBoard = { readonly serverId: string; readonly saved: string };

function fingerprint(board: TeamPersonalBoard, gridId: string): string {
  return JSON.stringify([board.name, board.seq, board.visibility, gridId, board.items]);
}

/**
 * A leader's boards. In the preview they stay on this device; for a live team
 * the server keeps them (owner decision 2026-10-20, as Rize keeps dashboards
 * with the account) and this device keeps a copy to open with. Changes show at
 * once and reach the server shortly after, one at a time. A board keeps the id
 * the screen gave it and the server's id is kept beside it, so Undo, renaming
 * and the open tab are undisturbed when a new board is first saved.
 */
export function useTeamBoardsStore(storageKey: string, grid: TeamBoardGrid, remote: TeamBoardsRemote | null): TeamBoardsStore {
  const [state, setState] = useState<TeamBoardsState>(() => readTeamBoards(storageKey, grid));
  const [shared, setShared] = useState<readonly TeamSharedBoard[]>([]);
  const [sync, setSync] = useState<TeamBoardsSync>(remote ? "loading" : "idle");
  const stateRef = useRef(state);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const hasRemote = remote !== null;
  /** Each board saved on the server, by the id the screen uses. */
  const syncedRef = useRef(new Map<string, SyncedBoard>());
  const loadedRef = useRef(false);
  const flushingRef = useRef(false);
  const againRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped when the organization changes, so answers for the one before are dropped. */
  const generationRef = useRef(0);

  const apply = useCallback((next: TeamBoardsState) => {
    stateRef.current = next;
    setState(next);
    writeTeamBoards(storageKey, next);
  }, [storageKey]);

  const flush = useCallback(async () => {
    const server = remoteRef.current;
    if (!server || !loadedRef.current) return;
    if (flushingRef.current) {
      againRef.current = true;
      return;
    }
    const generation = generationRef.current;
    flushingRef.current = true;
    setSync("saving");
    let failed = false;
    do {
      againRef.current = false;
      const current = stateRef.current;
      const present = new Set(current.boards.map((board) => board.id));
      for (const [id, entry] of [...syncedRef.current.entries()]) {
        if (present.has(id)) continue;
        const removed = await server.remove(entry.serverId);
        if (generation !== generationRef.current) return;
        if (removed.success) syncedRef.current.delete(id);
        else failed = true;
      }
      for (const board of current.boards) {
        const saved = fingerprint(board, gridRef.current.id);
        const entry = syncedRef.current.get(board.id);
        if (entry && entry.saved === saved) continue;
        const result = await server.save({
          dashboard_id: entry?.serverId ?? null,
          name: board.name,
          seq: board.seq,
          visibility: board.visibility,
          grid: gridRef.current.id,
          items: board.items,
        });
        if (generation !== generationRef.current) return;
        if (result.success && result.data && result.data.dashboard_id) syncedRef.current.set(board.id, { serverId: result.data.dashboard_id, saved });
        else failed = true;
      }
    } while (againRef.current && !failed);
    flushingRef.current = false;
    setSync(failed ? "error" : "idle");
  }, []);

  const load = useCallback(async () => {
    const server = remoteRef.current;
    if (!server) return;
    const generation = generationRef.current;
    setSync("loading");
    const result = await server.load();
    if (generation !== generationRef.current) return;
    if (!result.success) {
      setSync("error");
      return;
    }
    const synced = new Map<string, SyncedBoard>();
    const own: TeamPersonalBoard[] = [];
    const others: TeamSharedBoard[] = [];
    for (const row of result.data) {
      const board = readTeamBoard({ id: row.dashboard_id, seq: row.seq, name: row.name, visibility: row.visibility, items: row.items }, gridRef.current);
      if (!board) continue;
      if (row.is_own) {
        own.push(board);
        synced.set(board.id, { serverId: row.dashboard_id, saved: fingerprint(board, gridRef.current.id) });
      } else if (row.visibility === "leaders") {
        others.push({ ...board, ownerMemberKey: row.owner_member_key });
      }
    }
    // A board made here that never reached the server (say, while offline) is kept and saved now.
    const unsaved = stateRef.current.boards.filter((board) => board.id.startsWith("board-") && !synced.has(board.id));
    const boards = [...own, ...unsaved];
    const cachedActive = stateRef.current.active;
    const known = (id: string) => boards.some((board) => board.id === id) || others.some((board) => board.id === id);
    syncedRef.current = synced;
    loadedRef.current = true;
    setShared(others);
    apply({ boards, active: cachedActive && known(cachedActive) ? cachedActive : null });
    setSync("idle");
    if (unsaved.length > 0) void flush();
  }, [apply, flush]);

  useEffect(() => {
    generationRef.current += 1;
    loadedRef.current = false;
    flushingRef.current = false;
    againRef.current = false;
    syncedRef.current = new Map();
    const cached = readTeamBoards(storageKey, gridRef.current);
    stateRef.current = cached;
    setState(cached);
    setShared([]);
    if (hasRemote) void load();
    else setSync("idle");
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [hasRemote, load, storageKey]);

  const save = useCallback((next: TeamBoardsState) => {
    apply(next);
    if (!remoteRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, SAVE_DELAY_MS);
  }, [apply, flush]);

  const retry = useCallback(() => {
    if (!remoteRef.current) return;
    if (loadedRef.current) void flush();
    else void load();
  }, [flush, load]);

  return { state, shared, save, sync, retry };
}
