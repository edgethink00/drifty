// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { REVIEW_RARITY } from "../achievementDesignReview";
import { EMPTY_ACHIEVEMENT_STORE, mergeAchievementFacts } from "../achievementStore";
import { AchievementsPanel } from "../AchievementsPanel";
import { AchievementUnlockDialog } from "../AchievementUnlockDialog";
import { buildAchievementItems, type AchievementsSnapshot } from "../useAchievements";

// The contracts of Insights › Achievements (layouts/c15): the tabpanel, one
// card per achievement in two parts, each opening its own popup dialog, and
// the new-achievement cards.

const HOUR = 3600;

function snapshot(): AchievementsSnapshot {
  const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [
    { day: "2026-11-02", trackedSeconds: 5 * HOUR, focusSeconds: 2 * HOUR, driftSeconds: HOUR, longestFocusRunSeconds: 2 * HOUR, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
    { day: "2026-11-03", trackedSeconds: 5 * HOUR, focusSeconds: 60, driftSeconds: 4 * HOUR, longestFocusRunSeconds: 60, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
  ], { startDay: "2026-11-02", endDay: "2026-11-03" });
  return { status: "ready", items: buildAchievementItems(store, {}), unannounced: ["driftDay"], firstLookPending: false };
}

function panel(onSeen = vi.fn()) {
  return render(<AchievementsPanel snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={onSeen} />);
}

function dialog(which: "single" | "several" | "firstLook", onClose = vi.fn()) {
  const earned = snapshot().items.filter((item) => item.earned);
  const items = which === "single" ? earned.filter((item) => item.definition.id === "driftDay") : earned;
  render(<AchievementUnlockDialog items={items} firstLook={which === "firstLook"} onClose={onClose} onView={vi.fn()} />);
  return screen.getByRole("dialog");
}

function listCss(): string {
  const folder = join(dirname(fileURLToPath(import.meta.url)), "c15");
  return (readdirSync(folder) as string[])
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(folder, file), "utf8"))
    .join("\n");
}

function day(date: string, focusSeconds: number, driftSeconds: number, longestFocusRunSeconds: number) {
  return { day: date, trackedSeconds: 5 * HOUR, focusSeconds, driftSeconds, longestFocusRunSeconds, earlyFocusSeconds: 0, lateFocusSeconds: 0 };
}

function referenceSnapshot(rarity: boolean): AchievementsSnapshot {
  const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [
    day("2026-11-02", 2 * HOUR, HOUR, 2 * HOUR),
    day("2026-11-03", 60, 4 * HOUR, 60),
    day("2026-11-05", 60, 4 * HOUR, 60),
    day("2026-11-07", 60, 4 * HOUR, 60),
  ], { startDay: "2026-11-02", endDay: "2026-11-07" });
  // Two earlier times of Adrift fell out of the kept days.
  const earned = { ...store.earned, driftDay: { firstDay: "2025-03-01", lastDay: "2026-11-07", count: 5 } };
  return { status: "ready", items: buildAchievementItems({ ...store, earned }, rarity ? REVIEW_RARITY : {}), unannounced: [], firstLookPending: false };
}

const ROW_LABEL = /, (earned|not earned yet)$/;

function rowsOf(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter((node) => ROW_LABEL.test(node.getAttribute("aria-label") ?? ""));
}

function rowPanel(rarity: boolean) {
  const onOpenDay = vi.fn();
  render(<AchievementsPanel snapshot={referenceSnapshot(rarity)} onRetry={vi.fn()} onOpenDay={onOpenDay} onSeen={vi.fn()} />);
  return { tabpanel: screen.getByRole("tabpanel"), onOpenDay };
}

describe("new-achievement cards", () => {
  it.each([
    ["single", "Adrift"],
    ["several", "Adrift"],
    ["firstLook", "3 achievements in your records"],
  ] as const)("labels the %s card's dialog by its title", (which, title) => {
    const shell = dialog(which);
    expect(shell.getAttribute("aria-modal")).toBe("true");
    expect(within(shell).getByRole("heading", { name: title }).id).toBe(shell.getAttribute("aria-labelledby"));
  });

  it("closes the card with Escape and with its close button", () => {
    const onClose = vi.fn();
    const shell = dialog("several", onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(within(shell).getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("draws a visible keyboard focus in its own scoped styles", () => {
    const preludes = listCss().replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g) ?? [];
    expect(preludes.some((selector) => selector.includes(":focus-visible") && selector.includes('[data-layout="c15"]'))).toBe(true);
  });
});

describe("achievements list", () => {
  it("keeps the tabpanel and one labelled card per achievement, each opening a dialog, with no topic headings", () => {
    const onSeen = vi.fn();
    panel(onSeen);
    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel.id).toBe("insights-tabpanel-achievements");
    expect(tabpanel.getAttribute("aria-labelledby")).toBe("insights-tab-achievements");
    for (const group of ["Focus", "Rhythm", "Consistency", "Unexpected"]) {
      expect(within(tabpanel).queryByRole("heading", { name: group })).toBeNull();
    }
    const rows = rowsOf(tabpanel);
    expect(rows).toHaveLength(13);
    for (const row of rows) expect(row.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getAllByRole("button", { name: "Hidden achievement, not earned yet" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Adrift, earned" })).toBeTruthy();
    expect(onSeen).toHaveBeenCalledWith(["driftDay"]);
  });

  it("opens the chosen achievement in a dialog labelled by its name", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Three-hour flow, not earned yet" }));
    const shell = screen.getByRole("dialog");
    expect(shell.getAttribute("aria-modal")).toBe("true");
    expect(within(shell).getByRole("heading", { name: "Three-hour flow" }).id).toBe(shell.getAttribute("aria-labelledby"));
  });

  it("orders the list in two parts: earned, then not yet led by goals under way, hidden last", () => {
    const { tabpanel } = rowPanel(true);
    expect(tabpanel.querySelector("[data-tier-summary]")).toBeNull();
    const rank = (node: HTMLElement) => {
      const label = node.getAttribute("aria-label") ?? "";
      if (label.startsWith("Hidden achievement")) return 3;
      if (label.endsWith(", earned")) return 0;
      return node.closest("[data-almost-there-id]") ? 1 : 2;
    };
    const ranks = rowsOf(tabpanel).map(rank);
    expect(ranks).toEqual([...ranks].sort());
    expect(ranks).toContain(0);
    expect(ranks).toContain(1);
    expect(ranks[ranks.length - 1]).toBe(3);
    expect(tabpanel.querySelector("[data-almost-there-id]")?.getAttribute("data-almost-there-id")).toBe("flow180");
  });

  it("keeps the popup's record short: first and latest day and how many times, the latest opening its day", () => {
    const { onOpenDay } = rowPanel(true);
    fireEvent.click(screen.getByRole("button", { name: "Adrift, earned" }));
    const shell = screen.getByRole("dialog");
    const days = [...shell.querySelectorAll<HTMLElement>("[data-history-day]")];
    expect(days.map((node) => node.dataset.historyDay)).toEqual(["2026-11-07"]);
    expect(within(shell).getByText("5 times")).toBeTruthy();
    fireEvent.click(days[0]);
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-07");
  });

  it("shows no rarity words when rarity is unknown", () => {
    rowPanel(true);
    cleanup();
    const { tabpanel } = rowPanel(false);
    expect(tabpanel.textContent).not.toMatch(/Common|Uncommon|Rare|Very rare|Legendary|of Drifty users|people have earned|users have earned/);
  });
});
