import { describe, expect, it } from "vitest";

import { replaceNavigationHistoryTab, type NavigationHistoryState } from "./navigation";

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
