import type { TrackerApi } from "@drifty/domain";
import {
  SYNC_ACCOUNT_ID_KEY,
  SYNC_DELETION_PULL_CURSOR_KEY,
  SYNC_DEVICE_ID_KEY,
  SYNC_GENERATION_KEY,
  SYNC_LAST_PULLED_AT_KEY,
  SYNC_LAST_PUSHED_AT_KEY,
  SYNC_PULL_CURSOR_KEY,
} from "./deviceSyncEngine";
import { SYNC_DEFINITION_LEDGER_KEY } from "./projectRuleSyncEvent";

type DeviceSyncAccountScopeTracker = Pick<
  TrackerApi,
  | "getSyncState"
  | "purgeRemoteSegments"
  | "setSyncState"
>;

let accountScopeQueue: Promise<void> = Promise.resolve();

function serializeAccountScopeChange<T>(operation: () => Promise<T>): Promise<T> {
  const result = accountScopeQueue.then(operation, operation);
  accountScopeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function prepareDeviceSyncAccountScope(
  tracker: DeviceSyncAccountScopeTracker,
  accountId: string,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) throw new Error("Device sync requires an account id.");

  return serializeAccountScopeChange(async () => {
    if (!isCurrent()) return false;
    const snapshot = await tracker.getSyncState();
    if (!isCurrent()) return false;
    if (snapshot.state[SYNC_ACCOUNT_ID_KEY] === normalizedAccountId) return false;

    await tracker.purgeRemoteSegments();
    if (!isCurrent()) return false;
    await tracker.setSyncState({
      [SYNC_ACCOUNT_ID_KEY]: normalizedAccountId,
      // The local sequence is device-global. Preserve its high-water mark so a
      // different account never receives a silent full-history backfill.
      [SYNC_PULL_CURSOR_KEY]: null,
      [SYNC_DELETION_PULL_CURSOR_KEY]: null,
      [SYNC_DEVICE_ID_KEY]: null,
      [SYNC_GENERATION_KEY]: null,
      [SYNC_LAST_PUSHED_AT_KEY]: null,
      [SYNC_LAST_PULLED_AT_KEY]: null,
      // Another account starts from this device's projects and rules as they stand.
      [SYNC_DEFINITION_LEDGER_KEY]: null,
    });
    return true;
  });
}

export async function suspendDeviceSyncAccountScope(
  tracker: DeviceSyncAccountScopeTracker,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await serializeAccountScopeChange(async () => {
    if (!isCurrent()) return;
    await tracker.purgeRemoteSegments();
    if (!isCurrent()) return;
    // Keep account, generation, device, and push cursor metadata. A later
    // sign-in to the same account can repull safely without republishing old
    // local history; another account still goes through the full scope change.
    await tracker.setSyncState({
      [SYNC_PULL_CURSOR_KEY]: null,
      [SYNC_DELETION_PULL_CURSOR_KEY]: null,
      [SYNC_LAST_PULLED_AT_KEY]: null,
    });
  });
}
