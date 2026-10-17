// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialWeekTimeScale, normalizeWeekTimeScale, persistWeekTimeScale, WEEK_TIME_SCALE_STORAGE_KEY } from "./weekDashboardScalePreference";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(WEEK_TIME_SCALE_STORAGE_KEY);
});

describe("Week time scale preference", () => {
  it("restores supported choices while ignoring malformed or out-of-range storage", () => {
    for (const value of ["75", "100", "125"]) {
      window.localStorage.setItem(WEEK_TIME_SCALE_STORAGE_KEY, value);
      expect(initialWeekTimeScale()).toBe(Number(value));
    }
    for (const value of [null, "", "0", "80", "Infinity", "bad", {}, true]) expect(normalizeWeekTimeScale(value)).toBe(75);
  });

  it("remembers a deliberate choice without changing the default", () => {
    expect(initialWeekTimeScale()).toBe(75);
    expect(persistWeekTimeScale(125)).toBe(125);
    expect(initialWeekTimeScale()).toBe(125);
  });

  it("keeps the live choice and safely falls back when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(initialWeekTimeScale()).toBe(75);
    expect(persistWeekTimeScale(100)).toBe(100);
  });
});
