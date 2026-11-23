// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACHIEVEMENT_LAYOUTS, type AchievementLayoutId } from "../achievementDesignReview";
import { EMPTY_ACHIEVEMENT_STORE, mergeAchievementFacts } from "../achievementStore";
import { AchievementsPanel } from "../AchievementsPanel";
import { AchievementUnlockDialog } from "../AchievementUnlockDialog";
import { buildAchievementItems, type AchievementsSnapshot } from "../useAchievements";
import { ACHIEVEMENT_LAYOUT_REGISTRY } from "./registry";

// The contracts every registered layout keeps, whatever its composition.
// A new layout only has to satisfy these; it never edits this file.

const HOUR = 3600;

function snapshot(): AchievementsSnapshot {
  const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [
    { day: "2026-11-02", trackedSeconds: 5 * HOUR, focusSeconds: 2 * HOUR, driftSeconds: HOUR, longestFocusRunSeconds: 2 * HOUR, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
    { day: "2026-11-03", trackedSeconds: 5 * HOUR, focusSeconds: 60, driftSeconds: 4 * HOUR, longestFocusRunSeconds: 60, earlyFocusSeconds: 0, lateFocusSeconds: 0 },
  ], { startDay: "2026-11-02", endDay: "2026-11-03" });
  return { status: "ready", items: buildAchievementItems(store, {}), unannounced: ["driftDay"], firstLookPending: false };
}

function panel(layout: AchievementLayoutId, onSeen = vi.fn()) {
  return render(<AchievementsPanel layout={layout} snapshot={snapshot()} onRetry={vi.fn()} onOpenDay={vi.fn()} onSeen={onSeen} />);
}

function dialog(layout: AchievementLayoutId, which: "single" | "several" | "firstLook", onClose = vi.fn()) {
  const earned = snapshot().items.filter((item) => item.earned);
  const items = which === "single" ? earned.filter((item) => item.definition.id === "driftDay") : earned;
  render(<AchievementUnlockDialog layout={layout} items={items} firstLook={which === "firstLook"} onClose={onClose} onView={vi.fn()} />);
  return screen.getByRole("dialog");
}

function layoutCss(id: AchievementLayoutId): string {
  const folder = join(dirname(fileURLToPath(import.meta.url)), id);
  return (readdirSync(folder, { recursive: true }) as string[])
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(folder, file), "utf8"))
    .join("\n");
}

describe.each(ACHIEVEMENT_LAYOUTS)("achievements layout %s", (id) => {
  const layout = ACHIEVEMENT_LAYOUT_REGISTRY[id];
  const tabOwner = layout.tabLayout ?? id;

  it("borrows a tab or card only together with the styles of the layout it comes from", () => {
    if (layout.tabLayout) expect(layout.Tab).toBe(ACHIEVEMENT_LAYOUT_REGISTRY[layout.tabLayout].Tab);
    if (layout.cardLayout) expect(layout.Card).toBe(ACHIEVEMENT_LAYOUT_REGISTRY[layout.cardLayout].Card);
  });

  it("keeps the tabpanel, the group headings and the tile labels", () => {
    const onSeen = vi.fn();
    panel(id, onSeen);
    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel.id).toBe("insights-tabpanel-achievements");
    expect(tabpanel.getAttribute("aria-labelledby")).toBe("insights-tab-achievements");
    for (const group of ["Focus", "Rhythm", "Consistency", "Unexpected"]) {
      expect(within(tabpanel).getByRole("heading", { name: group })).toBeTruthy();
    }
    expect(screen.getAllByRole("button", { name: "Hidden achievement, not earned yet" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Three-hour flow, not earned yet" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Adrift, earned" }).getAttribute("aria-pressed")).toBe("true");
    expect(onSeen).toHaveBeenCalledWith(["driftDay"]);
  });

  it("shows the chosen achievement's name as a level-3 heading inside an aside", () => {
    panel(id);
    const tile = screen.getByRole("button", { name: "Three-hour flow, not earned yet" });
    fireEvent.click(tile);
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    const heading = screen.getAllByRole("heading", { level: 3 }).find((node) => node.textContent === "Three-hour flow");
    expect(heading?.closest("aside")).toBeTruthy();
  });

  it.each([
    ["single", "Adrift"],
    ["several", "Adrift"],
    ["firstLook", "3 achievements in your records"],
  ] as const)("labels the %s card's dialog by its title", (which, title) => {
    const shell = dialog(id, which);
    expect(shell.getAttribute("aria-modal")).toBe("true");
    expect(within(shell).getByRole("heading", { name: title }).id).toBe(shell.getAttribute("aria-labelledby"));
  });

  it("closes the card with Escape and with its close button", () => {
    const onClose = vi.fn();
    const shell = dialog(id, "several", onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(within(shell).getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("draws a visible keyboard focus in its own scoped styles", () => {
    const preludes = layoutCss(tabOwner).replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g) ?? [];
    expect(preludes.some((selector) => selector.includes(":focus-visible") && selector.includes(`[data-layout="${tabOwner}"]`))).toBe(true);
  });
});
