import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  getSession: vi.fn(),
  functionInvoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: mocks.isTauri }));
vi.mock("../../lib/supabase/client", () => ({ supabase: {
  auth: { getSession: mocks.getSession }, functions: { invoke: mocks.functionInvoke },
} }));
vi.mock("../cloud-devices/cloudDeviceIdentity", () => ({
  withCloudDevicePayload: async (body: object) => ({ ...body, trialActivation: "explicit-v1" }),
}));

import { BILLING_ENTITLEMENT_TIMEOUT_MS, fetchBillingEntitlement } from "./billingService";

const entitlement = {
  plan: "individual", status: "active", canUseApp: true,
  trialEndsAt: null, currentPeriodEnd: null,
};
const success = { status: 200, body: JSON.stringify({ entitlement }) };

describe("native entitlement reads on legacy servers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "https://qa.supabase.co/");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "synthetic-anon");
    mocks.isTauri.mockReturnValue(true);
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "synthetic-session" } } });
    // A missing endpoint's failed preflight cannot expose HTTP 404 to the SDK.
    mocks.functionInvoke.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("recovers from a confirmed gateway 404 without depending on WebView CORS", async () => {
    mocks.invoke.mockResolvedValueOnce({ status: 404, body: '{"code":"NOT_FOUND"}' })
      .mockResolvedValueOnce(success);
    expect(await fetchBillingEntitlement()).toEqual({ success: true, data: entitlement });
    expect(mocks.invoke.mock.calls.map(([, args]) => args.request.url)).toEqual([
      "https://qa.supabase.co/functions/v1/get-cloud-trial-entitlement",
      "https://qa.supabase.co/functions/v1/get-billing-entitlement",
    ]);
    expect(mocks.functionInvoke).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("cloud_sync_http_post", { request: {
      url: "https://qa.supabase.co/functions/v1/get-cloud-trial-entitlement",
      bearerToken: "synthetic-session", apikey: "synthetic-anon",
      bodyJson: { trialActivation: "explicit-v1" }, timeoutMs: BILLING_ENTITLEMENT_TIMEOUT_MS,
    } });
  });

  it.each([401, 429, 500, 503])("does not auto-grant through a fallback after HTTP %s", async (status) => {
    mocks.invoke.mockResolvedValue({ status, body: '{"error":"Unavailable"}' });
    expect(await fetchBillingEntitlement()).toEqual({ success: false, error: "Unavailable" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after a transport failure", async () => {
    mocks.invoke.mockRejectedValue(new Error("Network unavailable"));
    expect(await fetchBillingEntitlement()).toEqual({ success: false, error: "Network unavailable" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("bounds a hung native read and never starts a legacy trial after timeout", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const result = fetchBillingEntitlement();
    await vi.advanceTimersByTimeAsync(BILLING_ENTITLEMENT_TIMEOUT_MS + 1);
    expect(await result).toEqual({ success: false, error: "Cloud entitlement timed out. Try again." });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed successful responses without falling back", async () => {
    mocks.invoke.mockResolvedValue({ status: 200, body: "invalid JSON" });
    expect((await fetchBillingEntitlement()).success).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not transmit a request when signed out", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    expect(await fetchBillingEntitlement()).toEqual({ success: false, error: "Sign in to check billing status." });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps browser reads on the existing Supabase transport", async () => {
    mocks.isTauri.mockReturnValue(false);
    mocks.functionInvoke.mockResolvedValue({ data: { entitlement }, error: null });
    expect((await fetchBillingEntitlement()).success).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.functionInvoke).toHaveBeenCalledTimes(1);
  });
});
