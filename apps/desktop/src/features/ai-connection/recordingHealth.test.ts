import { describe, expect, it } from "vitest";
import { resolveRecordingHealth } from "./recordingHealth";

const now = Date.parse("2026-10-14T09:00:00Z");
const base = {
  native: true, preview: false, statusFresh: true, captureFresh: true, pausePending: false,
  accessibilityRequired: true, captureGap: false, now,
  status: { running: true, accessibilityGranted: true, trackerMode: "tracking", lastEventAt: new Date(now - 5_000).toISOString() },
};

describe("recording health", () => {
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
  it("does not treat unavailable's synthetic permission flag as a real permission denial", () => {
    expect(resolveRecordingHealth({ ...base, status: { running: false, accessibilityGranted: false, trackerMode: "unavailable" } })).toEqual({ kind: "unknown", action: "check" });
  });
  it.each([{ statusFresh: false }, { captureFresh: false }, { captureGap: true }])("requires fresh independent recording evidence %o", (change) => {
    expect(resolveRecordingHealth({ ...base, ...change }).kind).toBe("unknown");
  });
  it.each([{ native: false }, { preview: true }, { status: { ...base.status, trackerMode: "demo" } }])("never presents preview state as native recording %o", (change) => {
    expect(resolveRecordingHealth({ ...base, ...change })).toEqual({ kind: "preview", action: null });
  });
});
