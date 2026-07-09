// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEVICE_SYNC_FAILURE_BACKOFF_MS,
  DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS,
  DEVICE_SYNC_STATE_STORAGE_KEY,
  findDeviceSyncCycleRecord,
  readDeviceSyncCycleRecords,
  shouldRunDeviceSyncCycle,
  upsertDeviceSyncCycleRecord,
  writeDeviceSyncCycleRecords,
} from "./deviceSyncState";

const NOW = new Date("2026-07-09T12:00:00+00:00");

describe("shouldRunDeviceSyncCycle", () => {
  it("runs immediately with no record", () => {
    expect(shouldRunDeviceSyncCycle({ record: null, now: NOW, reason: "startup" })).toEqual({
      shouldRun: true,
      reason: "no_record",
    });
  });

  it("manual runs bypass every guard", () => {
    const record = {
      userScopeKey: "user-1",
      lastAttemptAt: NOW.toISOString(),
      lastSuccessAt: null,
      lastErrorAt: NOW.toISOString(),
    };
    expect(shouldRunDeviceSyncCycle({ record, now: NOW, reason: "manual" }).shouldRun).toBe(true);
  });

  it("backs off after a recent failure", () => {
    const record = {
      userScopeKey: "user-1",
      lastAttemptAt: new Date(NOW.getTime() - 60_000).toISOString(),
      lastSuccessAt: null,
      lastErrorAt: new Date(NOW.getTime() - DEVICE_SYNC_FAILURE_BACKOFF_MS + 1_000).toISOString(),
    };
    expect(shouldRunDeviceSyncCycle({ record, now: NOW, reason: "interval" })).toEqual({
      shouldRun: false,
      reason: "failure_backoff",
    });
  });

  it("resumes after the failure backoff has elapsed", () => {
    const record = {
      userScopeKey: "user-1",
      lastAttemptAt: new Date(NOW.getTime() - DEVICE_SYNC_FAILURE_BACKOFF_MS - 1_000).toISOString(),
      lastSuccessAt: null,
      lastErrorAt: new Date(NOW.getTime() - DEVICE_SYNC_FAILURE_BACKOFF_MS - 1_000).toISOString(),
    };
    expect(shouldRunDeviceSyncCycle({ record, now: NOW, reason: "interval" }).shouldRun).toBe(true);
  });

  it("skips rapid-fire triggers inside the minimum interval", () => {
    const record = {
      userScopeKey: "user-1",
      lastAttemptAt: new Date(NOW.getTime() - DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS + 5_000).toISOString(),
      lastSuccessAt: new Date(NOW.getTime() - DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS + 5_000).toISOString(),
      lastErrorAt: null,
    };
    expect(shouldRunDeviceSyncCycle({ record, now: NOW, reason: "focus" })).toEqual({
      shouldRun: false,
      reason: "too_soon",
    });
  });
});

describe("device sync cycle records storage", () => {
  beforeEach(() => {
    window.localStorage.removeItem(DEVICE_SYNC_STATE_STORAGE_KEY);
  });

  it("round-trips records per user scope", () => {
    const record = {
      userScopeKey: "user-1",
      lastAttemptAt: NOW.toISOString(),
      lastSuccessAt: NOW.toISOString(),
      lastErrorAt: null,
    };
    writeDeviceSyncCycleRecords(upsertDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), record));

    const loaded = findDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), "user-1");
    expect(loaded).toEqual(record);
    expect(findDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), "user-2")).toBeNull();
  });

  it("ignores malformed storage payloads", () => {
    window.localStorage.setItem(DEVICE_SYNC_STATE_STORAGE_KEY, "{not json");
    expect(readDeviceSyncCycleRecords()).toEqual([]);
  });
});
