import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureMock } = vi.hoisted(() => ({ captureMock: vi.fn() }));
vi.mock("../../lib/analytics/posthogClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/analytics/posthogClient")>();
  return { ...actual, capturePostHogDailyEvent: captureMock };
});

import { sanitizePostHogEventProperties } from "../../lib/analytics/events";
import {
  UPDATE_LAST_RUN_VERSION_STORAGE_KEY,
  reportUpdateAppliedSinceLastRun,
  reportUpdateStep,
} from "./updateAnalytics";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

beforeEach(() => {
  captureMock.mockClear();
});

describe("update analytics", () => {
  it("reports applied once, only when a launch runs a newer version", () => {
    const storage = memoryStorage();

    expect(reportUpdateAppliedSinceLastRun(storage, "1.12.1")).toBe(false);
    expect(storage.getItem(UPDATE_LAST_RUN_VERSION_STORAGE_KEY)).toBe("1.12.1");
    expect(reportUpdateAppliedSinceLastRun(storage, "1.12.1")).toBe(false);
    expect(captureMock).not.toHaveBeenCalled();

    expect(reportUpdateAppliedSinceLastRun(storage, "1.12.2")).toBe(true);
    expect(captureMock).toHaveBeenCalledExactlyOnceWith("app_update", expect.any(String), { update_step: "applied" });
    expect(reportUpdateAppliedSinceLastRun(storage, "1.12.2")).toBe(false);

    // A downgrade through the Dev version switcher is not an applied update.
    expect(reportUpdateAppliedSinceLastRun(storage, "1.12.0")).toBe(false);
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a storage failure away from the update path", () => {
    const failing = {
      getItem: () => { throw new Error("storage denied"); },
      setItem: vi.fn(),
    };
    expect(reportUpdateAppliedSinceLastRun(failing, "1.12.2")).toBe(false);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("sends only allowlisted enums and booleans, never error text", () => {
    reportUpdateStep("prepare_failed", {
      source: "automatic",
      backgroundUpdatesEnabled: true,
      backgroundEligible: false,
      error: new Error("request timed out for https://example.com/releases?token=secret"),
    });

    const [event, dedupKey, properties] = captureMock.mock.calls[0] ?? [];
    expect(event).toBe("app_update");
    expect(sanitizePostHogEventProperties("app_update", properties)).toEqual(properties);
    expect(properties).toMatchObject({
      update_step: "prepare_failed",
      update_source: "automatic",
      background_updates_enabled: true,
      background_eligible: false,
    });
    expect(JSON.stringify(properties)).not.toMatch(/example\.com|secret/);
    // Each property combination is capped separately per reporting day.
    expect(dedupKey).toContain("update_step=prepare_failed");
    expect(dedupKey).toContain("update_source=automatic");
  });
});
