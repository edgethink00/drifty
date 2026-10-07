// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingEntitlement } from "./billingService";
import { buildNativeTrialStatus, safeInvokeTrialStatus, useNativeTrialStatus } from "./useNativeTrialStatus";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
const trial: BillingEntitlement = {
  plan: "individual", status: "trialing", canUseApp: true, trialEndsAt: "2026-10-10T00:00:00Z", currentPeriodEnd: null,
};
const reset = { trialEndsAt: null, trialExpired: false };
describe("native trial status", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });

  it("maps only confirmed individual trials and expiry, leaving the native clock to compute remaining days", () => {
    expect(buildNativeTrialStatus(trial, true)).toEqual({ trialEndsAt: "2026-10-10T00:00:00.000Z", trialExpired: false });
    const expired: BillingEntitlement = { ...trial, status: "locked", canUseApp: false, lockedReason: "trial_expired" };
    expect(buildNativeTrialStatus(expired, true)).toEqual({ trialEndsAt: "2026-10-10T00:00:00.000Z", trialExpired: true });
    expect(buildNativeTrialStatus({ ...expired, trialEndsAt: null }, true)).toEqual({ trialEndsAt: null, trialExpired: true });
    for (const entitlement of [null, { ...trial, status: "active" as const }, { ...trial, trialEndsAt: "invalid" },
      { ...trial, entitlementOwner: "organization" as const },
      ...(["payment_required", "billing_missing", "device_limit_reached"] as const).map((lockedReason) => ({ ...expired, lockedReason }))]) {
      expect(buildNativeTrialStatus(entitlement, true)).toEqual(reset);
    }
    expect(buildNativeTrialStatus(trial, false)).toEqual(reset);
  });

  it("serializes an in-flight trial update before sign-out reset", async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { rerender } = renderHook(({ confirmed }) => useNativeTrialStatus(trial, confirmed), { initialProps: { confirmed: true } });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    rerender({ confirmed: false });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("tray_update_trial_status", reset));
  });

  it("keeps browser runs free of native invokes and recovers the queue after a native failure", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    await safeInvokeTrialStatus(reset);
    expect(invoke).not.toHaveBeenCalled();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("native unavailable"));
    const { rerender } = renderHook(({ confirmed }) => useNativeTrialStatus(trial, confirmed), { initialProps: { confirmed: true } });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    rerender({ confirmed: false });
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("tray_update_trial_status", reset));
  });
  it("retries a failed sign-out reset without waiting for another entitlement change", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("transient IPC failure"));
    renderHook(() => useNativeTrialStatus(null, false));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("tray_update_trial_status", reset);
  });

  it("bounds permanent native failure to three attempts", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockRejectedValue(new Error("native unavailable"));
    renderHook(() => useNativeTrialStatus(null, false));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

});
