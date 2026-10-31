import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PendingActivityDeletionEntry = {
  readonly id: number;
  readonly ids: readonly string[];
  /**
   * waiting: hidden from the dashboard with Undo offered; committing: still
   * hidden while the delete and the refresh after it settle; undone: shown
   * again while its notice leaves.
   */
  readonly phase: "waiting" | "committing" | "undone";
};

type Commit = (ids: readonly string[]) => Promise<void>;

export type PendingActivityDeletion = {
  /** Records the dashboard leaves out until their deletion settles. */
  readonly hiddenIds: ReadonlySet<string>;
  /** The deletion whose Undo notice is showing. */
  readonly notice: PendingActivityDeletionEntry | null;
  readonly schedule: (ids: readonly string[]) => void;
  readonly undo: (id: number) => void;
  /** The notice closed: delete for good, or forget an undone deletion. */
  readonly settle: (id: number) => void;
  /** The real delete; bound on every render so it always sees current state. */
  readonly bindCommit: (commit: Commit) => void;
};

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * The "Delete, then Undo" candidate: deleting hides the records at once and
 * waits for the notice to close before the permanent delete runs. A newer
 * deletion, or the page going away, commits a waiting one immediately, so no
 * deletion is left behind; if the commit fails the records come back.
 */
export function usePendingActivityDeletion(): PendingActivityDeletion {
  const [entries, setEntries] = useState<readonly PendingActivityDeletionEntry[]>([]);
  const entriesRef = useRef(entries);
  const nextId = useRef(1);
  const commitRef = useRef<Commit | null>(null);

  const apply = useCallback((next: readonly PendingActivityDeletionEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const commit = useCallback((id: number) => {
    const entry = entriesRef.current.find((candidate) => candidate.id === id);
    if (!entry || entry.phase !== "waiting") return;
    apply(entriesRef.current.map((candidate) => candidate.id === id ? { ...candidate, phase: "committing" } : candidate));
    const done = () => apply(entriesRef.current.filter((candidate) => candidate.id !== id));
    const run = commitRef.current;
    if (!run) {
      done();
      return;
    }
    void run(entry.ids).then(done, done);
  }, [apply]);

  const commitWaiting = useCallback(() => {
    for (const entry of entriesRef.current) {
      if (entry.phase === "waiting") commit(entry.id);
    }
  }, [commit]);

  const schedule = useCallback((ids: readonly string[]) => {
    commitWaiting();
    const id = nextId.current;
    nextId.current += 1;
    apply([
      ...entriesRef.current.filter((entry) => entry.phase !== "undone"),
      { id, ids: [...ids], phase: "waiting" },
    ]);
  }, [apply, commitWaiting]);

  const undo = useCallback((id: number) => {
    if (entriesRef.current.find((entry) => entry.id === id)?.phase !== "waiting") return;
    apply(entriesRef.current.map((entry) => entry.id === id ? { ...entry, phase: "undone" } : entry));
  }, [apply]);

  const settle = useCallback((id: number) => {
    const entry = entriesRef.current.find((candidate) => candidate.id === id);
    if (entry?.phase === "waiting") commit(id);
    else if (entry?.phase === "undone") apply(entriesRef.current.filter((candidate) => candidate.id !== id));
  }, [apply, commit]);

  useEffect(() => {
    window.addEventListener("pagehide", commitWaiting);
    return () => {
      window.removeEventListener("pagehide", commitWaiting);
      commitWaiting();
    };
  }, [commitWaiting]);

  const bindCommit = useCallback((run: Commit) => {
    commitRef.current = run;
  }, []);

  const hiddenIds = useMemo(() => {
    const hidden = entries.filter((entry) => entry.phase !== "undone").flatMap((entry) => entry.ids);
    return hidden.length > 0 ? new Set(hidden) : NO_IDS;
  }, [entries]);
  const notice = useMemo(
    () => [...entries].reverse().find((entry) => entry.phase === "waiting" || entry.phase === "undone") ?? null,
    [entries],
  );

  return useMemo(
    () => ({ hiddenIds, notice, schedule, undo, settle, bindCommit }),
    [bindCommit, hiddenIds, notice, schedule, settle, undo],
  );
}
