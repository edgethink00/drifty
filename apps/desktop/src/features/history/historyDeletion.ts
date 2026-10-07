export type HistoryDeletionResult = {
  readonly refreshFailed: boolean;
};

/** Once the write succeeds, a failed read must never offer another deletion. */
export async function deleteHistorySelection(
  ids: readonly string[],
  actions: {
    readonly deleteRecords: (ids: readonly string[]) => Promise<unknown>;
    readonly onDeleted: (ids: readonly string[]) => void;
    readonly refresh: () => Promise<void>;
  },
): Promise<HistoryDeletionResult> {
  await actions.deleteRecords(ids);
  actions.onDeleted(ids);
  try {
    await actions.refresh();
    return { refreshFailed: false };
  } catch {
    return { refreshFailed: true };
  }
}
