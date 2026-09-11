import { describe, expect, it } from "vitest";

import {
  createPostHogDailyEventRecorder,
  parsePostHogDailyEventLedger,
  resolvePostHogDailyEventAdmission,
} from "./posthog";

type LedgerStorage = {
  readonly storage: Storage;
  readonly lastWrite: () => string | null;
  readonly writeCount: () => number;
};

function createLedgerStorage(initial: string | null = null): LedgerStorage {
  const values = new Map<string, string>();
  if (initial !== null) values.set("drifty.posthog.dailyEventLedger.v1", initial);
  let writes = 0;
  let last: string | null = initial;
  return {
    lastWrite: () => last,
    writeCount: () => writes,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes += 1;
        last = value;
        values.set(key, value);
      },
    } as unknown as Storage,
  };
}

function alwaysDelivers(): () => Promise<boolean> {
  return async () => true;
}

describe("daily event ledger", () => {
  it("discards a previous day's keys instead of accumulating them", () => {
    const yesterday = JSON.stringify({ date: "2026-09-10", keys: ["a", "b", "c"] });

    expect(parsePostHogDailyEventLedger(yesterday, "2026-09-11")).toEqual({
      date: "2026-09-11",
      keys: [],
    });
  });

  it("keeps today's keys", () => {
    const today = JSON.stringify({ date: "2026-09-11", keys: ["a", "b"] });

    expect(parsePostHogDailyEventLedger(today, "2026-09-11")).toEqual({
      date: "2026-09-11",
      keys: ["a", "b"],
    });
  });

  it("treats unreadable storage as an empty day rather than throwing", () => {
    expect(parsePostHogDailyEventLedger("not json", "2026-09-11").keys).toEqual([]);
    expect(parsePostHogDailyEventLedger("null", "2026-09-11").keys).toEqual([]);
    expect(parsePostHogDailyEventLedger(JSON.stringify({ date: "2026-09-11" }), "2026-09-11").keys).toEqual([]);
    expect(parsePostHogDailyEventLedger(
      JSON.stringify({ date: "2026-09-11", keys: ["ok", 7, null] }),
      "2026-09-11",
    ).keys).toEqual(["ok"]);
  });

  it("admits a new key, suppresses a repeat, and refuses past the ceiling", () => {
    const ledger = { date: "2026-09-11", keys: ["a", "b"] } as const;

    expect(resolvePostHogDailyEventAdmission(ledger, "c", 3)).toBe("send");
    expect(resolvePostHogDailyEventAdmission(ledger, "a", 3)).toBe("already_sent");
    expect(resolvePostHogDailyEventAdmission(ledger, "c", 2)).toBe("ceiling_reached");
    // A repeat is still recognised at the ceiling: suppression must not depend on
    // there being room left.
    expect(resolvePostHogDailyEventAdmission(ledger, "a", 2)).toBe("already_sent");
  });
});

