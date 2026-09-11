import { describe, expect, it, vi } from "vitest";
import { createDeferredPostHogClient, type PostHogClientRuntime } from "./posthogClient";

function createRuntime(): PostHogClientRuntime {
  return {
    initializePostHog: vi.fn(() => true),
    capturePostHogEvent: vi.fn(),
    capturePostHogDailyEvent: vi.fn(),
    recordPostHogAuthState: vi.fn(),
  };
}

describe("deferred PostHog client", () => {
  it("initializes the runtime before replaying startup analytics in order", () => {
    const calls: string[] = [];
    const runtime = {
      initializePostHog: vi.fn(() => {
        calls.push("initialize");
        return true;
      }),
      capturePostHogEvent: vi.fn(() => {
        calls.push("capture");
      }),
      capturePostHogDailyEvent: vi.fn(() => {
        calls.push("capture-daily");
      }),
      recordPostHogAuthState: vi.fn(() => {
        calls.push("auth");
      }),
    } as PostHogClientRuntime;
    const client = createDeferredPostHogClient(100, () => true);

    client.capturePostHogEvent("app_surface_opened", { surface: "dashboard" });
    client.recordPostHogAuthState({ id: "account-1", is_anonymous: false });

    expect(client.connect(runtime)).toBe(true);
    expect(calls).toEqual(["initialize", "capture", "auth"]);
  });

  it("forwards analytics immediately after the runtime connects", () => {
    const runtime = createRuntime();
    const client = createDeferredPostHogClient(100, () => true);

    client.connect(runtime);
    client.capturePostHogEvent("app_error", {
      surface: "dashboard",
      error_kind: "unknown",
    });

    expect(runtime.capturePostHogEvent).toHaveBeenCalledWith("app_error", {
      surface: "dashboard",
      error_kind: "unknown",
    });
  });

  it("bounds the startup queue and retains the most recent operations", () => {
    const runtime = createRuntime();
    const client = createDeferredPostHogClient(2, () => true);

    client.capturePostHogEvent("app_surface_opened", { surface: "dashboard" });
    client.capturePostHogEvent("app_surface_opened", { surface: "history" });
    client.capturePostHogEvent("app_surface_opened", { surface: "trends" });
    client.connect(runtime);

    expect(runtime.capturePostHogEvent).toHaveBeenCalledTimes(2);
    expect(runtime.capturePostHogEvent).toHaveBeenNthCalledWith(1, "app_surface_opened", {
      surface: "history",
    });
    expect(runtime.capturePostHogEvent).toHaveBeenNthCalledWith(2, "app_surface_opened", {
      surface: "trends",
    });
  });

  it("drops deferred events across opt-out and restores only the latest auth state", () => {
    let enabled = true;
    const runtime = createRuntime();
    const client = createDeferredPostHogClient(100, () => enabled);

    client.capturePostHogEvent("app_surface_opened", { surface: "dashboard" });
    client.recordPostHogAuthState({ id: "account-before-opt-out", is_anonymous: false });
    enabled = false;
    client.handlePreferenceChange(false);
    client.capturePostHogEvent("app_surface_opened", { surface: "history" });
    client.recordPostHogAuthState({ id: "account-after-opt-out", is_anonymous: false });

    expect(client.connect(runtime)).toBe(false);
    expect(runtime.initializePostHog).not.toHaveBeenCalled();
    expect(runtime.capturePostHogEvent).not.toHaveBeenCalled();
    expect(runtime.recordPostHogAuthState).not.toHaveBeenCalled();

    enabled = true;
    client.handlePreferenceChange(true);
    expect(client.connect(runtime)).toBe(true);
    expect(runtime.capturePostHogEvent).not.toHaveBeenCalled();
    expect(runtime.recordPostHogAuthState).toHaveBeenCalledTimes(1);
    expect(runtime.recordPostHogAuthState).toHaveBeenCalledWith({
      id: "account-after-opt-out",
      is_anonymous: false,
    });
  });

  it("does not duplicate a queued auth state when the runtime first connects", () => {
    const runtime = createRuntime();
    const client = createDeferredPostHogClient(100, () => true);
    client.recordPostHogAuthState({ id: "account-1", is_anonymous: false });

    expect(client.connect(runtime)).toBe(true);
    expect(runtime.recordPostHogAuthState).toHaveBeenCalledTimes(1);
  });
});
