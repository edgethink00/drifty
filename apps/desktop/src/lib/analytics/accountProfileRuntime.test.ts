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
  vi.spyOn(window, "addEventListener");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T01:00:00.000Z"));
});
afterEach(() => {
  for (const [event, listener, options] of vi.mocked(window.addEventListener).mock.calls) {
    window.removeEventListener(event, listener, options);
  }
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

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

  it("retries a failed plan update when an earlier identify completed without that plan", async () => {
    let finishIdentify!: (response: { ok: boolean }) => void;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      if (request.event === "$identify") {
        return new Promise<Response>((resolve) => { finishIdentify = (response) => resolve(response as Response); });
      }
      return { ok: request.event !== "$set" } as Response;
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    await vi.waitFor(() => expect(finishIdentify).toBeTypeOf("function"));
    expect(sentRequests().find((request) => request.event === "$identify").properties.$set).not.toHaveProperty("plan");

    runtime.recordPostHogAccountPlan(account.id, "pro");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$set")).toHaveLength(0);
    finishIdentify({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$set")).toHaveLength(1);
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBeNull();

    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    runtime.recordPostHogAccountPlan(account.id, "pro");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$set")).toHaveLength(2);
    const delivered = localStorage.getItem("drifty.posthog.accountPlan.v1");
    expect(delivered).toBe(`${await runtime.derivePostHogAccountDistinctId(account.id)}:pro`);
    runtime.recordPostHogAccountPlan(account.id, "pro");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$set")).toHaveLength(2);
  });

  it("uses refreshed same-account contact fields on the next day without extra same-day events", async () => {
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    await vi.waitFor(() => expect(sentRequests().some((request) => request.event === "$identify")).toBe(true));
    await vi.advanceTimersByTimeAsync(0);
    runtime.recordPostHogAuthState({ ...account, email: "new@example.com", user_metadata: { full_name: "Renamed", window_title: "private" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$identify")).toHaveLength(1);
    expect(sentRequests().filter((request) => request.event === "auth_state_changed")).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-31T01:00:00.000Z"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    const identifies = sentRequests().filter((request) => request.event === "$identify");
    expect(identifies).toHaveLength(2);
    expect(identifies[1].properties.$set).toMatchObject({ email: "new@example.com", name: "Renamed" });
    expect(JSON.stringify(identifies[1])).not.toContain("window_title");
    expect(JSON.stringify(identifies[1])).not.toContain(account.email);
  });

  it.each([["$identify", false], ["$set", false], ["$set", true]] as const)("keeps the server's latest plan when an older %s finishes late (pro previously delivered: %s)", async (heldEvent, proPreviouslyDelivered) => {
    let finishOldRequest!: () => void;
    const lastAppliedPlan = new Map<string, string>();
    const applied: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      const plan = request.properties.$set?.plan;
      const apply = () => {
        if (plan) {
          lastAppliedPlan.set(request.distinct_id, plan);
          applied.push(`${request.event}:${plan}`);
        }
        return { ok: true } as Response;
      };
      if (request.event === heldEvent && plan === "trial") {
        return new Promise<Response>((resolve) => { finishOldRequest = () => resolve(apply()); });
      }
      return apply();
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    if (heldEvent === "$set") {
      await vi.waitFor(() => expect(sentRequests().some((request) => request.event === "$identify")).toBe(true));
      await vi.advanceTimersByTimeAsync(0);
    }
    if (proPreviouslyDelivered) {
      runtime.recordPostHogAccountPlan(account.id, "pro");
      await vi.advanceTimersByTimeAsync(0);
      applied.length = 0;
    }
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.waitFor(() => expect(finishOldRequest).toBeTypeOf("function"));
    runtime.recordPostHogAccountPlan(account.id, "pro");
    runtime.recordPostHogAccountPlan(account.id, "pro");
    await vi.advanceTimersByTimeAsync(0);
    // The interceptor applies any newer requests first if the runtime allows
    // overlap, then the held old payload overwrites the simulated server.
    finishOldRequest();
    await vi.advanceTimersByTimeAsync(0);
    const accountId = await runtime.derivePostHogAccountDistinctId(account.id);
    expect({ lastAppliedPlan: lastAppliedPlan.get(accountId), applied }).toEqual({
      lastAppliedPlan: "pro",
      applied: [`${heldEvent}:trial`, "$set:pro"],
    });
    runtime.recordPostHogAccountPlan(account.id, "pro");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    expect(applied).toEqual([`${heldEvent}:trial`, "$set:pro"]);
    expect(sentRequests().filter((request) => request.event === "$identify")).toHaveLength(1);
  });

  it.each(["account switch", "sign-out"])("drops queued old-account updates after %s", async (change) => {
    let finishIdentify!: () => void;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      if (request.event === "$identify") {
        return new Promise<Response>((resolve) => { finishIdentify = () => resolve({ ok: true } as Response); });
      }
      return { ok: request.event !== "$set" } as Response;
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.waitFor(() => expect(finishIdentify).toBeTypeOf("function"));
    expect(sentRequests().find((request) => request.event === "$identify").properties.$set.plan).toBe("trial");

    runtime.recordPostHogAccountPlan(account.id, "pro");
    if (change === "account switch") runtime.recordPostHogAuthState({ id: "second-account" });
    else runtime.recordPostHogAuthState(null);
    await vi.advanceTimersByTimeAsync(0);
    finishIdentify();
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBeNull();
    expect(sentRequests().filter((request) => request.event === "$set")).toHaveLength(0);
  });

  it("retries the latest plan after the ordered plan update fails", async () => {
    let finishIdentify!: () => void;
    let lastAppliedPlan: string | null = null;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      if (request.event === "$identify") {
        return new Promise<Response>((resolve) => {
          finishIdentify = () => {
            lastAppliedPlan = request.properties.$set.plan;
            resolve({ ok: true } as Response);
          };
        });
      }
      return { ok: request.event !== "$set" } as Response;
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.waitFor(() => expect(finishIdentify).toBeTypeOf("function"));
    runtime.recordPostHogAccountPlan(account.id, "pro");
    finishIdentify();
    await vi.advanceTimersByTimeAsync(0);
    const accountId = await runtime.derivePostHogAccountDistinctId(account.id);
    expect(lastAppliedPlan).toBe("trial");
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBeNull();

    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      lastAppliedPlan = JSON.parse(String(options?.body)).properties.$set.plan;
      return { ok: true } as Response;
    });
    runtime.recordPostHogAccountPlan(account.id, "pro");
    await vi.advanceTimersByTimeAsync(0);
    expect(lastAppliedPlan).toBe("pro");
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBe(`${accountId}:pro`);
  });

  it("resends a previously delivered plan after an intervening write applies but loses its response", async () => {
    let finishTrial!: () => void;
    let lastAppliedPlan: string | null = null;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      const plan = request.properties.$set?.plan;
      if (plan === "trial") {
        return new Promise<Response>((_resolve, reject) => {
          finishTrial = () => { lastAppliedPlan = plan; reject(new Error("response lost fixture")); };
        });
      }
      if (plan) lastAppliedPlan = plan;
      return { ok: true } as Response;
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    await vi.waitFor(() => expect(sentRequests().some((request) => request.event === "$identify")).toBe(true));
    runtime.recordPostHogAccountPlan(account.id, "pro");
    await vi.advanceTimersByTimeAsync(0);
    expect(lastAppliedPlan).toBe("pro");
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.advanceTimersByTimeAsync(0);
    runtime.recordPostHogAccountPlan(account.id, "pro");
    finishTrial();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastAppliedPlan).toBe("pro");
    expect(sentRequests().filter((request) => request.event === "$set").map((request) => request.properties.$set.plan)).toEqual(["pro", "trial", "pro"]);
  });

  it("allows the new account to sync while an old account's person request is pending", async () => {
    let finishOldIdentify!: () => void;
    const lastAppliedPlan = new Map<string, string>();
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      const plan = request.properties.$set?.plan;
      if (request.event === "$identify" && plan === "trial") {
        return new Promise<Response>((resolve) => {
          finishOldIdentify = () => {
            lastAppliedPlan.set(request.distinct_id, plan);
            resolve({ ok: true } as Response);
          };
        });
      }
      if (plan) lastAppliedPlan.set(request.distinct_id, plan);
      return { ok: true } as Response;
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.waitFor(() => expect(finishOldIdentify).toBeTypeOf("function"));
    runtime.recordPostHogAccountPlan(account.id, "pro");
    const secondAccount = { ...account, id: "second-account", email: "second@example.com" };
    runtime.recordPostHogAuthState(secondAccount);
    runtime.recordPostHogAccountPlan(secondAccount.id, "pro");
    const secondId = await runtime.derivePostHogAccountDistinctId(secondAccount.id);
    await vi.waitFor(() => expect(lastAppliedPlan.get(secondId)).toBe("pro"));
    finishOldIdentify();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastAppliedPlan.get(secondId)).toBe("pro");
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBe(`${secondId}:pro`);
    expect(sentRequests().filter((request) => request.event === "$set")).toHaveLength(0);
  });

  it.each([false, true])("revokes queued plan writes when analytics is disabled (then re-enabled: %s)", async (reEnable) => {
    let finishIdentify!: () => void;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      if (request.event === "$identify" && request.properties.$set.plan === "trial") {
        return new Promise<Response>((resolve) => { finishIdentify = () => resolve({ ok: true } as Response); });
      }
      return { ok: true } as Response;
    });
    const preference = await import("./productAnalyticsPreference");
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.waitFor(() => expect(finishIdentify).toBeTypeOf("function"));
    runtime.recordPostHogAccountPlan(account.id, "pro");
    preference.writeProductAnalyticsEnabled(false);
    if (reEnable) preference.writeProductAnalyticsEnabled(true);
    const countBeforeCompletion = sentRequests().length;
    finishIdentify();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests()).toHaveLength(countBeforeCompletion);
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBeNull();
    expect(localStorage.getItem("drifty.posthog.dailyEventLedger.v1")).toBeNull();
    if (reEnable) {
      runtime.recordPostHogAccountPlan(account.id, "pro");
      await vi.advanceTimersByTimeAsync(0);
      expect(sentRequests().filter((request) => request.event === "$set").map((request) => request.properties.$set.plan)).toEqual(["pro"]);
    }
  });

  it("uses the freshest profile when daily identification waits behind a plan request", async () => {
    let finishPlan!: () => void;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      if (JSON.parse(String(options?.body)).event === "$set") {
        return new Promise<Response>((resolve) => { finishPlan = () => resolve({ ok: true } as Response); });
      }
      return { ok: true } as Response;
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    await vi.waitFor(() => expect(sentRequests().some((request) => request.event === "$identify")).toBe(true));
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date("2026-10-31T01:00:00.000Z"));
    window.dispatchEvent(new Event("focus"));
    runtime.recordPostHogAuthState({ ...account, email: "fresh@example.com", user_metadata: { full_name: "Fresh" } });
    finishPlan();
    await vi.advanceTimersByTimeAsync(0);
    const identifies = sentRequests().filter((request) => request.event === "$identify");
    expect(identifies).toHaveLength(2);
    expect(identifies[1].properties.$set).toMatchObject({ email: "fresh@example.com", name: "Fresh", plan: "trial" });
  });

  it.each(["http", "network"])("retries same-account identification after a %s failure without marking the plan delivered", async (failure) => {
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      if (request.event === "$identify" && failure === "network") throw new Error("offline fixture");
      return { ok: request.event !== "$identify" && request.event !== "$set" } as Response;
    });
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState(account);
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.waitFor(() => expect(sentRequests().some((request) => request.event === "$identify")).toBe(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBeNull();
    expect(localStorage.getItem("drifty.posthog.dailyEventLedger.v1")).toBeNull();

    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    runtime.recordPostHogAuthState(account);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$identify")).toHaveLength(2);
    expect(localStorage.getItem("drifty.posthog.accountPlan.v1")).toBe(`${await runtime.derivePostHogAccountDistinctId(account.id)}:trial`);
    runtime.recordPostHogAccountPlan(account.id, "trial");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$set")).toHaveLength(1);
  });

  it("identifies when fresh same-account data supplies a missing email without repeating auth events", async () => {
    const runtime = await import("./posthog");
    runtime.initializePostHog();
    runtime.recordPostHogAuthState({ id: account.id });
    await vi.waitFor(() => expect(sentRequests().filter((request) => request.event === "app_active")).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$identify")).toHaveLength(0);

    runtime.recordPostHogAuthState(account);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$identify")).toHaveLength(1);
    expect(sentRequests().find((request) => request.event === "$identify").properties.$set.email).toBe(account.email);
    expect(sentRequests().filter((request) => request.event === "auth_state_changed")).toHaveLength(1);
    runtime.recordPostHogAuthState(account);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRequests().filter((request) => request.event === "$identify")).toHaveLength(1);
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
