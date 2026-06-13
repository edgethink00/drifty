import { describe, expect, it } from "vitest";

import {
  DRIFT_ALARM_TRANSIENT_DEFER_DELAY_MS,
  DRIFT_ALARM_TRANSIENT_DEFER_MAX_MS,
  resolveDriftAlarmTransientDefer,
  sourceKeyForDriftAlarmCandidate,
} from "./driftAlarmTransientDefer";

const candidate = {
  alertKey: "active:seg-1",
  sourceKey: "seg-1",
  candidateDetail: "youtube.com - 6m",
};

describe("drift alarm transient defer", () => {
  it("creates a pending deferral while Mission Control is active", () => {
    const decision = resolveDriftAlarmTransientDefer({
      pending: null,
      candidate,
      systemTransientActivity: "mission_control",
      nowMs: 1_000,
    });

    expect(decision).toMatchObject({
      kind: "defer",
      pending: {
        alertKey: "active:seg-1",
        sourceKey: "seg-1",
        candidateDetail: "youtube.com - 6m",
        firstDeferredAtMs: 1_000,
        readyAtMs: 1_000 + DRIFT_ALARM_TRANSIENT_DEFER_DELAY_MS,
        expiresAtMs: 1_000 + DRIFT_ALARM_TRANSIENT_DEFER_MAX_MS,
        systemTransientActivity: "mission_control",
      },
    });
  });

  it("waits until the same candidate has been stable for the delay", () => {
    const pending = resolveDriftAlarmTransientDefer({
      pending: null,
      candidate,
      systemTransientActivity: "app_switcher",
      nowMs: 2_000,
    }).pending;

    const decision = resolveDriftAlarmTransientDefer({
      pending,
      candidate,
      systemTransientActivity: null,
      nowMs: 2_000 + DRIFT_ALARM_TRANSIENT_DEFER_DELAY_MS - 1,
    });

    expect(decision.kind).toBe("await_delay");
  });

  it("marks the same candidate ready after the stable delay", () => {
    const pending = resolveDriftAlarmTransientDefer({
      pending: null,
      candidate,
      systemTransientActivity: "app_switcher",
      nowMs: 2_000,
    }).pending;

    const decision = resolveDriftAlarmTransientDefer({
      pending,
      candidate,
      systemTransientActivity: null,
      nowMs: 2_000 + DRIFT_ALARM_TRANSIENT_DEFER_DELAY_MS,
    });

    expect(decision.kind).toBe("ready");
  });

  it("cancels a pending alarm when the returned candidate differs", () => {
    const pending = resolveDriftAlarmTransientDefer({
      pending: null,
      candidate,
      systemTransientActivity: "mission_control",
      nowMs: 3_000,
    }).pending;

    const decision = resolveDriftAlarmTransientDefer({
      pending,
      candidate: { ...candidate, alertKey: "active:seg-2", sourceKey: "seg-2" },
      systemTransientActivity: null,
      nowMs: 6_000,
    });

    expect(decision).toMatchObject({ kind: "cancel", reason: "candidate_changed" });
  });

  it("expires a pending alarm after the maximum defer time", () => {
    const pending = resolveDriftAlarmTransientDefer({
      pending: null,
      candidate,
      systemTransientActivity: "mission_control",
      nowMs: 4_000,
    }).pending;

    const decision = resolveDriftAlarmTransientDefer({
      pending,
      candidate,
      systemTransientActivity: null,
      nowMs: 4_000 + DRIFT_ALARM_TRANSIENT_DEFER_MAX_MS,
    });

    expect(decision.kind).toBe("expired");
  });

  it("uses the source segment id when available for candidate identity", () => {
    expect(sourceKeyForDriftAlarmCandidate({ segmentId: "extended-live", sourceSegmentId: "stored-seg" })).toBe("stored-seg");
    expect(sourceKeyForDriftAlarmCandidate({ segmentId: "stored-seg", sourceSegmentId: null })).toBe("stored-seg");
  });
});
