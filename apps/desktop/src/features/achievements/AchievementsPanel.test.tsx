// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_ACHIEVEMENT_STORE, mergeAchievementFacts } from "./achievementStore";
import { buildAchievementItems, type AchievementsSnapshot } from "./useAchievements";
import { AchievementsPanel } from "./AchievementsPanel";
import { AchievementUnlockDialog } from "./AchievementUnlockDialog";

const HOUR = 3600;

function snapshot(withRarity = false): AchievementsSnapshot {
  const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [
    { day: "2026-11-02", trackedSeconds: 5 * HOUR, focusSeconds: 2 * HOUR, driftSeconds: HOUR, longestFocusRunSeconds: 2 * HOUR, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
    { day: "2026-11-03", trackedSeconds: 5 * HOUR, focusSeconds: 60, driftSeconds: 4 * HOUR, longestFocusRunSeconds: 60, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
  ], { startDay: "2026-11-02", endDay: "2026-11-03" });
  const rarity = withRarity ? { driftDay: { percent: 2.3, basisCount: 1240 }, noDriftDay: { percent: 0.7, basisCount: 1240 } } : {};
  return { status: "ready", items: buildAchievementItems(store, rarity), unannounced: ["driftDay"], firstLookPending: false };
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

  it("shows no rarity without a share of users, and keeps a hidden achievement's rarity hidden", () => {
    const { unmount } = render(<AchievementsPanel snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={vi.fn()} />);
    expect(screen.queryByText(/of users/)).toBeNull();
    unmount();
    render(<AchievementsPanel snapshot={snapshot(true)} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={vi.fn()} />);
    expect(within(screen.getByRole("button", { name: "Adrift, earned" })).getByText("2.3% of users")).toBeTruthy();
    expect(screen.queryByText("0.7% of users")).toBeNull();
    const detail = screen.getByRole("heading", { level: 3 }).closest("aside")!;
    expect(within(detail).getByText("Very rare")).toBeTruthy();
    expect(within(detail).getByText("2.3% of Drifty users have earned this")).toBeTruthy();
    expect(within(detail).getByText("Among 1,240 people sharing usage statistics over the last 90 days")).toBeTruthy();
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

  it("says how few people share a new achievement when the share is known", () => {
    const items = snapshot(true).items.filter((item) => item.definition.id === "driftDay");
    render(<AchievementUnlockDialog items={items} firstLook={false} onClose={vi.fn()} onView={vi.fn()} />);
    expect(screen.getByText("Only 2.3% of Drifty users have earned this")).toBeTruthy();
  });
});

