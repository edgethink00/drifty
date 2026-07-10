// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS,
  LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS,
  LEADERBOARD_AUTO_PUBLISH_SLOT_MS,
  LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY,
  buildLeaderboardAutoPublishPayloadKey,
  findLeaderboardAutoPublishRecord,
  readLeaderboardAutoPublishRecords,
  shouldPublishLeaderboardPeriod,
  upsertLeaderboardAutoPublishRecords,
  writeLeaderboardAutoPublishRecords,
  type LeaderboardAutoPublishRecord,
} from "./leaderboardAutoPublishState";

const BASE_TIME = new Date("2026-07-03T12:00:00.000Z");

function minutesAgo(minutes: number) {
  return new Date(BASE_TIME.getTime() - minutes * 60 * 1000).toISOString();
}

function makePayloadKey(focusSeconds: number) {
  return buildLeaderboardAutoPublishPayloadKey({
    profileDisplayName: "Alex",
    period: "weekly",
    focusSeconds,
    windowStartDay: "2026-06-27",
    windowEndDay: "2026-07-03",
    timezone: "Asia/Seoul",
  });
}

function makeRecord(overrides: Partial<LeaderboardAutoPublishRecord> = {}): LeaderboardAutoPublishRecord {
  return {
    userScopeKey: "user-1",
    period: "weekly",
    payloadKey: makePayloadKey(3600),
    lastAttemptAt: minutesAgo(60),
    lastSuccessAt: minutesAgo(60),
    lastErrorAt: null,
    ...overrides,
  };
}

describe("leaderboardAutoPublishState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    window.localStorage.clear();
  });

  it("publishes score changes at most once per hour slot, with a daily heartbeat", () => {
    expect(LEADERBOARD_AUTO_PUBLISH_SLOT_MS).toBe(60 * 60 * 1000);
    expect(LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS).toBe(24 * 60 * 60 * 1000);
    expect(LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS).toBe(15 * 60 * 1000);
  });

  it("builds stable remote-safe payload keys", () => {
    const key = buildLeaderboardAutoPublishPayloadKey({
      profileDisplayName: " Alex ",
      period: "daily",
      focusSeconds: 42.4,
      windowStartDay: "2026-07-03",
      windowEndDay: "2026-07-03",
      timezone: "Asia/Seoul",
    });

    expect(JSON.parse(key)).toEqual({
      profileDisplayName: "Alex",
      period: "daily",
      focusSeconds: 42,
      windowStartDay: "2026-07-03",
      windowEndDay: "2026-07-03",
      timezone: "Asia/Seoul",
    });
    expect(key).not.toContain("segments");
    expect(key).not.toContain("siteDomain");
    expect(key).not.toContain("windowTitle");
  });

  it("skips the same payload until heartbeat is due", () => {
    const recentDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: minutesAgo(60) }),
      payloadKey: makePayloadKey(3600),
      now: BASE_TIME,
    });

    const heartbeatDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS).toISOString() }),
      payloadKey: makePayloadKey(3600),
      now: BASE_TIME,
    });

    expect(recentDecision).toEqual({ shouldPublish: false, reason: "same_payload_recent", requiresRemoteOptInCheck: false });
    expect(heartbeatDecision).toEqual({ shouldPublish: true, reason: "heartbeat_due", requiresRemoteOptInCheck: true });
  });

  it("throttles changed payloads within the same hour slot, then publishes once a new slot starts", () => {
    const now = new Date("2026-07-03T12:30:00.000Z");

    // Last success at 12:05 is in the same 12:00 hour slot as `now` → blocked.
    const sameSlotDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: "2026-07-03T12:05:00.000Z" }),
      payloadKey: makePayloadKey(4200),
      now,
    });

    // Last success at 11:55 is in the previous (11:00) slot → publish. Every real
    // publish of a changed score re-verifies remote opt-in, regardless of how
    // recently we last published, so an active device cannot resurrect an opt-out
    // made on another device.
    const newSlotDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: "2026-07-03T11:55:00.000Z" }),
      payloadKey: makePayloadKey(4200),
      now,
    });

    expect(sameSlotDecision).toEqual({ shouldPublish: false, reason: "same_slot", requiresRemoteOptInCheck: false });
    expect(newSlotDecision).toEqual({ shouldPublish: true, reason: "payload_changed", requiresRemoteOptInCheck: true });
  });

  it("resolves the slot from wall-clock hour boundaries", () => {
    // 12:59:59.999 and 13:00:00.000 fall in different slots → publish across the boundary.
    const crossBoundary = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: "2026-07-03T12:59:59.999Z" }),
      payloadKey: makePayloadKey(4200),
      now: new Date("2026-07-03T13:00:00.000Z"),
    });

    // 12:00:00.000 and 12:59:59.999 share the 12:00 slot → blocked.
    const withinBoundary = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: "2026-07-03T12:00:00.000Z" }),
      payloadKey: makePayloadKey(4200),
      now: new Date("2026-07-03T12:59:59.999Z"),
    });

    expect(crossBoundary.shouldPublish).toBe(true);
    expect(crossBoundary.reason).toBe("payload_changed");
    expect(withinBoundary).toEqual({ shouldPublish: false, reason: "same_slot", requiresRemoteOptInCheck: false });
  });

  it("lets explicit aggregate-changing triggers bypass the slot gate", () => {
    const decision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: "2026-07-03T12:05:00.000Z" }),
      payloadKey: makePayloadKey(1200),
      now: new Date("2026-07-03T12:30:00.000Z"),
      bypassSlotGate: true,
    });

    expect(decision).toEqual({ shouldPublish: true, reason: "payload_changed", requiresRemoteOptInCheck: true });
  });

  it("backs off after failures", () => {
    const blockedDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastErrorAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS + 1000).toISOString() }),
      payloadKey: makePayloadKey(4200),
      now: BASE_TIME,
      bypassSlotGate: true,
    });

    const retryDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastErrorAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS).toISOString() }),
      payloadKey: makePayloadKey(4200),
      now: BASE_TIME,
      bypassSlotGate: true,
    });

    expect(blockedDecision).toEqual({ shouldPublish: false, reason: "failure_backoff", requiresRemoteOptInCheck: false });
    expect(retryDecision.shouldPublish).toBe(true);
  });

  it("recovers from malformed local storage", () => {
    window.localStorage.setItem(LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY, "{");

    expect(readLeaderboardAutoPublishRecords()).toEqual([]);
  });

  it("keeps records isolated by user and period", () => {
    const dailyRecord = makeRecord({ period: "daily", payloadKey: "daily" });
    const weeklyRecord = makeRecord({ period: "weekly", payloadKey: "weekly" });

    writeLeaderboardAutoPublishRecords(upsertLeaderboardAutoPublishRecords([], [dailyRecord, weeklyRecord]));

    const records = readLeaderboardAutoPublishRecords();
    expect(findLeaderboardAutoPublishRecord(records, "user-1", "daily")?.payloadKey).toBe("daily");
    expect(findLeaderboardAutoPublishRecord(records, "user-1", "weekly")?.payloadKey).toBe("weekly");
    expect(findLeaderboardAutoPublishRecord(records, "user-2", "weekly")).toBeNull();
  });
});
