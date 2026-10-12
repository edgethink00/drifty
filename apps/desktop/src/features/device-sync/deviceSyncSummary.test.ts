import { describe, expect, it } from "vitest";

import { formatDeviceRelativeTime, resolveDeviceSyncSummary, type DeviceSyncSummaryInput } from "./deviceSyncSummary";
import { IDLE_DEVICE_SYNC_STATUS, type DeviceSyncStatus } from "./deviceSyncTypes";

const status = (overrides: Partial<DeviceSyncStatus> = {}): DeviceSyncStatus => ({ ...IDLE_DEVICE_SYNC_STATUS, enabled: true, ...overrides });
const input = (overrides: Partial<DeviceSyncSummaryInput> = {}): DeviceSyncSummaryInput => ({
  enabled: true, gateActive: true, deviceLimitReached: false, running: false, status: status(), ...overrides,
});

describe("resolveDeviceSyncSummary", () => {
  it("reads opt-out and blocked access before anything the last cycle reported", () => {
    const failing = status({ lastError: "Failed to fetch" });
    expect(resolveDeviceSyncSummary(input({ enabled: false, status: failing })).kind).toBe("off");
    expect(resolveDeviceSyncSummary(input({ enabled: false, deviceLimitReached: true })).kind).toBe("limit");
    expect(resolveDeviceSyncSummary(input({ gateActive: false, status: failing })).kind).toBe("paused");
    expect(resolveDeviceSyncSummary(input({ gateActive: false, deviceLimitReached: true })).kind).toBe("limit");
    expect(resolveDeviceSyncSummary(input({ running: true, status: failing })).kind).toBe("running");
    expect(resolveDeviceSyncSummary(input({ status: failing }))).toMatchObject({ kind: "error", tone: "error" });
  });

  it("counts history as uploading only while the outbox still holds work", () => {
    const backfill = { pushedSeq: 42, totalSeq: 100 };
    expect(resolveDeviceSyncSummary(input({ status: status({ pendingPushCount: 3, backfill }) }))).toMatchObject({ kind: "uploading", percent: 42 });
    expect(resolveDeviceSyncSummary(input({ status: status({ pendingPushCount: 0, backfill }) })).kind).toBe("waiting");
    expect(resolveDeviceSyncSummary(input({ status: status({ pendingPushCount: 3, backfill: { pushedSeq: 999, totalSeq: 1000 } }) })).percent).toBe(99);
  });

  it("reports the most recent completed push or pull", () => {
    const summary = resolveDeviceSyncSummary(input({ status: status({ lastPushedAt: "2026-10-12T07:00:00Z", lastPulledAt: "2026-10-12T07:02:00Z" }) }));
    expect(summary).toMatchObject({ kind: "synced", tone: "ok", lastSyncedAt: "2026-10-12T07:02:00Z" });
    expect(resolveDeviceSyncSummary(input({ status: status({ lastPushedAt: "not a date" }) })).kind).toBe("waiting");
  });
});

describe("formatDeviceRelativeTime", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reads recent times relatively and older ones as a date", () => {
    expect(formatDeviceRelativeTime(ago(10_000), now, "en")).toBe("just now");
    expect(formatDeviceRelativeTime(ago(59 * 60_000 + 50_000), now, "en")).toBe("59 minutes ago");
    expect(formatDeviceRelativeTime(ago(26 * 3_600_000), now, "en")).toBe("yesterday");
    expect(formatDeviceRelativeTime("2026-08-25T02:34:00Z", now, "en")).toBe("Aug 25");
    expect(formatDeviceRelativeTime(ago(2 * 60_000), now, "ko")).toBe("2분 전");
    expect(formatDeviceRelativeTime("2026-08-25T02:34:00Z", now, "ko")).toBe("8월 25일");
  });

  it("treats a clock running ahead as just now and rejects unreadable values", () => {
    expect(formatDeviceRelativeTime(new Date(now + 90_000).toISOString(), now, "en")).toBe("just now");
    expect(formatDeviceRelativeTime("never", now, "en")).toBeNull();
  });
});

