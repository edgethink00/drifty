import { describe, expect, it, vi } from "vitest";
import { createProFunnelRecorder, recordProFunnelStep, type ProFunnelStep } from "./proFunnel";
import { createPostHogEventPayload, getOrCreatePostHogInstallDistinctId, resolvePostHogEventIdentity, sanitizePostHogEventProperties } from "./posthog";

const result: ProFunnelStep = { step: "classified_result_viewed", dashboard_period: "day" };
const offer: ProFunnelStep = { step: "pro_offer_viewed", offer_surface: "upgrade_modal", offer_context: "trial_ended" };

describe("install conversion observations", () => {
  it("deduplicates concurrent and repeated impressions by period type and offer in one renderer", async () => {
    const deliver = vi.fn().mockResolvedValue(true);
    const record = createProFunnelRecorder(deliver);
    await Promise.all([record(result), record(result)]);
    await record(result);
    expect(deliver).toHaveBeenCalledTimes(1);
    await record({ ...result, dashboard_period: "week" });
    await record(offer);
    await record({ ...offer, offer_surface: "sidebar" });
    expect(deliver).toHaveBeenCalledTimes(4);
    // No account argument or per-account deduplication state exists.
    expect(deliver).toHaveBeenNthCalledWith(1, result);
  });

  it("does not consume failed impressions", async () => {
    const deliver = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    const record = createProFunnelRecorder(deliver);
    expect(await record(result)).toBe(false);
    expect(await record(result)).toBe(false);
    expect(await record(result)).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(3);
  });

  it("starts a fresh attempt after re-enable without joining a revoked pending delivery", async () => {
    let revision = 0;
    const pending: Array<(ok: boolean) => void> = [];
    const deliver = vi.fn(() => new Promise<boolean>((resolve) => { pending.push(resolve); }));
    const record = createProFunnelRecorder(deliver, () => revision);
    const oldAttempt = record(result);
    revision = 2;
    const freshAttempt = record(result);
    expect(deliver).toHaveBeenCalledTimes(2);
    pending[0](false);
    expect(await oldAttempt).toBe(false);
    // Completing the old request must not clear the fresh request's key.
    const concurrentFreshAttempt = record(result);
    expect(deliver).toHaveBeenCalledTimes(2);
    pending[1](true);
    expect(await freshAttempt).toBe(true);
    expect(await concurrentFreshAttempt).toBe(true);
    expect(await record(result)).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("uses install attribution even when an account identity exists", () => {
    const install = { distinctId: "install_a", scope: "install" } as const;
    const account = { distinctId: "account_a", scope: "account" } as const;
    expect(resolvePostHogEventIdentity("pro_funnel_step", install, account)).toBe(install);
    expect(resolvePostHogEventIdentity("pro_funnel_step", null, account)).toBeNull();
    expect(resolvePostHogEventIdentity("billing_action", install, account)).toBe(install);
    expect(resolvePostHogEventIdentity("app_active", install, account)).toBe(account);
  });

  it("counts separate checkout-opening attempts instead of deduplicating purchases", async () => {
    const deliver = vi.fn().mockResolvedValue(true);
    const record = createProFunnelRecorder(deliver);
    await record({ step: "checkout_opened", billing_interval: "monthly" });
    await record({ step: "checkout_opened", billing_interval: "monthly" });
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("counts each trial-end action, so a daily notice's dismissals are not folded into one", async () => {
    const deliver = vi.fn().mockResolvedValue(true);
    const record = createProFunnelRecorder(deliver);
    const dismissed: ProFunnelStep = { step: "pro_offer_acted", offer_surface: "trial_end_notice", offer_context: "trial_ended", offer_action: "dismiss" };
    await record(dismissed);
    await record(dismissed);
    expect(deliver).toHaveBeenCalledTimes(2);
    const payload = sanitizePostHogEventProperties("pro_funnel_step", { ...dismissed, selected_day: "2026-10-10", focus_seconds: 10 });
    expect(payload).toMatchObject(dismissed);
    expect(payload).not.toHaveProperty("selected_day");
  });

  it("keeps only enums and does not add account, order or activity properties", () => {
    const distinctId = getOrCreatePostHogInstallDistinctId(null, () => "fixture");
    const payload = createPostHogEventPayload({ apiKey: "test", distinctId, identityScope: "install", event: "pro_funnel_step", properties: sanitizePostHogEventProperties("pro_funnel_step", {
      ...offer, email: "private@example.com", account_id: "user-1", checkout_url: "https://private", window_title: "Secret", selected_day: "2026-09-01", focus_seconds: 10,
    }) });
    expect(distinctId).toBe("install_fixture");
    expect(payload.properties).toMatchObject({ ...offer, identity_scope: "install", "$process_person_profile": false });
    for (const key of ["email", "account_id", "checkout_url", "window_title", "selected_day", "focus_seconds"]) expect(payload.properties).not.toHaveProperty(key);
  });

  it("never sends real traffic in a test/browser runtime", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await recordProFunnelStep(result)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
