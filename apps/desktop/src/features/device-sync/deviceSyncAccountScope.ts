import type { TrackerApi } from "@drifty/domain";
import {
  SYNC_ACCOUNT_ID_KEY,
  SYNC_CARRIED_PUSH_SEQ_KEY,
  SYNC_DELETION_PULL_CURSOR_KEY,
  SYNC_DEVICE_ID_KEY,
  SYNC_GENERATION_KEY,
  SYNC_LAST_PULLED_AT_KEY,
  SYNC_LAST_PUSHED_AT_KEY,
  SYNC_PULL_CURSOR_KEY,
  SYNC_PUSH_SEQ_KEY,
} from "./deviceSyncEngine";
import { SYNC_DEFINITION_LEDGER_KEY } from "./projectRuleSyncEvent";

type DeviceSyncAccountScopeTracker = Pick<
  TrackerApi,
  | "getSyncState"
  | "purgeRemoteSegments"
  | "setSyncState"
>;

let accountScopeQueue: Promise<void> = Promise.resolve();

/**
 * Local definition writes share the account-transition queue: a dispatched
 * tracker command must settle before another account can clear its ledger.
 * Callers still check their scope between commands to cancel the rest of a pass.
 */
export function withDeviceSyncAccountScope<T>(operation: () => Promise<T>): Promise<T> {
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

  return withDeviceSyncAccountScope(async () => {
    if (!isCurrent()) return false;
    const snapshot = await tracker.getSyncState();
    if (!isCurrent()) return false;
    if (snapshot.state[SYNC_ACCOUNT_ID_KEY] === normalizedAccountId) return false;
    const carriedPushSeq = positiveSeq(snapshot.state[SYNC_PUSH_SEQ_KEY]);

    await tracker.purgeRemoteSegments();
    if (!isCurrent()) return false;
    await tracker.setSyncState({
      [SYNC_ACCOUNT_ID_KEY]: normalizedAccountId,
      // The local sequence is device-global. Preserve its high-water mark so a
      // different account never receives a silent full-history backfill; the
      // carried cursor lets the person choose to send it when turning sync on.
      [SYNC_PULL_CURSOR_KEY]: null,
      [SYNC_DELETION_PULL_CURSOR_KEY]: null,
      [SYNC_DEVICE_ID_KEY]: null,
      [SYNC_GENERATION_KEY]: null,
      [SYNC_LAST_PUSHED_AT_KEY]: null,
      [SYNC_LAST_PULLED_AT_KEY]: null,
      // Another account starts from this device's projects and rules as they stand.
      [SYNC_DEFINITION_LEDGER_KEY]: null,
      [SYNC_CARRIED_PUSH_SEQ_KEY]: carriedPushSeq === null ? null : String(carriedPushSeq),
    });
    return true;
  });
}

/**
 * True when this device's earlier activity went to another account and the
 * given account has not taken it. A device that never pushed has nothing to
 * carry: its first opt-in already uploads all of its history.
 */
export function hasCarriedSyncHistory(state: Readonly<Record<string, string>>, accountId: string): boolean {
  return state[SYNC_ACCOUNT_ID_KEY] === accountId.trim()
    && positiveSeq(state[SYNC_CARRIED_PUSH_SEQ_KEY]) !== null
    && positiveSeq(state[SYNC_PUSH_SEQ_KEY]) !== null;
}

/**
 * The person chose to send this device's earlier activity to the current
 * account: restart the push outbox from the beginning, so the next cycles
 * upload all local history the way a first opt-in does. Uploads are upserts by
 * segment, so anything this account already holds is replaced, not duplicated.
 */
export async function includeCarriedSyncHistory(
  tracker: DeviceSyncAccountScopeTracker,
  accountId: string,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  return withDeviceSyncAccountScope(async () => {
    if (!isCurrent()) return false;
    const snapshot = await tracker.getSyncState();
    if (!isCurrent()) return false;
    if (!hasCarriedSyncHistory(snapshot.state, accountId)) return false;
    await tracker.setSyncState({
      [SYNC_PUSH_SEQ_KEY]: null,
      [SYNC_CARRIED_PUSH_SEQ_KEY]: null,
    });
    return true;
  });
}

function positiveSeq(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function suspendDeviceSyncAccountScope(
  tracker: DeviceSyncAccountScopeTracker,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await withDeviceSyncAccountScope(async () => {
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
