import { describe, expect, it } from "vitest";

import { activityNav, flowNav, primaryNav, replaceNavigationHistoryTab, reviewNav, type NavigationHistoryState } from "./navigation";

describe("navigation groups", () => {
  it("keeps Flow and Review destinations explicit instead of index slices", () => {
    expect(flowNav.map((item) => item.id)).toEqual(["dashboard", "agents", "projects"]);
    expect(reviewNav.map((item) => item.id)).toEqual(["classification", "trends", "history"]);
    expect(primaryNav.map((item) => item.id)).toEqual([
      "dashboard",
      "agents",
      "projects",
      "classification",
      "trends",
      "history",
    ]);
    expect(activityNav.map((item) => item.id)).toEqual(["classification", "projects", "trends", "history"]);
  });
});

describe("replaceNavigationHistoryTab", () => {
  it("removes a hidden surface from back history without creating a loop", () => {
    const history: NavigationHistoryState = {
      entries: [
        { tabId: "dashboard", dashPeriod: "Today" },
        { tabId: "agents", dashPeriod: "Today" },
        { tabId: "settings", dashPeriod: "Today" },
      ],
      index: 2,
    };

    expect(replaceNavigationHistoryTab(history, "agents", { tabId: "dashboard", dashPeriod: "Today" })).toEqual({
      entries: [
        { tabId: "dashboard", dashPeriod: "Today" },
        { tabId: "settings", dashPeriod: "Today" },
      ],
      index: 1,
    });
  });

  it("keeps the same object when the hidden surface is absent", () => {
    const history: NavigationHistoryState = {
      entries: [{ tabId: "dashboard", dashPeriod: "Today" }],
      index: 0,
    };

    expect(replaceNavigationHistoryTab(history, "agents", { tabId: "dashboard", dashPeriod: "Today" })).toBe(history);
  });
});
