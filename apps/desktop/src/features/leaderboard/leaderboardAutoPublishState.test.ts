// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS,
  LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS,
  LEADERBOARD_AUTO_PUBLISH_INTERVAL_MS,
  LEADERBOARD_AUTO_PUBLISH_MIN_SUCCESS_INTERVAL_MS,
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

  it("uses a 24-hour automatic publish cadence", () => {
    expect(LEADERBOARD_AUTO_PUBLISH_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(LEADERBOARD_AUTO_PUBLISH_MIN_SUCCESS_INTERVAL_MS).toBe(LEADERBOARD_AUTO_PUBLISH_INTERVAL_MS);
    expect(LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS).toBe(LEADERBOARD_AUTO_PUBLISH_INTERVAL_MS);
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

  it("throttles changed payloads until the minimum success interval passes", () => {
    const throttledDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_MIN_SUCCESS_INTERVAL_MS + 1000).toISOString() }),
      payloadKey: makePayloadKey(4200),
      now: BASE_TIME,
    });

    const allowedDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_MIN_SUCCESS_INTERVAL_MS).toISOString() }),
      payloadKey: makePayloadKey(4200),
      now: BASE_TIME,
    });

    expect(throttledDecision).toEqual({ shouldPublish: false, reason: "min_interval", requiresRemoteOptInCheck: false });
    expect(allowedDecision).toEqual({ shouldPublish: true, reason: "payload_changed", requiresRemoteOptInCheck: true });
  });

  it("lets explicit aggregate-changing triggers bypass the minimum success interval", () => {
    const decision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastSuccessAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_MIN_SUCCESS_INTERVAL_MS + 1000).toISOString() }),
      payloadKey: makePayloadKey(1200),
      now: BASE_TIME,
      bypassMinInterval: true,
    });

    expect(decision).toEqual({ shouldPublish: true, reason: "payload_changed", requiresRemoteOptInCheck: true });
  });

  it("backs off after failures", () => {
    const blockedDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastErrorAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS + 1000).toISOString() }),
      payloadKey: makePayloadKey(4200),
      now: BASE_TIME,
      bypassMinInterval: true,
    });

    const retryDecision = shouldPublishLeaderboardPeriod({
      record: makeRecord({ lastErrorAt: new Date(BASE_TIME.getTime() - LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS).toISOString() }),
      payloadKey: makePayloadKey(4200),
      now: BASE_TIME,
      bypassMinInterval: true,
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
