import {
  SYNC_DELETION_PULL_CURSOR_KEY,
  SYNC_GENERATION_KEY,
  SYNC_LAST_PULLED_AT_KEY,
  SYNC_PULL_CURSOR_KEY,
} from "./deviceSyncEngine";

export function buildSyncStateAfterCloudPurge(syncGeneration: number): Record<string, string | null> {
  if (!Number.isSafeInteger(syncGeneration) || syncGeneration < 1) {
    throw new Error("Cloud purge returned an invalid sync generation.");
  }
  return {
    [SYNC_GENERATION_KEY]: String(syncGeneration),
    [SYNC_PULL_CURSOR_KEY]: null,
    [SYNC_DELETION_PULL_CURSOR_KEY]: null,
    [SYNC_LAST_PULLED_AT_KEY]: null,
  };
}
