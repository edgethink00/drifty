import type { SyncDeletionRecord, SyncOutboxPage, SyncOutboxQuery, SyncOutboxSegment, SyncStateSnapshot } from "@drifty/domain";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, type AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import {
  ACTIVITY_RECORDS_ACCOUNT_KEY,
  ACTIVITY_RECORDS_OFF_UNTIL_KEY,
  ACTIVITY_RECORDS_SEQ_KEY,
  ACTIVITY_RECORDS_SINCE_KEY,
  runActivityRecordCycle,
  type ActivityRecordDeletionPayload,
  type ActivityRecordEngineDeps,
} from "./activityRecordEngine";
import { toActivityRecordBatch, type ActivityRecordItem } from "./activityRecordPayload";
import { activityRecordsGate } from "./useActivityRecords";
import { toMinimizedPayload } from "../classification/aiClassificationService";
import type { ActivitySegment } from "@drifty/domain";

const NOW = new Date("2026-10-26T03:00:00.000Z");
const ENROLLED = "2026-10-26T01:00:00.000Z";
const EMPTY_MEMORY_CONTEXT = { soul: null, episodeByItemId: {} };

function segment(seq: number, overrides: Partial<SyncOutboxSegment> = {}): SyncOutboxSegment {
  return {
    segmentUid: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    startedAt: "2026-10-26T02:00:00.000Z",
    endedAt: "2026-10-26T02:05:00.000Z",
    durationSeconds: 300,
    appName: "Safari",
    bundleId: "com.apple.Safari",
    windowTitle: "Rust ownership - YouTube",
    siteDomain: "www.youtube.com",
    siteTitle: null,
    siteUrl: "https://www.youtube.com/watch?v=abc&t=10",
    browserName: "Safari",
    platform: "macos",
    source: "accessibility",
    syncSeq: seq,
    classification: { category: "learning", productivity: "focus", source: "youtube", confidence: 0.9, classifiedAt: "2026-10-26T02:06:00.000Z" },
    youtubeTitle: "Rust ownership",
    youtubeChannelName: "Teacher",
    youtubeCategory: "Education",
    ...overrides,
  };
}

class FakeTracker {
  state: Record<string, string> = {};
  counterSeq = 0;
  items: SyncOutboxSegment[] = [];
  deletions: (SyncDeletionRecord & { recordsPushed?: boolean })[] = [];
  outboxQueries: SyncOutboxQuery[] = [];
  deletionQueries: unknown[] = [];

  getSyncState = vi.fn(async (): Promise<SyncStateSnapshot> => ({ state: { ...this.state }, counterSeq: this.counterSeq, pendingDeletions: 0 }));
  setSyncState = vi.fn(async (entries: Record<string, string | null>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === null) delete this.state[key];
      else this.state[key] = value;
    }
    return { written: Object.keys(entries).length };
  });
  getSyncOutbox = vi.fn(async (query: SyncOutboxQuery): Promise<SyncOutboxPage> => {
    this.outboxQueries.push(query);
    const items = this.items.filter((item) => item.syncSeq > query.afterSeq).slice(0, query.limit ?? 500);
    return { items, batchMaxSeq: Math.max(query.afterSeq, ...items.map((item) => item.syncSeq)), counterSeq: this.counterSeq, pendingCount: items.length };
  });
  getPendingSyncDeletions = vi.fn(async (limit?: number, options?: { scope?: string; createdAfter?: string }) => {
    this.deletionQueries.push({ limit, ...options });
    return this.deletions.filter((item) => !item.recordsPushed && options?.createdAfter && item.createdAt >= options.createdAfter);
  });
  markSyncDeletionsPushed = vi.fn(async (uids: readonly string[], options?: { scope?: string }) => {
    expect(options).toEqual({ scope: "records" });
    for (const item of this.deletions) if (uids.includes(item.deletionUid)) item.recordsPushed = true;
    return { marked: uids.length };
  });
}

type Sent = { records: readonly ActivityRecordItem[]; deletions: readonly ActivityRecordDeletionPayload[] };

function deps(tracker: FakeTracker, overrides: Partial<ActivityRecordEngineDeps> & { capture?: "on" | "off" } = {}) {
  const sent: Sent[] = [];
  const engineDeps: ActivityRecordEngineDeps = {
    tracker,
    accountId: "account-a",
    send: vi.fn(async (batch) => {
      sent.push(batch);
      return { capture: overrides.capture ?? "on" };
    }),
    privacySettings: () => DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    isAllowed: () => true,
    now: () => NOW,
    sleep: async () => undefined,
    ...overrides,
  };
  return { engineDeps, sent };
}

