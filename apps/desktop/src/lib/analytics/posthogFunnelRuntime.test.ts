// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv("MODE", "production");
  vi.stubEnv("VITE_DRIFTY_CHANNEL", "production");
  vi.stubEnv("VITE_POSTHOG_KEY", "test-project-key");
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.useFakeTimers();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("funnel production-path transport with intercepted network", () => {
  it("retains the existing install ID across account switches and sends only allowlisted properties", async () => {
    localStorage.setItem("drifty.posthog.installDistinctId.v2", "install_existing-fixture");
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState({ id: "account-one" });
    await runtime.capturePostHogInstallFunnelStep({ step: "classified_result_viewed", dashboard_period: "day" });
    runtime.recordPostHogAuthState({ id: "account-two" });
    await runtime.capturePostHogInstallFunnelStep({ step: "checkout_opened", billing_interval: "monthly" });
    const secondAccountId = await runtime.derivePostHogAccountDistinctId("account-two");
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, options]) => {
      const event = JSON.parse(String(options?.body));
      return event.event === "app_active" && event.distinct_id === secondAccountId;
    })).toBe(true));
    const requests = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    const funnel = requests.filter((request) => request.event === "pro_funnel_step");
    expect(funnel).toHaveLength(2);
    for (const event of funnel) {
      expect(event).toMatchObject({ event: "pro_funnel_step", distinct_id: "install_existing-fixture", properties: {
        identity_scope: "install", channel: "production", runtime: "tauri", "$process_person_profile": false, "$geoip_disable": true,
      } });
    }
    expect(JSON.stringify(funnel)).not.toMatch(/account-one|account-two|account_[a-f0-9]{64}/);
  });

  it("blocks initialization and all new traffic when off, and permits fresh events after enabling", async () => {
    const preference = await import("./productAnalyticsPreference");
    preference.writeProductAnalyticsEnabled(false);
    const runtime = await import("./posthog");
    expect(runtime.initializePostHog()).toBe(false);
    expect(await runtime.capturePostHogInstallFunnelStep({ step: "checkout_opened", billing_interval: "monthly" })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    preference.writeProductAnalyticsEnabled(true);
    expect(await runtime.capturePostHogInstallFunnelStep({ step: "checkout_opened", billing_interval: "monthly" })).toBe(true);
    vi.mocked(fetch).mockClear();
    preference.writeProductAnalyticsEnabled(false);
    runtime.capturePostHogEvent("app_opened");
    runtime.capturePostHogEvent("pro_funnel_step", { step: "classified_result_viewed", dashboard_period: "day" });
    runtime.recordPostHogAuthState({ id: "disabled-account" });
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revokes a lazy funnel import across opt-out and re-enable, then accepts a fresh attempt", async () => {
    const preference = await import("./productAnalyticsPreference");
    const { recordProFunnelStep } = await import("./proFunnel");
    const step = { step: "classified_result_viewed", dashboard_period: "day" } as const;
    const pending = recordProFunnelStep(step);
    preference.writeProductAnalyticsEnabled(false);
    preference.writeProductAnalyticsEnabled(true);
    expect(await pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(await recordProFunnelStep(step)).toBe(true);
  });

  it("does not send account-active measurement from a hash revoked while pending", async () => {
    let resolveHash!: (value: ArrayBuffer) => void;
    vi.stubGlobal("crypto", { randomUUID: () => "fixture", subtle: { digest: () => new Promise<ArrayBuffer>((resolve) => { resolveHash = resolve; }) } });
    const preference = await import("./productAnalyticsPreference");
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState({ id: "pending-account" });
    vi.mocked(fetch).mockClear();
    preference.writeProductAnalyticsEnabled(false);
    preference.writeProductAnalyticsEnabled(true);
    resolveHash(new Uint8Array(32).buffer);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
