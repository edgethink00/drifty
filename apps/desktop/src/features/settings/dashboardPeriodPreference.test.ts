// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_PERIOD_STORAGE_KEY,
  NAVIGATION_REFRESH_STORAGE_KEY,
  WINDOWS_BLUR_PREVIEW_STORAGE_KEY,
  persistDashboardPeriod,
  persistNavigationRefreshEnabled,
  persistWindowsBlurPreviewEnabled,
  resolveInitialDashboardPeriod,
  resolveInitialNavigationRefreshEnabled,
  resolveInitialWindowsBlurPreviewEnabled,
} from "./settingsStorage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Windows blur Preview preference", () => {
  it("defaults off and restores only an explicit opt-in", () => {
    expect(resolveInitialWindowsBlurPreviewEnabled()).toBe(false);
    window.localStorage.setItem(WINDOWS_BLUR_PREVIEW_STORAGE_KEY, "true");
    expect(resolveInitialWindowsBlurPreviewEnabled()).toBe(false);
    persistWindowsBlurPreviewEnabled(true);
    expect(resolveInitialWindowsBlurPreviewEnabled()).toBe(true);
    persistWindowsBlurPreviewEnabled(false);
    expect(resolveInitialWindowsBlurPreviewEnabled()).toBe(false);
  });

  it("fails closed when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    expect(resolveInitialWindowsBlurPreviewEnabled()).toBe(false);
  });
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
