// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  capturePostHogEvent: vi.fn(),
  initializePostHog: vi.fn(() => true),
  recordPostHogAuthState: vi.fn(),
}));

vi.mock("./posthog", () => runtimeMocks);

import {
  PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY,
  writeProductAnalyticsEnabled,
} from "./productAnalyticsPreference";

describe("exported PostHog client preference integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem(PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY, "0");
  });

  it("resumes after enable and drops work from an invalidated lazy-load attempt", async () => {
    const client = await import("./posthogClient");

    expect(await client.initializePostHogClient()).toBe(false);
    client.capturePostHogEvent("app_surface_opened", { surface: "dashboard" });
    expect(runtimeMocks.initializePostHog).not.toHaveBeenCalled();
    expect(runtimeMocks.capturePostHogEvent).not.toHaveBeenCalled();

    writeProductAnalyticsEnabled(true, window.localStorage);
    await vi.waitFor(() => expect(runtimeMocks.initializePostHog).toHaveBeenCalledTimes(1));
    client.capturePostHogEvent("app_error", {
      surface: "dashboard",
      error_kind: "unknown",
    });
    expect(runtimeMocks.capturePostHogEvent).toHaveBeenCalledWith("app_error", {
      surface: "dashboard",
      error_kind: "unknown",
    });

    writeProductAnalyticsEnabled(false, window.localStorage);
    writeProductAnalyticsEnabled(true, window.localStorage);
    writeProductAnalyticsEnabled(false, window.localStorage);
    client.capturePostHogEvent("app_surface_opened", { surface: "history" });
    writeProductAnalyticsEnabled(true, window.localStorage);
    client.capturePostHogEvent("app_surface_opened", { surface: "trends" });

    await vi.waitFor(() => {
      expect(runtimeMocks.initializePostHog).toHaveBeenCalledTimes(2);
      expect(runtimeMocks.capturePostHogEvent).toHaveBeenCalledWith(
        "app_surface_opened",
        { surface: "trends" },
      );
    });
    expect(runtimeMocks.capturePostHogEvent).not.toHaveBeenCalledWith(
      "app_surface_opened",
      { surface: "history" },
    );
  });
});
