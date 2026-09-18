// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_PERIOD_STORAGE_KEY,
  NAVIGATION_REFRESH_STORAGE_KEY,
  persistDashboardPeriod,
  persistNavigationRefreshEnabled,
  resolveInitialDashboardPeriod,
  resolveInitialNavigationRefreshEnabled,
} from "./settingsStorage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("navigation refresh preference", () => {
  it("defaults off and only accepts an explicit opt-in", () => {
    expect(resolveInitialNavigationRefreshEnabled()).toBe(false);
    window.localStorage.setItem(NAVIGATION_REFRESH_STORAGE_KEY, "true");
    expect(resolveInitialNavigationRefreshEnabled()).toBe(false);
    window.localStorage.setItem(NAVIGATION_REFRESH_STORAGE_KEY, "1");
    expect(resolveInitialNavigationRefreshEnabled()).toBe(true);
  });

  it("stays off when storage access is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    expect(resolveInitialNavigationRefreshEnabled()).toBe(false);
  });

  it("does not throw when persistence is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    expect(() => persistNavigationRefreshEnabled(false)).not.toThrow();
  });
});

describe("dashboard period preference", () => {
  it("defaults to Day and ignores unsupported stored values", () => {
    expect(resolveInitialDashboardPeriod()).toBe("Today");
    window.localStorage.setItem(DASHBOARD_PERIOD_STORAGE_KEY, "Month");
    expect(resolveInitialDashboardPeriod()).toBe("Today");
  });

  it("persists and restores Week", () => {
    persistDashboardPeriod("Week");
    expect(resolveInitialDashboardPeriod()).toBe("Week");
  });

  it("keeps navigation usable when storage access is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    expect(resolveInitialDashboardPeriod()).toBe("Today");

    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    expect(() => persistDashboardPeriod("Week")).not.toThrow();
  });
});