describe("daily event recorder", () => {
  it("sends once per day per key and keeps different keys independent", async () => {
    const record = createPostHogDailyEventRecorder();
    const { storage } = createLedgerStorage();
    let deliveries = 0;
    const deliver = async () => {
      deliveries += 1;
      return true;
    };

    await expect(record({ dedupKey: "surface.dashboard", reportingDate: "2026-09-11", storage, deliver })).resolves.toBe(true);
    await expect(record({ dedupKey: "surface.dashboard", reportingDate: "2026-09-11", storage, deliver })).resolves.toBe(false);
    await expect(record({ dedupKey: "surface.settings", reportingDate: "2026-09-11", storage, deliver })).resolves.toBe(true);

    expect(deliveries).toBe(2);
  });

  it("does not let the stored record grow across days", async () => {
    const { storage, lastWrite } = createLedgerStorage();
    const deliver = alwaysDelivers();

    const day1 = createPostHogDailyEventRecorder();
    await day1({ dedupKey: "a", reportingDate: "2026-09-11", storage, deliver });
    await day1({ dedupKey: "b", reportingDate: "2026-09-11", storage, deliver });
    expect(JSON.parse(lastWrite() ?? "{}")).toEqual({ date: "2026-09-11", keys: ["a", "b"] });

    // A new day, and a new renderer so nothing is remembered in memory.
    const day2 = createPostHogDailyEventRecorder();
    await day2({ dedupKey: "c", reportingDate: "2026-09-12", storage, deliver });

    expect(JSON.parse(lastWrite() ?? "{}")).toEqual({ date: "2026-09-12", keys: ["c"] });
  });

  it("survives a restart by reading the persisted day", async () => {
    const { storage } = createLedgerStorage();
    let deliveries = 0;
    const deliver = async () => {
      deliveries += 1;
      return true;
    };

    await createPostHogDailyEventRecorder()({ dedupKey: "a", reportingDate: "2026-09-11", storage, deliver });
    await createPostHogDailyEventRecorder()({ dedupKey: "a", reportingDate: "2026-09-11", storage, deliver });

    expect(deliveries).toBe(1);
  });

  it("does not burn the day on a failed delivery", async () => {
    const record = createPostHogDailyEventRecorder();
    const { storage, writeCount } = createLedgerStorage();
    let deliveries = 0;
    const deliver = async () => {
      deliveries += 1;
      return deliveries > 1;
    };

    await expect(record({ dedupKey: "a", reportingDate: "2026-09-11", storage, deliver })).resolves.toBe(false);
    expect(writeCount()).toBe(0);
    await expect(record({ dedupKey: "a", reportingDate: "2026-09-11", storage, deliver })).resolves.toBe(true);
    expect(writeCount()).toBe(1);
  });

  it("keeps a key that landed while another delivery was in flight", async () => {
    const record = createPostHogDailyEventRecorder();
    const { storage, lastWrite } = createLedgerStorage();
    let release!: (delivered: boolean) => void;
    const slow = new Promise<boolean>((resolve) => { release = resolve; });

    const first = record({ dedupKey: "slow", reportingDate: "2026-09-11", storage, deliver: () => slow });
    await record({ dedupKey: "fast", reportingDate: "2026-09-11", storage, deliver: alwaysDelivers() });
    release(true);
    await first;

    expect(JSON.parse(lastWrite() ?? "{}").keys).toEqual(["fast", "slow"]);
  });

  it("collapses concurrent callers into one delivery", async () => {
    const record = createPostHogDailyEventRecorder();
    const { storage } = createLedgerStorage();
    let deliveries = 0;
    let release!: (delivered: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { release = resolve; });
    const input = {
      dedupKey: "a",
      reportingDate: "2026-09-11",
      storage,
      deliver: () => {
        deliveries += 1;
        return pending;
      },
    };

    const first = record(input);
    await expect(record(input)).resolves.toBe(false);
    release(true);
    await expect(first).resolves.toBe(true);
    expect(deliveries).toBe(1);
  });

  it("stops sending rather than growing once the ceiling is reached", async () => {
    const record = createPostHogDailyEventRecorder(2);
    const { storage } = createLedgerStorage();
    let deliveries = 0;
    const deliver = async () => {
      deliveries += 1;
      return true;
    };

    await record({ dedupKey: "a", reportingDate: "2026-09-11", storage, deliver });
    await record({ dedupKey: "b", reportingDate: "2026-09-11", storage, deliver });
    await expect(record({ dedupKey: "c", reportingDate: "2026-09-11", storage, deliver })).resolves.toBe(false);

    expect(deliveries).toBe(2);
  });

  it("still works when storage is entirely unavailable", async () => {
    const record = createPostHogDailyEventRecorder();
    let deliveries = 0;
    const deliver = async () => {
      deliveries += 1;
      return true;
    };

    await expect(record({ dedupKey: "a", reportingDate: "2026-09-11", storage: null, deliver })).resolves.toBe(true);
    // Without storage the cap holds for the current renderer only, which is the
    // same compromise `app_active` already accepts.
    await expect(record({ dedupKey: "a", reportingDate: "2026-09-11", storage: null, deliver })).resolves.toBe(false);
    expect(deliveries).toBe(1);
  });
});
