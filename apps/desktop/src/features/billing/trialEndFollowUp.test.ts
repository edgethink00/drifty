// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BillingEntitlement } from "./billingService";
import {
  TRIAL_END_NOTICE_MIN_UNCLASSIFIED_SECONDS,
  getTrialEndFollowUpKey,
  resolveTrialEndFollowUpStage,
  useTrialEndFollowUp,
} from "./trialEndFollowUp";

const expired: BillingEntitlement = {
  plan: "individual", status: "locked", canUseApp: false, trialEndsAt: "2026-10-09T05:30:00.000Z", currentPeriodEnd: null, lockedReason: "trial_expired",
};
const HALF_HOUR = TRIAL_END_NOTICE_MIN_UNCLASSIFIED_SECONDS;

describe("trial-end follow-up (owner decision 2026-10-10)", () => {
  afterEach(() => window.localStorage.clear());

  it("keys only a confirmed trial expiry, per account and expiry", () => {
    expect(getTrialEndFollowUpKey("user-1", expired)).toBe("user-1:2026-10-09T05:30:00.000Z");
    expect(getTrialEndFollowUpKey(null, expired)).toBeNull();
    expect(getTrialEndFollowUpKey("user-1", { ...expired, lockedReason: "payment_required" })).toBeNull();
    expect(getTrialEndFollowUpKey("user-1", { ...expired, status: "trialing", lockedReason: undefined })).toBeNull();
  });

  it("keys inactive plans separately by account and paid period, never by the old trial end", () => {
    const plan = { ...expired, lockedReason: "billing_missing" as const, currentPeriodEnd: "2026-10-22T05:30:00.000Z" };
    expect(getTrialEndFollowUpKey("user-1", plan)).toBe("user-1:plan:2026-10-22T05:30:00.000Z");
    expect(getTrialEndFollowUpKey("user-2", plan)).not.toBe(getTrialEndFollowUpKey("user-1", plan));
    expect(getTrialEndFollowUpKey("user-1", { ...plan, currentPeriodEnd: null })).toBe("user-1:plan:unknown-expiry");
    expect(getTrialEndFollowUpKey("user-1", { ...plan, trialEndsAt: "2020-01-01" })).toBe(getTrialEndFollowUpKey("user-1", plan));
    for (const lockedReason of ["payment_required", "device_limit_reached"] as const) {
      expect(getTrialEndFollowUpKey("user-1", { ...plan, lockedReason })).toBeNull();
    }
    expect(getTrialEndFollowUpKey("user-1", { ...plan, entitlementOwner: "organization" })).toBeNull();
    expect(getTrialEndFollowUpKey("user-1", { ...plan, trialActivation: { state: "available", startedAt: null, endsAt: null } })).toBeNull();
  });

  it("preserves existing trial marks without suppressing the later paid-plan follow-up", () => {
    const key = getTrialEndFollowUpKey("user-1", expired)!;
    window.localStorage.setItem(`drifty:billing:trial-end-sheet-day:v1:${key}`, "2026-10-09");
    const trial = renderHook(() => useTrialEndFollowUp(key, "2026-10-09", 0));
    expect(trial.result.current.stage).toBe("quiet");
    const planKey = getTrialEndFollowUpKey("user-1", { ...expired, lockedReason: "billing_missing" });
    const plan = renderHook(() => useTrialEndFollowUp(planKey, "2026-10-09", 0));
    expect(plan.result.current.stage).toBe("sheet");
    act(() => plan.result.current.markSheetSeen());
    plan.unmount();
    const remount = renderHook(() => useTrialEndFollowUp(planKey, "2026-10-09", 7200));
    expect(remount.result.current.stage).toBe("quiet");
  });

  it("shows the sheet first, nothing more that day, then the notice once a day past 30 minutes unclassified", () => {
    const stage = (sheetDay: string | null, noticeDay: string | null, today: string, unclassifiedSeconds: number | null) =>
      resolveTrialEndFollowUpStage({ sheetDay, noticeDay, today, unclassifiedSeconds });
    expect(stage(null, null, "2026-10-09", 0)).toBe("sheet");
    expect(stage("2026-10-09", null, "2026-10-09", 5 * HALF_HOUR)).toBe("quiet");
    expect(stage("2026-10-09", null, "2026-10-10", HALF_HOUR - 60)).toBe("quiet");
    expect(stage("2026-10-09", null, "2026-10-10", null)).toBe("quiet");
    expect(stage("2026-10-09", null, "2026-10-10", HALF_HOUR)).toBe("notice");
    expect(stage("2026-10-09", "2026-10-10", "2026-10-10", 4 * HALF_HOUR)).toBe("quiet");
    // No cap: every later day with enough unclassified time gets one notice.
    expect(stage("2026-10-09", "2026-10-10", "2026-10-21", HALF_HOUR)).toBe("notice");
  });

  it("persists marks per account and expiry", () => {
    const key = getTrialEndFollowUpKey("user-1", expired);
    const { result, rerender } = renderHook(({ today, seconds }) => useTrialEndFollowUp(key, today, seconds), {
      initialProps: { today: "2026-10-09", seconds: 0 },
    });
    expect(result.current.stage).toBe("sheet");
    act(() => result.current.markSheetSeen());
    expect(result.current.stage).toBe("quiet");
    rerender({ today: "2026-10-10", seconds: 2 * HALF_HOUR });
    expect(result.current.stage).toBe("notice");
    act(() => result.current.markNoticeSeen());
    expect(result.current.stage).toBe("quiet");

    const otherExpiry = getTrialEndFollowUpKey("user-1", { ...expired, trialEndsAt: "2026-11-20T05:30:00.000Z" });
    const later = renderHook(() => useTrialEndFollowUp(otherExpiry, "2026-11-21", 0));
    expect(later.result.current.stage).toBe("sheet");
  });

  it("asks nothing without a key", () => {
    const { result } = renderHook(() => useTrialEndFollowUp(null, "2026-10-09", 4 * HALF_HOUR));
    expect(result.current.stage).toBeNull();
  });
});
