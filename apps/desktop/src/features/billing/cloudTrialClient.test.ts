import { afterEach, describe, expect, it, vi } from "vitest";
import { BILLING_ENTITLEMENT_TIMEOUT_MS, canStartCloudTrial, fetchBillingEntitlement, startCloudTrial, type BillingEntitlement } from "./billingService";

const available: BillingEntitlement = {
  plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null,
  lockedReason: "billing_missing", trialActivation: { state: "available", startedAt: null, endsAt: null },
};

describe("Cloud trial client contract", () => {
  afterEach(() => vi.useRealTimers());
  it("uses the non-activating getter for an unstarted account", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { entitlement: available }, error: null });
    expect(await fetchBillingEntitlement({ functions: { invoke } })).toEqual({ success: true, data: available });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("get-cloud-trial-entitlement", {
      body: { emailLocale: "en", trialActivation: "explicit-v1" }, timeout: BILLING_ENTITLEMENT_TIMEOUT_MS, signal: expect.any(AbortSignal),
    });
    expect(canStartCloudTrial(available)).toBe(true);
    expect(canStartCloudTrial({ ...available, lockedReason: "trial_expired" })).toBe(false);
    expect(canStartCloudTrial({ ...available, lockedReason: "device_limit_reached" })).toBe(false);
  });

  it("asks for the welcome email in the app's display language", async () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => key === "drifty.displayLanguage.v2" ? "ko" : null },
      navigator: { language: "en-US", languages: ["en-US"] },
    });
    try {
      const invoke = vi.fn().mockResolvedValue({ data: { entitlement: available }, error: null });
      await fetchBillingEntitlement({ functions: { invoke } });
      expect(invoke.mock.calls[0][1].body).toEqual({ emailLocale: "ko", trialActivation: "explicit-v1" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves older servers only when the new endpoint does not exist", async () => {
    const legacy = { ...available, trialActivation: undefined };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { context: { status: 404 } } })
      .mockResolvedValueOnce({ data: { entitlement: legacy }, error: null });
    expect((await fetchBillingEntitlement({ functions: { invoke } })).success).toBe(true);
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["get-cloud-trial-entitlement", "get-billing-entitlement"]);
  });

  it.each([401, 429, 500, 503, undefined])("does not invoke an auto-granting legacy getter after failure %s", async (status) => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { context: { status, json: async () => ({ error: "Unavailable" }) } } });
    expect(await fetchBillingEntitlement({ functions: { invoke } })).toEqual({ success: false, error: "Unavailable" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed availability rather than promising another trial", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { entitlement: {
      ...available, trialActivation: { state: "available", startedAt: "2026-09-01T00:00:00Z", endsAt: null },
    } }, error: null });
    expect((await fetchBillingEntitlement({ functions: { invoke } })).success).toBe(false);
  });

  it("sends an explicit activation only through the start endpoint and never falls back", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    expect((await startCloudTrial({ functions: { invoke } })).success).toBe(false);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("start-cloud-trial", {
      body: { activation: "explicit-v1", trialActivation: "explicit-v1" }, timeout: 20_000, signal: expect.any(AbortSignal),
    });
  });

  it.each([fetchBillingEntitlement, startCloudTrial])("bounds hung calls and never falls back after timeout", async (operation) => {
    vi.useFakeTimers();
    const invoke = vi.fn().mockReturnValue(new Promise(() => {}));
    const result = operation({ functions: { invoke } });
    await vi.advanceTimersByTimeAsync(BILLING_ENTITLEMENT_TIMEOUT_MS + 1);
    expect(await result).toEqual({ success: false, error: "Cloud entitlement timed out. Try again." });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].signal.aborted).toBe(true);
  });

  const active = {
    ...available, canUseApp: true, status: "trialing" as const,
    trialActivation: { state: "started" as const, startedAt: "2026-09-14T00:00:00Z", endsAt: "2026-09-21T00:00:00Z" },
  };
  const allowed = { allowed: true, reason: null, message: null, activeDeviceCount: 1, maxActiveDevices: 2, activeWindowDays: 30, deviceId: "device-1" };

  it.each([undefined, {}, { ...allowed, allowed: false, reason: "unavailable" }, { ...allowed, deviceId: null }])(
    "does not accept a start without confirmed device admission (%j)", async (deviceAccess) => {
      const invoke = vi.fn().mockResolvedValue({ data: { entitlement: active, deviceAccess }, error: null });
      expect((await startCloudTrial({ functions: { invoke } })).success).toBe(false);
    },
  );
  it("rejects denied-device usable-access contradictions on reads as well", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { entitlement: active, deviceAccess: { ...allowed, allowed: false, reason: "device_limit_reached" } }, error: null });
    expect((await fetchBillingEntitlement({ functions: { invoke } })).success).toBe(false);
  });
  it("accepts a grant with authoritative period and device admission", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { entitlement: active, deviceAccess: allowed }, error: null });
    expect(await startCloudTrial({ functions: { invoke } })).toMatchObject({ success: true, data: { trialActivation: active.trialActivation, deviceAccess: allowed } });
  });
});
