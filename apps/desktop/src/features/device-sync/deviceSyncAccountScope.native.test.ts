// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncOutboxSegment } from "@drifty/domain";
import { prepareDeviceSyncAccountScope, suspendDeviceSyncAccountScope } from "./deviceSyncAccountScope";
import { runSyncPushCycle, type DeviceSyncEngineDeps } from "./deviceSyncEngine";

// The actual tracker database behind the account-scope and push-cycle code, so
// the outbox restart is checked against real sync sequences, not a mock cursor.
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const python = String.raw`
import sys,json
from pathlib import Path
from app.storage.db import TrackerDatabase
db=TrackerDatabase(Path(sys.argv[1]))
handlers={
 'getSyncState': db.get_sync_state,
 'setSyncState': lambda entries: {'written':db.set_sync_state(entries)},
 'purgeRemoteSegments': lambda: {'purged':db.purge_remote_segments()},
 'getSyncOutbox': lambda request: db.get_sync_outbox(request['afterSeq'], request['limit'], 0),
 'getPendingSyncDeletions': lambda limit: db.get_pending_sync_deletions(limit),
 'markSyncDeletionsPushed': lambda uids: {'updated':db.mark_sync_deletions_pushed(uids)},
 'insertSegment': lambda segment: db.insert_segment(segment),
}
for line in sys.stdin:
 request=json.loads(line)
 try: print(json.dumps({'id':request['id'],'value':handlers[request['method']](*request['args'])}),flush=True)
 except Exception as error: print(json.dumps({'id':request['id'],'error':str(error)}),flush=True)
db.close()
`;
const guests: { process: ChildProcessWithoutNullStreams; directory: string }[] = [];

type NativeTracker = DeviceSyncEngineDeps["tracker"] & {
  purgeRemoteSegments: () => Promise<{ purged: number }>;
};

async function nativeDevice() {
  const directory = await mkdtemp(join(tmpdir(), "drifty-carried-history-"));
  const child = spawn(process.env.PYTHON ?? "python3", ["-u", "-c", python, join(directory, "tracker.sqlite")], {
    env: { ...process.env, PYTHONPATH: join(repository, "services/tracker-python") }, stdio: "pipe",
  });
  guests.push({ process: child, directory });
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const response = JSON.parse(line) as { id: number; value?: unknown; error?: string };
    const waiter = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) waiter?.reject(new Error(response.error));
    else waiter?.resolve(response.value);
  });
  let stderr = "";
  child.stderr.on("data", (value: Buffer) => { stderr += value.toString(); });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error("Synthetic SQLite RPC exited (" + String(code) + "): " + stderr));
    pending.clear(); lines.close();
  });
  function call<T>(method: string, ...args: unknown[]): Promise<T> {
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      child.stdin.write(JSON.stringify({ id, method, args }) + "\n");
    });
  }
  const tracker: NativeTracker = {
    getSyncState: () => call("getSyncState"),
    setSyncState: (entries) => call("setSyncState", entries),
    purgeRemoteSegments: () => call("purgeRemoteSegments"),
    getSyncOutbox: (request) => call("getSyncOutbox", request),
    getPendingSyncDeletions: (limit) => call("getPendingSyncDeletions", limit),
    markSyncDeletionsPushed: (uids) => call("markSyncDeletionsPushed", uids),
    // Only the push half of a cycle runs here; nothing is pulled.
    applySyncedSegments: async () => { throw new Error("This check does not pull."); },
    applySyncedDeletions: async () => { throw new Error("This check does not pull."); },
  };
  let minute = 0;
  return {
    tracker,
    /** One finished synthetic record, a minute after the previous one. */
    record: async (title: string) => {
      const start = new Date(Date.UTC(2026, 3, 6, 9, minute));
      minute += 1;
      await call("insertSegment", {
        started_at: start.toISOString(),
        ended_at: new Date(start.getTime() + 50_000).toISOString(),
        duration_seconds: 50,
        app_name: "Fixture Editor",
        window_title: title,
        platform: "macos",
        source: "accessibility",
        raw_context_json: "{}",
      });
    },
  };
}

/**
 * One account's cloud copy of this device's records, keyed by segment like the
 * server's upsert, plus what each upload sent.
 */
function cloudAccount(accountId: string, tracker: NativeTracker) {
  const rows = new Map<string, string>();
  const sent: string[] = [];
  const upload = () => runSyncPushCycle({
    tracker,
    syncAccountId: accountId,
    sleep: async () => undefined,
    pushBatch: async (segments: readonly SyncOutboxSegment[]) => {
      for (const segment of segments) {
        rows.set(segment.segmentUid, segment.windowTitle ?? "");
        sent.push(segment.windowTitle ?? "");
      }
      return { deviceId: "device-" + accountId, syncGeneration: 1, acceptedSegments: segments.length, acceptedDeletions: 0, serverTime: new Date().toISOString() };
    },
  }, "manual");
  return { titles: () => [...rows.values()].sort(), sent, upload };
}

afterEach(async () => {
  for (const guest of guests.splice(0)) {
    guest.process.stdin.end();
    if (guest.process.exitCode === null) await new Promise<void>((resolve) => { guest.process.once("exit", () => resolve()); });
    await rm(guest.directory, { recursive: true, force: true });
  }
});

describe("this device's history after an account change, on the actual tracker database", () => {
  it("uploads the whole local history to a new account, including what the previous account received", async () => {
    const device = await nativeDevice();
    await device.record("Draft one");
    await device.record("Draft two");
    await prepareDeviceSyncAccountScope(device.tracker, "account-a");
    const previous = cloudAccount("account-a", device.tracker);
    await previous.upload();
    // Recorded after the last upload to the previous account, e.g. while sync was off.
    await device.record("Draft three");

    await prepareDeviceSyncAccountScope(device.tracker, "account-b");
    const next = cloudAccount("account-b", device.tracker);
    const status = await next.upload();

    expect(previous.titles()).toEqual(["Draft one", "Draft two"]);
    expect(next.titles()).toEqual(["Draft one", "Draft three", "Draft two"]);
    expect(status.pendingPushCount).toBe(0);
  });

  it("replaces rather than duplicates when the device returns to an account that holds its records", async () => {
    const device = await nativeDevice();
    await device.record("Draft one");
    await prepareDeviceSyncAccountScope(device.tracker, "account-a");
    const first = cloudAccount("account-a", device.tracker);
    await first.upload();
    await prepareDeviceSyncAccountScope(device.tracker, "account-b");
    await device.record("Draft two");

    await prepareDeviceSyncAccountScope(device.tracker, "account-a");
    await first.upload();

    expect(first.titles()).toEqual(["Draft one", "Draft two"]);
  });

  it("keeps the cursor for the same account across sign-out and sign-in", async () => {
    const device = await nativeDevice();
    await device.record("Draft one");
    await prepareDeviceSyncAccountScope(device.tracker, "account-a");
    const account = cloudAccount("account-a", device.tracker);
    await account.upload();
    await suspendDeviceSyncAccountScope(device.tracker);
    await device.record("Draft two");

    await prepareDeviceSyncAccountScope(device.tracker, "account-a");
    await account.upload();

    expect(account.sent).toEqual(["Draft one", "Draft two"]);
  });
});
