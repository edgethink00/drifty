// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("drifty.posthog.installDistinctId.v2", "install_fixture");
  vi.stubEnv("MODE", "production");
  vi.stubEnv("VITE_DRIFTY_CHANNEL", "production");
  vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "windows");
  vi.stubEnv("VITE_POSTHOG_KEY", "test-project-key");
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T01:00:00.000Z"));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "person@example.com",
  created_at: "2026-09-01T00:00:00Z",
  user_metadata: { full_name: "Ari Kim" },
};

function sentRequests() {
  return vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
}

describe("PostHog account profile with intercepted network", () => {
  it("identifies a signed-in account once a day and keeps product events personless", async () => {
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    const accountId = await runtime.derivePostHogAccountDistinctId(account.id);
    await vi.waitFor(() => expect(sentRequests().some((request) => request.event === "$identify")).toBe(true));

    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    runtime.capturePostHogEvent("app_surface_opened", { surface: "dashboard" });

    const requests = sentRequests();
    const identifies = requests.filter((request) => request.event === "$identify");
    expect(identifies).toHaveLength(1);
    expect(identifies[0]).toMatchObject({
      distinct_id: accountId,
      properties: {
        $anon_distinct_id: "install_fixture",
        $set: { email: "person@example.com", name: "Ari Kim", platform: "windows" },
        $set_once: { signup_at: "2026-09-01T00:00:00.000Z" },
      },
    });
    expect(JSON.stringify(identifies)).not.toContain(account.id);
    for (const request of requests.filter((item) => item.event !== "$identify")) {
      expect(request.properties.$process_person_profile).toBe(false);
      expect(JSON.stringify(request)).not.toContain("person@example.com");
    }
  });

  it("sends the plan once per change and only for the signed-in account", async () => {
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    await vi.waitFor(() => expect(sentRequests().some((request) => request.event === "$identify")).toBe(true));

    runtime.recordPostHogAccountPlan(account.id, "trial");
    runtime.recordPostHogAccountPlan("someone-else", "pro");
    await vi.advanceTimersByTimeAsync(0);
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.advanceTimersByTimeAsync(0);
    runtime.recordPostHogAccountPlan(account.id, "pro");
    await vi.advanceTimersByTimeAsync(0);

    const plans = sentRequests().filter((request) => request.event === "$set").map((request) => request.properties.$set.plan);
    expect(plans).toEqual(["trial", "pro"]);
  });

  it("sends no person data for anonymous accounts or with product analytics off", async () => {
    const preference = await import("./productAnalyticsPreference");
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState({ ...account, id: "anonymous-1", is_anonymous: true });
    await vi.advanceTimersByTimeAsync(0);
    preference.writeProductAnalyticsEnabled(false);
    runtime.recordPostHogAuthState(account);
    runtime.recordPostHogAccountPlan(account.id, "pro");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);

    expect(sentRequests().filter((request) => request.event === "$identify" || request.event === "$set")).toEqual([]);
    expect(JSON.stringify(sentRequests())).not.toContain("person@example.com");
  });
});
