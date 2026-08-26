// @vitest-environment jsdom
import { FLOW_INTERVAL_OPTIONS } from "@drifty/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_FLOW_INTERVAL_STORAGE_KEY,
  DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES,
  DEFAULT_DASHBOARD_FLOW_INTERVAL_MINUTES,
  normalizeDashboardFlowIntervalMinutes,
  persistDashboardFlowIntervalMinutes,
  resolveInitialDashboardFlowIntervalMinutes,
} from "./flowChartDetailPreference";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("dashboard Flow detail preference", () => {
  it("defaults the chart to 4 minutes while keeping summaries at 5 minutes", () => {
    expect(DEFAULT_DASHBOARD_FLOW_INTERVAL_MINUTES).toBe(4);
    expect(DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES).toBe(5);
    expect(resolveInitialDashboardFlowIntervalMinutes()).toBe(4);
  });

  it.each(FLOW_INTERVAL_OPTIONS)("restores the supported %d-minute view", (intervalMinutes) => {
    window.localStorage.setItem(DASHBOARD_FLOW_INTERVAL_STORAGE_KEY, String(intervalMinutes));

    expect(resolveInitialDashboardFlowIntervalMinutes()).toBe(intervalMinutes);
  });

  it("normalizes unsupported stored values to the 4-minute default", () => {
    window.localStorage.setItem(DASHBOARD_FLOW_INTERVAL_STORAGE_KEY, "7");

    expect(resolveInitialDashboardFlowIntervalMinutes()).toBe(4);
    expect(normalizeDashboardFlowIntervalMinutes("invalid")).toBe(4);
  });

  it("keeps the in-session choice usable when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });

    expect(resolveInitialDashboardFlowIntervalMinutes()).toBe(4);
    expect(persistDashboardFlowIntervalMinutes(6)).toBe(6);
  });
});