function enrolled(tracker: FakeTracker, seq = 0) {
  tracker.state = {
    [ACTIVITY_RECORDS_ACCOUNT_KEY]: "account-a",
    [ACTIVITY_RECORDS_SINCE_KEY]: ENROLLED,
    [ACTIVITY_RECORDS_SEQ_KEY]: String(seq),
  };
}

describe("activity records engine", () => {
  it("starts from now: asks with an empty request and never sends earlier activity", async () => {
    const tracker = new FakeTracker();
    tracker.counterSeq = 40;
    tracker.items = [segment(12, { startedAt: "2026-10-01T09:00:00.000Z", endedAt: "2026-10-01T09:05:00.000Z" })];
    const { engineDeps, sent } = deps(tracker);

    await runActivityRecordCycle(engineDeps);

    expect(sent).toEqual([{ records: [], deletions: [] }]);
    expect(tracker.state).toEqual({
      [ACTIVITY_RECORDS_ACCOUNT_KEY]: "account-a",
      [ACTIVITY_RECORDS_SINCE_KEY]: NOW.toISOString(),
      [ACTIVITY_RECORDS_SEQ_KEY]: "40",
    });
  });

  it("sends the change feed in order, with built-in and corrected classifications, and forwards deletions", async () => {
    const tracker = new FakeTracker();
    enrolled(tracker, 3);
    tracker.items = [
      segment(4),
      segment(5, { appName: "Code", siteDomain: null, siteUrl: null, youtubeTitle: null, youtubeChannelName: null, youtubeCategory: null,
        windowTitle: "engine.ts", classification: { category: "workspace", productivity: "focus", source: "app-db", confidence: 1 } }),
      segment(6, { classification: { category: "entertainment", productivity: "drift", source: "manual", confidence: 1 } }),
      // Imported browser history from before sending began stays on the computer.
      segment(7, { startedAt: "2026-10-25T09:00:00.000Z", endedAt: "2026-10-25T09:05:00.000Z", source: "browser-history-import" }),
      segment(8, { exclusionSource: "user" }),
    ];
    tracker.deletions = [
      { deletionUid: "old", kind: "range", rangeStart: null, rangeEnd: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00.000Z" },
      { deletionUid: "new", kind: "uids", segmentUids: ["00000000-0000-4000-8000-000000000002"], createdAt: "2026-10-26T02:30:00.000Z" },
    ];
    const { engineDeps, sent } = deps(tracker);

    const result = await runActivityRecordCycle(engineDeps);

    expect(result).toEqual({ status: "sent", records: 3, deletions: 2 });
    expect(tracker.outboxQueries[0]).toEqual({ afterSeq: 3, limit: 500, includeContext: true });
    expect(tracker.deletionQueries[0]).toEqual({ limit: 100, scope: "records", createdAfter: ENROLLED });
    expect(sent).toHaveLength(1);
    const [batch] = sent;
    expect(batch!.records.map((record) => [record.appName, record.classification?.source])).toEqual([
      ["Safari", "youtube"],
      ["Code", "app-db"],
      ["Safari", "manual"],
    ]);
    expect(batch!.records[0]).toMatchObject({
      url: "https://www.youtube.com/watch",
      title: "Rust ownership",
      youtubeChannelName: "Teacher",
      youtubeCategory: "Education",
      domain: "www.youtube.com",
    });
    expect(batch!.deletions).toEqual([
      { kind: "uids", segmentUids: ["00000000-0000-4000-8000-000000000002"] },
      { kind: "uids", segmentUids: ["00000000-0000-4000-8000-000000000008"] },
    ]);
    expect(tracker.state[ACTIVITY_RECORDS_SEQ_KEY]).toBe("8");
    expect(tracker.deletions.find((item) => item.deletionUid === "new")?.recordsPushed).toBe(true);
    expect(tracker.deletions.find((item) => item.deletionUid === "old")?.recordsPushed).toBeUndefined();
  });

  it("forgets where it was when the server keeps no records, and waits before asking again", async () => {
    const tracker = new FakeTracker();
    enrolled(tracker, 0);
    tracker.items = [segment(1)];
    const { engineDeps } = deps(tracker, { capture: "off" });

    expect(await runActivityRecordCycle(engineDeps)).toEqual({ status: "capture_off" });
    expect(tracker.state[ACTIVITY_RECORDS_SINCE_KEY]).toBeUndefined();
    expect(tracker.state[ACTIVITY_RECORDS_SEQ_KEY]).toBeUndefined();
    expect(tracker.state[ACTIVITY_RECORDS_OFF_UNTIL_KEY]).toBe("2026-10-26T09:00:00.000Z");

    const send = vi.fn();
    expect(await runActivityRecordCycle({ ...engineDeps, send })).toEqual({ status: "waiting" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing and keeps its place once product analytics is turned off mid-cycle", async () => {
    const tracker = new FakeTracker();
    enrolled(tracker, 0);
    tracker.items = [segment(1)];
    let allowed = true;
    tracker.getSyncOutbox.mockImplementationOnce(async () => {
      allowed = false;
      return { items: tracker.items, batchMaxSeq: 1, counterSeq: 1, pendingCount: 1 };
    });
    const { engineDeps, sent } = deps(tracker, { isAllowed: () => allowed });

    expect(await runActivityRecordCycle(engineDeps)).toEqual({ status: "skipped" });
    expect(sent).toEqual([]);
    expect(tracker.state[ACTIVITY_RECORDS_SEQ_KEY]).toBe("0");
  });

  it("starts again from now for another account", async () => {
    const tracker = new FakeTracker();
    enrolled(tracker, 2);
    tracker.counterSeq = 9;
    tracker.items = [segment(5)];
    const { engineDeps, sent } = deps(tracker, { accountId: "account-b" });

    await runActivityRecordCycle(engineDeps);

    expect(sent).toEqual([{ records: [], deletions: [] }]);
    expect(tracker.state[ACTIVITY_RECORDS_ACCOUNT_KEY]).toBe("account-b");
    expect(tracker.state[ACTIVITY_RECORDS_SEQ_KEY]).toBe("9");
  });
});

describe("activity record payload", () => {
  it("follows the AI privacy settings exactly like a Cloud classification request", () => {
    const settings: AiPrivacyRequestSettings = {
      version: 1,
      optional: { siteUrl: false, windowTitle: false, contentContext: false, workProfile: true },
    };
    const { records } = toActivityRecordBatch([segment(1)], ENROLLED, settings);

    expect(records[0]).toMatchObject({ url: null, windowTitle: null, title: null, youtubeChannelName: null, youtubeCategory: null, domain: "www.youtube.com" });
  });

  it("normalizes browser decorations in titles exactly like a Cloud classification request", async () => {
    const decorated = segment(1, {
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: "example.com",
      siteUrl: "https://example.com/doc",
      siteTitle: "Document",
      windowTitle: "Document - High memory usage - 900 MB - Google Chrome - Personal",
      youtubeTitle: null,
      youtubeChannelName: null,
      youtubeCategory: null,
    });
    const { records } = toActivityRecordBatch([decorated], ENROLLED, DEFAULT_AI_PRIVACY_REQUEST_SETTINGS);
    const cloud = await toMinimizedPayload(
      { ...decorated, id: "1" } as unknown as ActivitySegment,
      null,
      DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
      EMPTY_MEMORY_CONTEXT,
    );

    expect(records[0]).toMatchObject({ windowTitle: cloud.windowTitle, title: cloud.siteTitle, url: cloud.siteUrl, domain: cloud.siteDomain });
    expect(records[0]!.windowTitle).toBe("Document - Personal");
  });

  it("keeps the local hour through the start's offset", () => {
    const { records } = toActivityRecordBatch([segment(1, { startedAt: "2026-10-26T11:00:00+09:00", endedAt: "2026-10-26T11:05:00+09:00" })], ENROLLED, DEFAULT_AI_PRIVACY_REQUEST_SETTINGS);

    expect(records[0]!.startedAt).toBe("2026-10-26T02:00:00.000Z");
    expect(records[0]!.utcOffsetMinutes).toBe(-new Date("2026-10-26T02:00:00.000Z").getTimezoneOffset());
  });
});

describe("activity records gate", () => {
  it("runs only with an account, the Cloud connection and product analytics", () => {
    expect(activityRecordsGate({ account: "a", cloudConnectionChosen: true, analyticsEnabled: true })).toBe("run");
    expect(activityRecordsGate({ account: null, cloudConnectionChosen: true, analyticsEnabled: true })).toBe("wait");
    expect(activityRecordsGate({ account: "none", cloudConnectionChosen: true, analyticsEnabled: true })).toBe("stop");
    expect(activityRecordsGate({ account: "a", cloudConnectionChosen: false, analyticsEnabled: true })).toBe("stop");
    expect(activityRecordsGate({ account: null, cloudConnectionChosen: true, analyticsEnabled: false })).toBe("stop");
  });
});
