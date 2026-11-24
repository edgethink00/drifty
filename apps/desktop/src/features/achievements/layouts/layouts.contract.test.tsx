// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACHIEVEMENT_LAYOUTS, REVIEW_RARITY, type AchievementLayoutId } from "../achievementDesignReview";
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

// Layouts built from the reference ingredients (c7 on) also keep these: an
// almost-there row, a history of every kept day in the chosen one's detail,
// and a held-by-tier summary that disappears cleanly without rarity.
const REFERENCE_LAYOUTS = ACHIEVEMENT_LAYOUTS.slice(ACHIEVEMENT_LAYOUTS.indexOf("c7"));

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

describe.each(REFERENCE_LAYOUTS)("reference layout %s", (id) => {
  function referencePanel(rarity: boolean) {
    const onOpenDay = vi.fn();
    render(<AchievementsPanel layout={id} snapshot={referenceSnapshot(rarity)} onRetry={vi.fn()} onOpenDay={onOpenDay} onSeen={vi.fn()} />);
    return { tabpanel: screen.getByRole("tabpanel"), onOpenDay };
  }

  it("leads its almost-there row with the goal furthest along", () => {
    const { tabpanel } = referencePanel(true);
    const row = tabpanel.querySelector("[data-almost-there]");
    expect(row).toBeTruthy();
    expect(row?.querySelector("[data-almost-there-id]")?.getAttribute("data-almost-there-id")).toBe("flow180");
  });

  it("lists every kept day of the chosen achievement newest first, each opening that day, with the earlier times counted", () => {
    const { onOpenDay } = referencePanel(true);
    fireEvent.click(screen.getByRole("button", { name: "Adrift, earned" }));
    const aside = screen.getAllByRole("heading", { level: 3 }).find((node) => node.textContent === "Adrift")?.closest("aside");
    expect(aside).toBeTruthy();
    const days = [...(aside?.querySelectorAll<HTMLElement>("[data-history-day]") ?? [])];
    expect(days.map((node) => node.dataset.historyDay)).toEqual(["2026-11-07", "2026-11-05", "2026-11-03"]);
    for (const node of days) fireEvent.click(node);
    expect(onOpenDay.mock.calls.map(([value]) => value)).toEqual(["2026-11-07", "2026-11-05", "2026-11-03"]);
    expect(aside?.querySelector("[data-history-earlier]")?.getAttribute("data-history-earlier")).toBe("2");
  });

  it("counts held achievements by rarity tier, and shows no rarity words when rarity is unknown", () => {
    const withRarity = referencePanel(true);
    expect(withRarity.tabpanel.querySelector("[data-tier-summary]")?.textContent).toMatch(/Common|Uncommon|Rare|Legendary/);
    cleanup();
    const { tabpanel } = referencePanel(false);
    expect(tabpanel.textContent).not.toMatch(/Common|Uncommon|Rare|Very rare|Legendary|of Drifty users|people have earned/);
  });
});
