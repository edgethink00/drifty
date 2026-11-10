import { describe, expect, it } from "vitest";

import { flowNav, primaryNav, replaceNavigationHistoryTab, reviewNav, stepProjectHistory, type NavigationHistoryState } from "./navigation";

describe("navigation groups", () => {
  it("keeps Calendar on its own and the Activity destinations in one explicit list", () => {
    expect(flowNav.map((item) => item.id)).toEqual(["dashboard"]);
    expect(reviewNav.map((item) => item.id)).toEqual(["classification", "projects", "trends", "agents", "history"]);
    expect(primaryNav.map((item) => item.id)).toEqual([
      "dashboard",
      "classification",
      "projects",
      "trends",
      "agents",
      "history",
    ]);
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

describe("stepProjectHistory", () => {
  const today = "Today" as const;
  const at = (entries: NavigationHistoryState["entries"], index = entries.length - 1): NavigationHistoryState => ({ entries, index });

  it("opens a project as its own entry so the window's back returns to the table", () => {
    const opened = stepProjectHistory(at([{ tabId: "dashboard", dashPeriod: today }, { tabId: "projects", dashPeriod: today }]), "p1", "push");
    expect(opened).toEqual(at([
      { tabId: "dashboard", dashPeriod: today },
      { tabId: "projects", dashPeriod: today },
      { tabId: "projects", dashPeriod: today, projectId: "p1" },
    ]));
  });

  it("replaces the entry when stepping to another project, so back still lands on the table", () => {
    const history = at([{ tabId: "projects", dashPeriod: today }, { tabId: "projects", dashPeriod: today, projectId: "p1" }]);
    const stepped = stepProjectHistory(history, "p2", "replace");
    expect(stepped.entries).toHaveLength(2);
    expect(stepped.entries[1]).toEqual({ tabId: "projects", dashPeriod: today, projectId: "p2" });
    expect(stepProjectHistory(stepped, null, "back")).toEqual({ ...stepped, index: 0 });
  });

  it("replaces a detail reached without a table before it instead of leaving the tab", () => {
    const history = at([{ tabId: "dashboard", dashPeriod: today }, { tabId: "projects", dashPeriod: today, projectId: "p1" }]);
    expect(stepProjectHistory(history, null, "back")).toEqual(at([
      { tabId: "dashboard", dashPeriod: today },
      { tabId: "projects", dashPeriod: today, projectId: null },
    ]));
  });

  it("leaves other tabs and an already open project alone", () => {
    const dashboard = at([{ tabId: "dashboard", dashPeriod: today }]);
    expect(stepProjectHistory(dashboard, "p1", "push")).toBe(dashboard);
    const open = at([{ tabId: "projects", dashPeriod: today, projectId: "p1" }]);
    expect(stepProjectHistory(open, "p1", "push")).toBe(open);
  });
});
