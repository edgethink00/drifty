// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import type { AccountStatsPayload } from "./accountStatsPayload";
import {
  ACCOUNT_STATS_FAILURE_BACKOFF_MS,
  ACCOUNT_STATS_HEARTBEAT_MS,
  ACCOUNT_STATS_MIN_SUCCESS_INTERVAL_MS,
  ACCOUNT_STATS_PUBLISH_STORAGE_KEY,
  buildAccountStatsPayloadKey,
  findAccountStatsPublishRecord,
  readAccountStatsPublishRecords,
  recordAccountStatsPublishAttempt,
  shouldPublishAccountStats,
  type AccountStatsPublishRecord,
} from "./accountStatsPublishState";

const USER = "user-1";
const NOW = new Date("2026-07-03T12:00:00.000Z");

function makePayload(overrides: Partial<AccountStatsPayload> = {}): AccountStatsPayload {
  return {
    focusSecondsToday: 3600,
    driftSecondsToday: 600,
    neutralSecondsToday: 300,
    categoryBreakdownToday: [{ category: "workspace", seconds: 3600, focusSeconds: 3600, neutralSeconds: 0, driftSeconds: 0 }],
    focusSeconds7d: 5400,
    driftSeconds7d: 900,
    neutralSeconds7d: 450,
    focusShare7d: 0.8,
    categoryBreakdown7d: [{ category: "workspace", seconds: 5400, focusSeconds: 5400, neutralSeconds: 0, driftSeconds: 0 }],
    hourlyPattern7d: [{ hour: 18, focusSeconds: 771 }],
    topApps7d: [{ appName: "Xcode", seconds: 5400 }],
    dailySeries30d: [{ day: "2026-07-03", focus: 3600, drift: 600, neutral: 300 }],
    windowEndDate: "2026-07-03",
    timezone: "Asia/Seoul",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<AccountStatsPublishRecord> = {}): AccountStatsPublishRecord {
  return {
    userScopeKey: USER,
    payloadKey: buildAccountStatsPayloadKey(makePayload()),
    lastAttemptAt: NOW.toISOString(),
    lastSuccessAt: NOW.toISOString(),
    lastErrorAt: null,
    ...overrides,
  };
}

function agoIso(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe("buildAccountStatsPayloadKey", () => {
  it("is stable for identical payloads and changes when any field changes", () => {
    expect(buildAccountStatsPayloadKey(makePayload())).toBe(buildAccountStatsPayloadKey(makePayload()));
    expect(buildAccountStatsPayloadKey(makePayload({ focusSecondsToday: 3601 }))).not.toBe(
      buildAccountStatsPayloadKey(makePayload()),
    );
    // Sub-second float jitter is rounded away, so it never defeats the dedup.
    expect(buildAccountStatsPayloadKey(makePayload({ focusSeconds7d: 5400.2 }))).toBe(
      buildAccountStatsPayloadKey(makePayload()),
    );
  });
});

describe("shouldPublishAccountStats", () => {
  it("publishes when there is no record", () => {
    const decision = shouldPublishAccountStats({ record: null, payloadKey: "k", now: NOW });
    expect(decision).toEqual({ shouldPublish: true, reason: "no_record" });
  });

  it("dedups an unchanged payload published recently", () => {
    const payloadKey = buildAccountStatsPayloadKey(makePayload());
    const record = makeRecord({ payloadKey, lastSuccessAt: agoIso(60 * 1000) });
    const decision = shouldPublishAccountStats({ record, payloadKey, now: NOW });
    expect(decision).toEqual({ shouldPublish: false, reason: "same_payload_recent" });
  });

  it("republishes an unchanged payload once the heartbeat is due", () => {
    const payloadKey = buildAccountStatsPayloadKey(makePayload());
    const record = makeRecord({ payloadKey, lastSuccessAt: agoIso(ACCOUNT_STATS_HEARTBEAT_MS + 1) });
    const decision = shouldPublishAccountStats({ record, payloadKey, now: NOW });
    expect(decision).toEqual({ shouldPublish: true, reason: "heartbeat_due" });
  });

  it("rate-limits a changed payload inside the min success interval", () => {
    const record = makeRecord({ payloadKey: "old", lastSuccessAt: agoIso(ACCOUNT_STATS_MIN_SUCCESS_INTERVAL_MS - 1000) });
    const decision = shouldPublishAccountStats({ record, payloadKey: "new", now: NOW });
    expect(decision).toEqual({ shouldPublish: false, reason: "min_interval" });
  });

  it("publishes a changed payload after the min success interval", () => {
    const record = makeRecord({ payloadKey: "old", lastSuccessAt: agoIso(ACCOUNT_STATS_MIN_SUCCESS_INTERVAL_MS + 1000) });
    const decision = shouldPublishAccountStats({ record, payloadKey: "new", now: NOW });
    expect(decision).toEqual({ shouldPublish: true, reason: "payload_changed" });
  });

  it("backs off after a failure, then retries once the backoff has elapsed", () => {
    const failed = makeRecord({ lastSuccessAt: null, lastErrorAt: agoIso(60 * 1000) });
    expect(shouldPublishAccountStats({ record: failed, payloadKey: "k", now: NOW })).toEqual({
      shouldPublish: false,
      reason: "failure_backoff",
    });

    const recovered = makeRecord({ lastSuccessAt: null, lastErrorAt: agoIso(ACCOUNT_STATS_FAILURE_BACKOFF_MS + 1000) });
    expect(shouldPublishAccountStats({ record: recovered, payloadKey: "k", now: NOW })).toEqual({
      shouldPublish: true,
      reason: "no_record",
    });
  });
});

describe("recordAccountStatsPublishAttempt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores a success record keyed by userScopeKey", () => {
    recordAccountStatsPublishAttempt({ userScopeKey: USER, payloadKey: "k1", success: true, now: NOW });

    const record = findAccountStatsPublishRecord(readAccountStatsPublishRecords(), USER);
    expect(record).toEqual({
      userScopeKey: USER,
      payloadKey: "k1",
      lastAttemptAt: NOW.toISOString(),
      lastSuccessAt: NOW.toISOString(),
      lastErrorAt: null,
    });
  });

  it("keeps the last successful payload key and success time across a failure", () => {
    recordAccountStatsPublishAttempt({ userScopeKey: USER, payloadKey: "k1", success: true, now: NOW });
    const later = new Date(NOW.getTime() + 60 * 1000);
    recordAccountStatsPublishAttempt({ userScopeKey: USER, payloadKey: "k2", success: false, now: later });

    const record = findAccountStatsPublishRecord(readAccountStatsPublishRecords(), USER);
    expect(record).toEqual({
      userScopeKey: USER,
      payloadKey: "k1", // key of the last SUCCESSFUL publish, so dedup still compares against it
      lastAttemptAt: later.toISOString(),
      lastSuccessAt: NOW.toISOString(),
      lastErrorAt: later.toISOString(),
    });
  });

  it("keeps one record per user and ignores malformed storage", () => {
    recordAccountStatsPublishAttempt({ userScopeKey: USER, payloadKey: "k1", success: true, now: NOW });
    recordAccountStatsPublishAttempt({ userScopeKey: "user-2", payloadKey: "k2", success: true, now: NOW });
    recordAccountStatsPublishAttempt({ userScopeKey: USER, payloadKey: "k3", success: true, now: NOW });

    const records = readAccountStatsPublishRecords();
    expect(records).toHaveLength(2);
    expect(findAccountStatsPublishRecord(records, USER)?.payloadKey).toBe("k3");

    window.localStorage.setItem(ACCOUNT_STATS_PUBLISH_STORAGE_KEY, "{not json");
    expect(readAccountStatsPublishRecords()).toEqual([]);
  });
});
