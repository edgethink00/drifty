import type { SystemTransientActivity } from "@drifty/domain";

export const DRIFT_ALARM_TRANSIENT_DEFER_DELAY_MS = 3_000;
export const DRIFT_ALARM_TRANSIENT_DEFER_MAX_MS = 60_000;

export type DriftAlarmTransientActivity = Exclude<SystemTransientActivity, null>;

export type DriftAlarmTransientCandidate = {
  readonly alertKey: string;
  readonly sourceKey: string;
  readonly candidateDetail: string | null;
};

export type DriftAlarmTransientPending = {
  readonly alertKey: string;
  readonly sourceKey: string;
  readonly candidateDetail: string | null;
  readonly firstDeferredAtMs: number;
  readonly readyAtMs: number;
  readonly expiresAtMs: number;
  readonly systemTransientActivity: DriftAlarmTransientActivity;
};

export type DriftAlarmTransientDeferDecision =
  | { readonly kind: "inactive"; readonly pending: null }
  | { readonly kind: "defer"; readonly pending: DriftAlarmTransientPending }
  | { readonly kind: "await_delay"; readonly pending: DriftAlarmTransientPending; readonly remainingMs: number }
  | { readonly kind: "ready"; readonly pending: DriftAlarmTransientPending }
  | { readonly kind: "cancel"; readonly pending: DriftAlarmTransientPending; readonly reason: "missing_candidate" | "candidate_changed" }
  | { readonly kind: "expired"; readonly pending: DriftAlarmTransientPending };

export type DriftAlarmTransientDeferInput = {
  readonly pending: DriftAlarmTransientPending | null;
  readonly candidate: DriftAlarmTransientCandidate | null;
  readonly systemTransientActivity: DriftAlarmTransientActivity | null;
  readonly nowMs: number;
};

export function sourceKeyForDriftAlarmCandidate(input: {
  readonly segmentId: string;
  readonly sourceSegmentId?: string | null;
}): string {
  return input.sourceSegmentId ?? input.segmentId;
}

export function resolveDriftAlarmTransientDefer(input: DriftAlarmTransientDeferInput): DriftAlarmTransientDeferDecision {
  const activePending = input.pending;
  if (input.systemTransientActivity) {
    if (!input.candidate) {
      return activePending
        ? { kind: "defer", pending: activePending }
        : { kind: "inactive", pending: null };
    }
    if (
      activePending
      && activePending.sourceKey === input.candidate.sourceKey
      && input.nowMs >= activePending.expiresAtMs
    ) {
      return { kind: "expired", pending: activePending };
    }

    return {
      kind: "defer",
      pending: createOrRefreshPending({
        pending: activePending,
        candidate: input.candidate,
        systemTransientActivity: input.systemTransientActivity,
        nowMs: input.nowMs,
      }),
    };
  }

  if (!activePending) return { kind: "inactive", pending: null };
  if (!input.candidate) {
    if (input.nowMs >= activePending.expiresAtMs) return { kind: "expired", pending: activePending };
    return { kind: "cancel", pending: activePending, reason: "missing_candidate" };
  }
  if (input.candidate.sourceKey !== activePending.sourceKey) {
    return { kind: "cancel", pending: activePending, reason: "candidate_changed" };
  }
  if (input.nowMs >= activePending.expiresAtMs) {
    return { kind: "expired", pending: activePending };
  }
  if (input.nowMs < activePending.readyAtMs) {
    return {
      kind: "await_delay",
      pending: activePending,
      remainingMs: activePending.readyAtMs - input.nowMs,
    };
  }
  return { kind: "ready", pending: activePending };
}

function createOrRefreshPending(input: {
  readonly pending: DriftAlarmTransientPending | null;
  readonly candidate: DriftAlarmTransientCandidate;
  readonly systemTransientActivity: DriftAlarmTransientActivity;
  readonly nowMs: number;
}): DriftAlarmTransientPending {
  if (input.pending && input.pending.sourceKey === input.candidate.sourceKey) {
    return {
      ...input.pending,
      alertKey: input.candidate.alertKey,
      candidateDetail: input.candidate.candidateDetail,
      systemTransientActivity: input.systemTransientActivity,
    };
  }

  return {
    alertKey: input.candidate.alertKey,
    sourceKey: input.candidate.sourceKey,
    candidateDetail: input.candidate.candidateDetail,
    firstDeferredAtMs: input.nowMs,
    readyAtMs: input.nowMs + DRIFT_ALARM_TRANSIENT_DEFER_DELAY_MS,
    expiresAtMs: input.nowMs + DRIFT_ALARM_TRANSIENT_DEFER_MAX_MS,
    systemTransientActivity: input.systemTransientActivity,
  };
}
