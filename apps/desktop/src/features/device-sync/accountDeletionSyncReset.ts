import {
  SYNC_CARRIED_PUSH_SEQ_KEY,
  SYNC_DELETION_PULL_CURSOR_KEY,
  SYNC_DEVICE_ID_KEY,
  SYNC_LAST_PULLED_AT_KEY,
  SYNC_LAST_PUSHED_AT_KEY,
  SYNC_PULL_CURSOR_KEY,
  SYNC_PUSH_SEQ_KEY,
} from "./deviceSyncEngine";
import { clearDeviceSyncCycleRecordsForUser } from "./deviceSyncState";

export const ACCOUNT_DELETION_NEUTRAL_SYNC_STATE = {
  [SYNC_PUSH_SEQ_KEY]: "0",
  [SYNC_CARRIED_PUSH_SEQ_KEY]: null,
  [SYNC_PULL_CURSOR_KEY]: null,
  [SYNC_DELETION_PULL_CURSOR_KEY]: null,
  [SYNC_DEVICE_ID_KEY]: null,
  [SYNC_LAST_PUSHED_AT_KEY]: null,
  [SYNC_LAST_PULLED_AT_KEY]: null,
} as const;

type ResetAccountSyncIdentityInput = {
  readonly userScopeKey: string | null;
  readonly quiesce: () => Promise<void>;
  readonly setSyncState: (state: typeof ACCOUNT_DELETION_NEUTRAL_SYNC_STATE) => Promise<unknown>;
};

/**
 * Drains the active cycle before clearing either its pacing record or its
 * durable tracker identity. The order matters: a settling cycle writes its
 * final pacing record and may also have just written tracker cursors.
 */
export async function resetAccountSyncIdentity({
  userScopeKey,
  quiesce,
  setSyncState,
}: ResetAccountSyncIdentityInput): Promise<void> {
  await quiesce();
  if (userScopeKey) clearDeviceSyncCycleRecordsForUser(userScopeKey);
  await setSyncState(ACCOUNT_DELETION_NEUTRAL_SYNC_STATE);
}
