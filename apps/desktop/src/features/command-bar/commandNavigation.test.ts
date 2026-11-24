import { describe, expect, it } from "vitest";
import { commandNavigationOrder, commandNavigationShortcutTarget } from "./commandNavigation";

const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: value, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...extra,
});

describe("command navigation shortcuts", () => {
  const order = commandNavigationOrder({ includeProjects: true, includeAgents: false, includeChat: true });

  it("follows the sidebar: Calendar, Activity with Chat last, then Leaderboard", () => {
    expect(order).toEqual(["dashboard", "classification", "projects", "trends", "history", "chat", "leaderboard"]);
  });

  it("opens the numbered place for ⌘ plus a number", () => {
    expect(commandNavigationShortcutTarget(key("1"), order)).toBe("dashboard");
    expect(commandNavigationShortcutTarget(key("3"), order)).toBe("projects");
    expect(commandNavigationShortcutTarget(key("6"), order)).toBe("chat");
    expect(commandNavigationShortcutTarget(key("7"), order)).toBe("leaderboard");
  });

  it("ignores numbers past the list, other modifiers and typing in progress", () => {
    expect(commandNavigationShortcutTarget(key("8"), order)).toBeNull();
    expect(commandNavigationShortcutTarget(key("2", { metaKey: false }), order)).toBeNull();
    expect(commandNavigationShortcutTarget(key("2", { shiftKey: true }), order)).toBeNull();
    expect(commandNavigationShortcutTarget(key("2", { altKey: true }), order)).toBeNull();
    expect(commandNavigationShortcutTarget(key("2", { ctrlKey: true }), order)).toBeNull();
    expect(commandNavigationShortcutTarget(key("2", { isComposing: true }), order)).toBeNull();
    expect(commandNavigationShortcutTarget(key("k"), order)).toBeNull();
  });
});
