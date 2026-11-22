// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_ACHIEVEMENT_STORE, mergeAchievementFacts } from "./achievementStore";
import { buildAchievementItems, type AchievementsSnapshot } from "./useAchievements";
import { AchievementsPanel } from "./AchievementsPanel";
import { AchievementUnlockDialog } from "./AchievementUnlockDialog";

const HOUR = 3600;

function snapshot(): AchievementsSnapshot {
  const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [
    { day: "2026-11-02", trackedSeconds: 5 * HOUR, focusSeconds: 2 * HOUR, driftSeconds: HOUR, longestFocusRunSeconds: 2 * HOUR, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
    { day: "2026-11-03", trackedSeconds: 5 * HOUR, focusSeconds: 60, driftSeconds: 4 * HOUR, longestFocusRunSeconds: 60, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
  ], { startDay: "2026-11-02", endDay: "2026-11-03" });
  return { status: "ready", items: buildAchievementItems(store), unannounced: ["driftDay"], firstLookPending: false };
}

describe("AchievementsPanel", () => {
  it("lists every achievement by group, hides hidden goals and opens on the newest arrival", () => {
    const onSeen = vi.fn();
    render(<AchievementsPanel snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={onSeen} />);
    expect(screen.getByText("3 of 13 earned")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Unexpected" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Hidden achievement, not earned yet" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Adrift, earned" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Adrift");
    expect(onSeen).toHaveBeenCalledWith(["driftDay"]);
  });

  it("shows the best result for a locked achievement and opens an earned one's day", () => {
    const onOpenDay = vi.fn();
    render(<AchievementsPanel snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={onOpenDay} onSeen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Three-hour flow, not earned yet" }));
    const detail = screen.getByRole("heading", { level: 3 }).closest("aside")!;
    expect(within(detail).getByText("Best so far")).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "Open that day" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "90-minute flow, earned" }));
    fireEvent.click(screen.getByRole("button", { name: "Open that day" }));
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-02");
  });
});

describe("AchievementUnlockDialog", () => {
  it("leads with the most notable new achievement and counts the rest", () => {
    const items = snapshot().items.filter((item) => item.earned);
    const onView = vi.fn();
    render(<AchievementUnlockDialog items={items} firstLook={false} onClose={vi.fn()} onView={onView} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Adrift" })).toBeTruthy();
    expect(within(dialog).getByText("And 2 more")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "View achievements" }));
    expect(onView).toHaveBeenCalled();
  });

  it("gathers what the first look found into one card", () => {
    const items = snapshot().items.filter((item) => item.earned);
    render(<AchievementUnlockDialog items={items} firstLook onClose={vi.fn()} onView={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "3 achievements in your records" })).toBeTruthy();
  });
});

