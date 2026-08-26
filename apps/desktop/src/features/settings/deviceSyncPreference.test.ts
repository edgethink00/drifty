// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  getDeviceSyncEnabledStorageKey,
  LEGACY_DEVICE_SYNC_ENABLED_STORAGE_KEY,
  persistDeviceSyncEnabled,
  resolveDeviceSyncEnabled,
  retireLegacyDeviceSyncEnabledPreference,
} from "./settingsStorage";

describe("device sync preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps raw-activity sync opt-in isolated by account", () => {
    persistDeviceSyncEnabled("user-1", true);

    expect(resolveDeviceSyncEnabled("user-1")).toBe(true);
    expect(resolveDeviceSyncEnabled("user-2")).toBe(false);
    expect(getDeviceSyncEnabledStorageKey("user-1")).not.toBe(getDeviceSyncEnabledStorageKey("user-2"));
  });

  it("does not migrate the legacy machine-wide opt-in", () => {
    window.localStorage.setItem(LEGACY_DEVICE_SYNC_ENABLED_STORAGE_KEY, "1");

    expect(resolveDeviceSyncEnabled("user-1")).toBe(false);
    retireLegacyDeviceSyncEnabledPreference();
    expect(window.localStorage.getItem(LEGACY_DEVICE_SYNC_ENABLED_STORAGE_KEY)).toBeNull();
  });
});
