// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_ACHIEVEMENT_STORE, mergeAchievementFacts } from "./achievementStore";
import { buildAchievementItems, type AchievementsSnapshot } from "./useAchievements";
import { AchievementsPanel } from "./AchievementsPanel";
import { AchievementUnlockDialog } from "./AchievementUnlockDialog";

// These describe the production layout (c15): one list of big-medal rows that open in place.

const HOUR = 3600;

function snapshot(withRarity = false): AchievementsSnapshot {
  const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [
    { day: "2026-11-02", trackedSeconds: 5 * HOUR, focusSeconds: 2 * HOUR, driftSeconds: HOUR, longestFocusRunSeconds: 2 * HOUR, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
    { day: "2026-11-03", trackedSeconds: 5 * HOUR, focusSeconds: 60, driftSeconds: 4 * HOUR, longestFocusRunSeconds: 60, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
  ], { startDay: "2026-11-02", endDay: "2026-11-03" });
  const rarity = withRarity ? { driftDay: { percent: 2.3, basisCount: 1240 }, noDriftDay: { percent: 0.7, basisCount: 1240 } } : {};
  return { status: "ready", items: buildAchievementItems(store, rarity), unannounced: ["driftDay"], firstLookPending: false };
}

/** Opens a row and returns the labelled region that opened under it. */
function open(name: string, heading: string): HTMLElement {
  const row = screen.getByRole("button", { name });
  fireEvent.click(row);
  expect(row.getAttribute("aria-expanded")).toBe("true");
  return screen.getByRole("heading", { level: 3, name: heading }).closest("section")!;
}

describe("AchievementsPanel", () => {
  it("lists every achievement once, hides hidden goals and marks the newest arrival", () => {
    const onSeen = vi.fn();
    render(<AchievementsPanel snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={onSeen} />);
    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel.closest("[data-layout]")?.getAttribute("data-layout")).toBe("c15");
    expect(tabpanel.querySelector("[data-tier-summary]")?.textContent).toBe("3 achievementsHeld by medal:Silver3");
    expect(tabpanel.textContent).not.toMatch(/of 13/);
    expect(within(tabpanel).queryByRole("heading", { name: "Unexpected" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Hidden achievement, not earned yet" })).toHaveLength(2);
    const adrift = screen.getByRole("button", { name: "Adrift, earned" });
    expect(adrift.getAttribute("aria-expanded")).toBe("false");
    expect(within(adrift).getByText("Just earned")).toBeTruthy();
    expect(onSeen).toHaveBeenCalledWith(["driftDay"]);
  });

  it("shows the best result for a locked achievement and opens an earned one's day", () => {
    const onOpenDay = vi.fn();
    render(<AchievementsPanel snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={onOpenDay} onSeen={vi.fn()} />);
    const locked = open("Three-hour flow, not earned yet", "Three-hour flow");
    expect(within(locked).getByText("Best so far")).toBeTruthy();
    expect(locked.querySelector("[data-history-day]")).toBeNull();

    const earned = open("90-minute flow, earned", "90-minute flow");
    expect(screen.getByRole("button", { name: "Three-hour flow, not earned yet" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(earned).getByText("Silver")).toBeTruthy();
    expect(within(earned).getByText("9 more for gold")).toBeTruthy();
    fireEvent.click(earned.querySelector<HTMLElement>('[data-history-day="2026-11-02"]')!);
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-02");
  });

  it("offers a retry when achievements could not be worked out", () => {
    const onRetry = vi.fn();
    const failed: AchievementsSnapshot = { status: "error", items: buildAchievementItems(EMPTY_ACHIEVEMENT_STORE, {}), unannounced: [], firstLookPending: false };
    render(<AchievementsPanel snapshot={failed} onRetry={onRetry} onOpenDay={vi.fn()} onSeen={vi.fn()} />);
    expect(within(screen.getByRole("alert")).getByText("Achievements could not be updated.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows no rarity without a share of users, and keeps a hidden achievement's rarity hidden", () => {
    const { unmount } = render(<AchievementsPanel snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={vi.fn()} />);
    expect(screen.getByRole("tabpanel").textContent).not.toMatch(/Common|Uncommon|Rare|Legendary|of Drifty users|people have earned/);
    unmount();
    render(<AchievementsPanel snapshot={snapshot(true)} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={vi.fn()} />);
    for (const hidden of screen.getAllByRole("button", { name: "Hidden achievement, not earned yet" })) {
      expect(hidden.textContent).not.toMatch(/%|rare|Common|Legendary/i);
    }
    const detail = open("Adrift, earned", "Adrift");
    // Rarity reads as plain shares and head counts, never as tier names.
    expect(within(detail).getByText("2.3% of Drifty users have earned this")).toBeTruthy();
    expect(within(detail).getByText("Only 29 of 1,240 people have earned this")).toBeTruthy();
    expect(screen.getByRole("tabpanel").textContent).not.toMatch(/Very rare|Legendary|Uncommon|Common/);
  });
});

describe("AchievementUnlockDialog", () => {
  it("leads with the most notable new achievement and lists the rest", () => {
    const items = snapshot().items.filter((item) => item.earned);
    const onView = vi.fn();
    render(<AchievementUnlockDialog items={items} firstLook={false} onClose={vi.fn()} onView={onView} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-layout")).toBe("c15");
    expect(within(dialog).getByRole("heading", { name: "Adrift" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Also earned" })).toBeTruthy();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "View achievements" }));
    expect(onView).toHaveBeenCalled();
  });

  it("gathers what the first look found into one card", () => {
    const items = snapshot().items.filter((item) => item.earned);
    render(<AchievementUnlockDialog items={items} firstLook onClose={vi.fn()} onView={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "3 achievements in your records" })).toBeTruthy();
  });

  it("says how few people share a new achievement when the share is known", () => {
    const items = snapshot(true).items.filter((item) => item.definition.id === "driftDay");
    render(<AchievementUnlockDialog items={items} firstLook={false} onClose={vi.fn()} onView={vi.fn()} />);
    expect(screen.getByText("Only 29 of 1,240 people have earned this")).toBeTruthy();
  });
});
