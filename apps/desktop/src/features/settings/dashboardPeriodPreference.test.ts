// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_PERIOD_STORAGE_KEY,
  WINDOWS_BLUR_STORAGE_KEY,
  LEGACY_WINDOWS_BLUR_PREVIEW_STORAGE_KEY,
  persistDashboardPeriod,
  persistWindowsBlurEnabled,
  resolveInitialDashboardPeriod,
  resolveInitialWindowsBlurEnabled,
} from "./settingsStorage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Windows blur preference", () => {
  it("defaults on, persists explicit choices, and ignores malformed values", () => {
    expect(resolveInitialWindowsBlurEnabled()).toBe(true);
    window.localStorage.setItem(WINDOWS_BLUR_STORAGE_KEY, "true");
    expect(resolveInitialWindowsBlurEnabled()).toBe(true);
    persistWindowsBlurEnabled(false);
    expect(resolveInitialWindowsBlurEnabled()).toBe(false);
    persistWindowsBlurEnabled(true);
    expect(resolveInitialWindowsBlurEnabled()).toBe(true);
  });

  it.each(["0", "1"])("migrates explicit Preview choice %s without changing it", (value) => {
    window.localStorage.setItem(LEGACY_WINDOWS_BLUR_PREVIEW_STORAGE_KEY, value);
    expect(resolveInitialWindowsBlurEnabled()).toBe(value === "1");
    expect(window.localStorage.getItem(WINDOWS_BLUR_STORAGE_KEY)).toBe(value);
    expect(window.localStorage.getItem(LEGACY_WINDOWS_BLUR_PREVIEW_STORAGE_KEY)).toBeNull();
  });

  it("gives the current setting precedence over a leftover Preview value", () => {
    window.localStorage.setItem(WINDOWS_BLUR_STORAGE_KEY, "0");
    window.localStorage.setItem(LEGACY_WINDOWS_BLUR_PREVIEW_STORAGE_KEY, "1");
    expect(resolveInitialWindowsBlurEnabled()).toBe(false);
  });

  it("honors an existing Preview opt-out even when its migration cannot be written", () => {
    window.localStorage.setItem(LEGACY_WINDOWS_BLUR_PREVIEW_STORAGE_KEY, "0");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    expect(resolveInitialWindowsBlurEnabled()).toBe(false);
  });

  it("fails closed when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    expect(resolveInitialWindowsBlurEnabled()).toBe(false);
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
