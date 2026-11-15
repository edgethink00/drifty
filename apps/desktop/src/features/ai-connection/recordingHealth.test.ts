import { describe, expect, it } from "vitest";
import { resolveRecordingHealth } from "./recordingHealth";

const now = Date.parse("2026-10-14T09:00:00Z");
const base = {
  native: true, preview: false, statusFresh: true, captureFresh: true, pausePending: false,
  accessibilityRequired: true, captureGap: false, now,
  status: { running: true, accessibilityGranted: true, trackerMode: "tracking", lastEventAt: new Date(now - 5_000).toISOString() },
};

describe("recording health", () => {
  it.each(["failed", "gap", "starting", "unknown"] as const)("never confirms recording or idle from an unhealthy receipt: %s", (captureHealth) => {
    for (const trackerMode of ["tracking", "idle", "suppressed"]) {
      expect(resolveRecordingHealth({ ...base, status: { ...base.status, trackerMode, captureHealth } }))
        .toEqual({ kind: "unknown", action: "check" });
    }
  });
  it("accepts live failure then recovered commits without requiring a full status refresh", () => {
    const status = { ...base.status, captureHealth: "recording" as const };
    expect(resolveRecordingHealth({ ...base, status, captureRunState: { running: true, captureHealth: "failed" } }).kind).toBe("unknown");
    expect(resolveRecordingHealth({ ...base, status: { ...status, captureHealth: "failed" }, captureRunState: { running: true, captureHealth: "recording" } }).kind).toBe("recording");
    expect(resolveRecordingHealth({ ...base, status: { ...status, running: false, trackingPaused: true, captureHealth: "failed" } }).kind).toBe("paused");
  });
  it("confirms only recent recording with known native capture and permission evidence", () => {
    expect(resolveRecordingHealth(base)).toEqual({ kind: "recording", action: null });
  });
  it.each([null, "invalid", new Date(now - 90_000).toISOString(), new Date(now + 1000).toISOString()])("does not claim recording from a PID and unusable event timestamp %s", (lastEventAt) => {
    expect(resolveRecordingHealth({ ...base, status: { ...base.status, lastEventAt } }).kind).toBe("unknown");
  });
  it.each(["idle", "suppressed"])("keeps %s distinct from failure even with old events", (trackerMode) => {
    expect(resolveRecordingHealth({ ...base, status: { ...base.status, trackerMode, lastEventAt: null } }).kind).toBe(trackerMode);
  });
  it.each(["native", "live", "python-sidecar", "unknown"])("does not infer recording from an undocumented mode %s", (trackerMode) => {
    expect(resolveRecordingHealth({ ...base, status: { ...base.status, trackerMode } }).kind).toBe("unknown");
  });
  it("distinguishes pause in flight, a failed stop, and a confirmed pause", () => {
    const failed = { ...base, status: { ...base.status, trackingPaused: true, trackerMode: "degraded" } };
    expect(resolveRecordingHealth({ ...failed, pausePending: true })).toEqual({ kind: "pausing", action: null });
    expect(resolveRecordingHealth(failed)).toEqual({ kind: "degraded", action: "pause" });
    expect(resolveRecordingHealth({ ...failed, status: { ...failed.status, running: false, trackerMode: "stopped" } })).toEqual({ kind: "paused", action: "resume" });
  });
  it("does not treat missing Windows accessibility permission as denied", () => {
    const input = { ...base, status: { ...base.status, accessibilityGranted: false } };
    expect(resolveRecordingHealth(input)).toEqual({ kind: "permission", action: "settings" });
    expect(resolveRecordingHealth({ ...input, accessibilityRequired: false }).kind).toBe("recording");
  });
  it("reports a stopped native tracker without pause intent as needing attention", () => {
    const stopped = { ...base.status, running: false, trackingPaused: false, trackerMode: "idle" };
    expect(resolveRecordingHealth({ ...base, status: stopped })).toEqual({ kind: "degraded", action: "retry" });
    expect(resolveRecordingHealth({ ...base, status: { ...stopped, trackingPaused: true } })).toEqual({ kind: "paused", action: "resume" });
    expect(resolveRecordingHealth({ ...base, status: { ...stopped, accessibilityGranted: false } })).toEqual({ kind: "permission", action: "settings" });
    expect(resolveRecordingHealth({ ...base, status: stopped, statusFresh: false })).toEqual({ kind: "unknown", action: "check" });
  });
  it("does not treat unavailable's synthetic permission flag as a real permission denial", () => {
    expect(resolveRecordingHealth({ ...base, status: { running: false, accessibilityGranted: false, trackerMode: "unavailable" } })).toEqual({ kind: "unknown", action: "check" });
  });
  it("keeps a confirmed stop visible after the full status expires", () => {
    const liveOnly = { ...base, statusFresh: false };
    const stopped = { ...base.status, running: false, trackerMode: "idle" };
    expect(resolveRecordingHealth({ ...liveOnly, captureRunState: { ...stopped, trackingPaused: true } })).toEqual({ kind: "paused", action: "resume" });
    expect(resolveRecordingHealth({ ...liveOnly, captureRunState: { ...stopped, trackingPaused: false } })).toEqual({ kind: "degraded", action: "retry" });
    expect(resolveRecordingHealth({ ...liveOnly, captureRunState: { ...base.status, trackingPaused: false } }).kind).toBe("unknown");
    expect(resolveRecordingHealth({ ...liveOnly, captureFresh: false, captureRunState: { ...stopped, trackingPaused: true } }).kind).toBe("unknown");
  });
  it.each([{ statusFresh: false }, { captureFresh: false }, { captureGap: true }])("requires fresh independent recording evidence %o", (change) => {
    expect(resolveRecordingHealth({ ...base, ...change }).kind).toBe("unknown");
  });
  it.each([{ native: false }, { preview: true }, { status: { ...base.status, trackerMode: "demo" } }])("never presents preview state as native recording %o", (change) => {
    expect(resolveRecordingHealth({ ...base, ...change })).toEqual({ kind: "preview", action: null });
  });
  it("names a nearly full disk instead of an unconfirmed recording", () => {
    const low = { ...base, status: { ...base.status, storageFreeBytes: 1024, lastEventAt: new Date(now - 600_000).toISOString() } };
    expect(resolveRecordingHealth(low)).toEqual({ kind: "storage", action: null });
    expect(resolveRecordingHealth({ ...base, status: { ...base.status, storageFreeBytes: 256 * 1024 * 1024 } }).kind).toBe("recording");
    expect(resolveRecordingHealth({ ...base, status: { ...base.status, storageFreeBytes: null } }).kind).toBe("recording");
  });
  it("reports a full database volume even when the process answers and capture reads fail", () => {
    const full = { ...base, captureFresh: false, status: { ...base.status, storageFreeBytes: 0 } };
    expect(resolveRecordingHealth(full)).toEqual({ kind: "storageFull", action: null });
    expect(resolveRecordingHealth({ ...full, statusFresh: false }).kind).toBe("unknown");
    expect(resolveRecordingHealth({
      ...full, captureFresh: true, status: { ...full.status, running: false, trackerMode: "idle", trackingPaused: true },
    }).kind).toBe("paused");
  });
  it("keeps paused, permission and stale evidence ahead of storage", () => {
    const low = { storageFreeBytes: 1024 };
    expect(resolveRecordingHealth({ ...base, status: { ...base.status, ...low, running: false, trackingPaused: true } }).kind).toBe("paused");
    expect(resolveRecordingHealth({ ...base, status: { ...base.status, ...low, accessibilityGranted: false } }).kind).toBe("permission");
    expect(resolveRecordingHealth({ ...base, statusFresh: false, status: { ...base.status, ...low } }).kind).toBe("unknown");
  });
  it("reports confirmed startup disk exhaustion even when the activity read failed", () => {
    const input = { ...base, captureFresh: false, status: {
      ...base.status, trackerMode: "degraded", running: false, storageFreeBytes: 0, lastEventAt: null,
    } };
    expect(resolveRecordingHealth(input)).toEqual({ kind: "storageFull", action: null });
    expect(resolveRecordingHealth({ ...input, statusFresh: false }).kind).toBe("unknown");
    expect(resolveRecordingHealth({ ...input, pausePending: true }).kind).toBe("pausing");
    expect(resolveRecordingHealth({ ...input, status: { ...input.status, trackingPaused: true } }).kind).not.toBe("storageFull");
    expect(resolveRecordingHealth({ ...input, status: { ...input.status, storageFreeBytes: null } }).kind).not.toBe("storageFull");
  });
});
