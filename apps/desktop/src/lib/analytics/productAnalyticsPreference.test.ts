// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT,
  PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY,
  createProductAnalyticsDeliveryGuard,
  readProductAnalyticsEnabled,
  writeProductAnalyticsEnabled,
} from "./productAnalyticsPreference";

describe("product analytics preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    writeProductAnalyticsEnabled(true, window.localStorage);
    window.localStorage.removeItem(PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY);
  });

  it("defaults on only when durable storage is available", () => {
    expect(readProductAnalyticsEnabled({ getItem: () => null })).toBe(true);
    expect(readProductAnalyticsEnabled(null)).toBe(false);
    expect(readProductAnalyticsEnabled({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });

  it("persists opt-out and announces the preference change", () => {
    const listener = vi.fn();
    window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, listener);

    expect(writeProductAnalyticsEnabled(false, window.localStorage)).toBe(false);
    expect(window.localStorage.getItem(PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY)).toBe("0");
    expect(readProductAnalyticsEnabled(window.localStorage)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, listener);
  });

  it("fails closed for the session when an opt-out cannot be stored", () => {
    const listener = vi.fn();
    window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, listener);
    const mayDeliver = createProductAnalyticsDeliveryGuard(window.localStorage);
    const blockedStorage = {
      getItem: () => "1",
      setItem: () => { throw new Error("blocked"); },
    };

    expect(writeProductAnalyticsEnabled(false, blockedStorage)).toBe(false);
    expect(readProductAnalyticsEnabled(window.localStorage)).toBe(false);
    expect(mayDeliver()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent<boolean>).detail).toBe(false);

    window.removeEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, listener);
  });

  it("revokes in-flight delivery across opt-out and re-enable", () => {
    const mayDeliver = createProductAnalyticsDeliveryGuard(window.localStorage);
    expect(mayDeliver()).toBe(true);

    writeProductAnalyticsEnabled(false, window.localStorage);
    writeProductAnalyticsEnabled(true, window.localStorage);

    expect(readProductAnalyticsEnabled(window.localStorage)).toBe(true);
    expect(mayDeliver()).toBe(false);
  });

  it("revokes in-flight delivery after another window changes storage", () => {
    const mayDeliver = createProductAnalyticsDeliveryGuard(window.localStorage);
    window.localStorage.setItem(PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY, "0");
    window.dispatchEvent(new StorageEvent("storage", {
      key: PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY,
      newValue: "0",
      storageArea: window.localStorage,
    }));

    expect(mayDeliver()).toBe(false);
  });
});
