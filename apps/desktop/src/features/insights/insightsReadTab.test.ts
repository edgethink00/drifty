import { describe, expect, it } from "vitest";
import { INSIGHTS_TABS } from "./InsightsTabs";
import { INSIGHTS_READ_TAB_ENABLED, isInsightsReadTabEnabled } from "./insightsReadTab";

describe("insights read tab gate", () => {
  it("keeps Your read out of the shipped Insights tabs", () => {
    expect(INSIGHTS_READ_TAB_ENABLED).toBe(false);
    expect(isInsightsReadTabEnabled()).toBe(false);
    expect(INSIGHTS_TABS.map((tab) => tab.id)).toEqual(["usage", "achievements"]);
  });

  it("still declares the read tab in the catalog so it can be restored", () => {
    expect(INSIGHTS_TABS.some((tab) => tab.id === "read")).toBe(false);
    expect(INSIGHTS_TABS).toHaveLength(2);
  });
});
