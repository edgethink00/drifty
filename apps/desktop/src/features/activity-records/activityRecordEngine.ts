import type { SyncDeletionRecord, TrackerApi } from "@drifty/domain";
import type { AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { toActivityRecordBatch, type ActivityRecordItem } from "./activityRecordPayload";

// Tracker state keys must carry the sync_ prefix; these belong to activity
// records only and are independent of device sync's keys.
export const ACTIVITY_RECORDS_ACCOUNT_KEY = "sync_records_account_id";
export const ACTIVITY_RECORDS_SINCE_KEY = "sync_records_since";
export const ACTIVITY_RECORDS_SEQ_KEY = "sync_records_seq";
export const ACTIVITY_RECORDS_OFF_UNTIL_KEY = "sync_records_capture_off_until";

export const ACTIVITY_RECORDS_BATCH_LIMIT = 500;
export const ACTIVITY_RECORDS_DELETION_LIMIT = 100;
const MAX_CHUNKS_PER_CYCLE = 20;
const CHUNK_YIELD_MS = 250;
// While Drifty's servers have capture off, ask again only this often.
export const ACTIVITY_RECORDS_OFF_RETRY_MS = 6 * 60 * 60 * 1000;

export const CLEARED_ACTIVITY_RECORDS_STATE: Record<string, null> = {
  [ACTIVITY_RECORDS_ACCOUNT_KEY]: null,
  [ACTIVITY_RECORDS_SINCE_KEY]: null,
  [ACTIVITY_RECORDS_SEQ_KEY]: null,
};

export type ActivityRecordDeletionPayload = {
  readonly kind: "uids" | "range";
  readonly segmentUids?: string[];
  readonly rangeStart?: string | null;
  readonly rangeEnd?: string | null;
};

export type ActivityRecordSendResult = { readonly capture: "on" | "off" };

export type ActivityRecordEngineDeps = {
  readonly tracker: Pick<
    TrackerApi,
    "getSyncOutbox" | "getSyncState" | "setSyncState" | "getPendingSyncDeletions" | "markSyncDeletionsPushed"
  >;
  readonly accountId: string;
  readonly send: (batch: {
    readonly records: readonly ActivityRecordItem[];
    readonly deletions: readonly ActivityRecordDeletionPayload[];
  }) => Promise<ActivityRecordSendResult>;
  readonly privacySettings: () => AiPrivacyRequestSettings;
  /** Re-checked before every send: product analytics, connection and account. */
  readonly isAllowed: () => boolean;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
};

export type ActivityRecordCycleResult =
  | { readonly status: "skipped" | "capture_off" | "waiting" }
  | { readonly status: "sent"; readonly records: number; readonly deletions: number };

function parseSeq(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function toDeletionPayload(deletion: SyncDeletionRecord): ActivityRecordDeletionPayload {
  return deletion.kind === "uids"
    ? { kind: "uids", segmentUids: deletion.segmentUids ?? [] }
    : { kind: "range", rangeStart: deletion.rangeStart ?? null, rangeEnd: deletion.rangeEnd ?? null };
}

/**
 * One pass of activity records (product decision 2026-10-26). A computer starts
 * from the moment sending began for the signed-in account and never sends
 * earlier activity; after that it follows the tracker's change feed, so a
 * reclassified or corrected segment is sent again, and forwards the user's own
 * deletions. If Drifty's servers have capture off, the computer forgets where
 * it was and starts from scratch once capture is on, so nothing recorded in
 * between is sent later.
 */
export async function runActivityRecordCycle(deps: ActivityRecordEngineDeps): Promise<ActivityRecordCycleResult> {
  if (!deps.isAllowed()) return { status: "skipped" };
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const snapshot = await deps.tracker.getSyncState();
  const offUntil = Date.parse(snapshot.state[ACTIVITY_RECORDS_OFF_UNTIL_KEY] ?? "");
  if (Number.isFinite(offUntil) && offUntil > now().getTime()) return { status: "waiting" };

  let since = snapshot.state[ACTIVITY_RECORDS_SINCE_KEY];
  let afterSeq = parseSeq(snapshot.state[ACTIVITY_RECORDS_SEQ_KEY]);
  if (snapshot.state[ACTIVITY_RECORDS_ACCOUNT_KEY] !== deps.accountId || !since || Number.isNaN(Date.parse(since))) {
    // A new start: nothing recorded before this moment is ever sent. Ask the
    // server first, with nothing in the request, whether it keeps records.
    since = now().toISOString();
    afterSeq = snapshot.counterSeq;
    if (!deps.isAllowed()) return { status: "skipped" };
    const probe = await deps.send({ records: [], deletions: [] });
    if (probe.capture === "off") return await stopUntilCaptureIsOn(deps, now);
    if (!deps.isAllowed()) return { status: "skipped" };
    await deps.tracker.setSyncState({
      [ACTIVITY_RECORDS_ACCOUNT_KEY]: deps.accountId,
      [ACTIVITY_RECORDS_SINCE_KEY]: since,
      [ACTIVITY_RECORDS_SEQ_KEY]: String(afterSeq),
      [ACTIVITY_RECORDS_OFF_UNTIL_KEY]: null,
    });
  }

  let sentRecords = 0;
  let sentDeletions = 0;
  for (let chunk = 0; chunk < MAX_CHUNKS_PER_CYCLE; chunk += 1) {
    if (!deps.isAllowed()) return { status: "skipped" };
    const outbox = await deps.tracker.getSyncOutbox({ afterSeq, limit: ACTIVITY_RECORDS_BATCH_LIMIT, includeContext: true });
    const deletions = await deps.tracker.getPendingSyncDeletions(ACTIVITY_RECORDS_DELETION_LIMIT, { scope: "records", createdAfter: since });
    if (outbox.items.length === 0 && deletions.length === 0) break;

    const batch = toActivityRecordBatch(outbox.items, since, deps.privacySettings());
    const deletionPayload = deletions.map(toDeletionPayload);
    if (batch.excludedSegmentUids.length > 0) {
      deletionPayload.push({ kind: "uids", segmentUids: batch.excludedSegmentUids });
    }
    if (batch.records.length > 0 || deletionPayload.length > 0) {
      if (!deps.isAllowed()) return { status: "skipped" };
      const result = await deps.send({ records: batch.records, deletions: deletionPayload });
      if (result.capture === "off") return await stopUntilCaptureIsOn(deps, now);
      sentRecords += batch.records.length;
      sentDeletions += deletionPayload.length;
    }
    // The account may have changed while the request was in flight; its
    // cursor must not move this one.
    if (!deps.isAllowed()) return { status: "skipped" };
    if (outbox.items.length > 0) {
      afterSeq = outbox.batchMaxSeq;
      await deps.tracker.setSyncState({ [ACTIVITY_RECORDS_SEQ_KEY]: String(afterSeq) });
    }
    if (deletions.length > 0) {
      await deps.tracker.markSyncDeletionsPushed(deletions.map((deletion) => deletion.deletionUid), { scope: "records" });
    }
    const drained = outbox.items.length < ACTIVITY_RECORDS_BATCH_LIMIT && deletions.length < ACTIVITY_RECORDS_DELETION_LIMIT;
    if (drained) break;
    await sleep(CHUNK_YIELD_MS);
  }
  return { status: "sent", records: sentRecords, deletions: sentDeletions };
}

async function stopUntilCaptureIsOn(deps: ActivityRecordEngineDeps, now: () => Date): Promise<ActivityRecordCycleResult> {
  await deps.tracker.setSyncState({
    ...CLEARED_ACTIVITY_RECORDS_STATE,
    [ACTIVITY_RECORDS_OFF_UNTIL_KEY]: new Date(now().getTime() + ACTIVITY_RECORDS_OFF_RETRY_MS).toISOString(),
  });
  return { status: "capture_off" };
}
