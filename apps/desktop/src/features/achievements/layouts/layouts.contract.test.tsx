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

// Every layout lists one full-width row per achievement in a single list:
// summary, then almost there, earned, not yet, hidden last. No topic headings;
// a row opens in place (aria-expanded) or is chosen (aria-pressed), and the
// opened one's name is a level-3 heading inside a labelled section or aside.
const ROW_LABEL = /, (earned|not earned yet)$/;

function rowsOf(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter((node) => ROW_LABEL.test(node.getAttribute("aria-label") ?? ""));
}

function stateOf(row: HTMLElement): string | null {
  return row.getAttribute("aria-expanded") ?? row.getAttribute("aria-pressed");
}

function openRow(name: string): HTMLElement {
  const row = screen.getByRole("button", { name });
  if (stateOf(row) !== "true") fireEvent.click(row);
  return row;
}

/** The labelled section or aside around the opened achievement's level-3 heading; it holds no other row. */
function openedRegion(container: HTMLElement, name: string): HTMLElement | null {
  const heading = within(container).getAllByRole("heading", { level: 3 }).find((node) => node.textContent === name);
  const region = heading?.closest<HTMLElement>('section:not([role="tabpanel"]), aside') ?? null;
  if (!region || !(region.hasAttribute("aria-labelledby") || region.hasAttribute("aria-label"))) return null;
  return rowsOf(region).length <= 1 ? region : null;
}

describe.each(ACHIEVEMENT_LAYOUTS)("achievements row layout %s", (id) => {
  // c15, the production layout, deliberately has no summary line above its list.
  const hasSummary = id !== "c15";
  // c15 opens an achievement in its own popup dialog rather than in place.
  const popup = id === "c15";
  /** c15 lists just earned and not yet; goals under way lead the not-yet part instead of a part of their own. */
  const twoParts = id === "c15";
  function rowPanel(rarity: boolean) {
    const onOpenDay = vi.fn();
    render(<AchievementsPanel layout={id} snapshot={referenceSnapshot(rarity)} onRetry={vi.fn()} onOpenDay={onOpenDay} onSeen={vi.fn()} />);
    return { tabpanel: screen.getByRole("tabpanel"), onOpenDay };
  }

  it("keeps the tabpanel and one labelled row per achievement, with no topic headings", () => {
    const onSeen = vi.fn();
    panel(id, onSeen);
    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel.id).toBe("insights-tabpanel-achievements");
    expect(tabpanel.getAttribute("aria-labelledby")).toBe("insights-tab-achievements");
    for (const group of ["Focus", "Rhythm", "Consistency", "Unexpected"]) {
      expect(within(tabpanel).queryByRole("heading", { name: group })).toBeNull();
    }
    const rows = rowsOf(tabpanel);
    expect(rows).toHaveLength(13);
    for (const row of rows) {
      if (popup) expect(row.getAttribute("aria-haspopup")).toBe("dialog");
      else expect(["true", "false"]).toContain(stateOf(row));
    }
    expect(screen.getAllByRole("button", { name: "Hidden achievement, not earned yet" })).toHaveLength(2);
    if (!popup) expect(stateOf(screen.getByRole("button", { name: "Three-hour flow, not earned yet" }))).toBe("false");
    expect(screen.getByRole("button", { name: "Adrift, earned" })).toBeTruthy();
    expect(onSeen).toHaveBeenCalledWith(["driftDay"]);
  });

  it("opens the chosen achievement with its name as a level-3 heading inside a labelled region", () => {
    panel(id);
    if (popup) {
      fireEvent.click(screen.getByRole("button", { name: "Three-hour flow, not earned yet" }));
      const shell = screen.getByRole("dialog");
      expect(shell.getAttribute("aria-modal")).toBe("true");
      expect(within(shell).getByRole("heading", { name: "Three-hour flow" }).id).toBe(shell.getAttribute("aria-labelledby"));
      return;
    }
    const row = openRow("Three-hour flow, not earned yet");
    expect(stateOf(row)).toBe("true");
    expect(openedRegion(screen.getByRole("tabpanel"), "Three-hour flow")).toBeTruthy();
  });

  it("orders the list: summary, almost there, earned, not yet, hidden last", () => {
    const { tabpanel } = rowPanel(true);
    const summary = tabpanel.querySelector("[data-tier-summary]");
    if (twoParts) {
      expect(summary).toBeNull();
      expect(tabpanel.querySelector("[data-almost-there]")).toBeNull();
      const rows = rowsOf(tabpanel);
      const rank = (node: HTMLElement) => {
        const label = node.getAttribute("aria-label") ?? "";
        if (label.startsWith("Hidden achievement")) return 3;
        if (label.endsWith(", earned")) return 0;
        return node.closest("[data-almost-there-id]") ? 1 : 2;
      };
      const ranks = rows.map(rank);
      expect(ranks).toEqual([...ranks].sort());
      expect(ranks).toContain(0);
      expect(ranks).toContain(1);
      expect(ranks[ranks.length - 1]).toBe(3);
      return;
    }
    const almost = tabpanel.querySelector("[data-almost-there]");
    expect(almost).toBeTruthy();
    if (hasSummary) expect(summary).toBeTruthy();
    else expect(summary).toBeNull();
    const listed = rowsOf(tabpanel).filter((node) => !node.closest("[data-almost-there]"));
    const rank = (node: HTMLElement) => {
      const label = node.getAttribute("aria-label") ?? "";
      if (label.startsWith("Hidden achievement")) return 2;
      return label.endsWith(", earned") ? 0 : 1;
    };
    const ranks = listed.map(rank);
    expect(ranks).toEqual([...ranks].sort());
    expect(ranks).toContain(0);
    expect(ranks[ranks.length - 1]).toBe(2);
    const firstEarned = listed[ranks.indexOf(0)];
    if (summary) expect(summary.compareDocumentPosition(almost!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(almost!.compareDocumentPosition(firstEarned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leads its almost-there part with the goal furthest along", () => {
    const { tabpanel } = rowPanel(true);
    if (twoParts) {
      expect(tabpanel.querySelector("[data-almost-there-id]")?.getAttribute("data-almost-there-id")).toBe("flow180");
      return;
    }
    const almost = tabpanel.querySelector("[data-almost-there]");
    expect(almost?.querySelector("[data-almost-there-id]")?.getAttribute("data-almost-there-id")).toBe("flow180");
  });

  it("lists every kept day of the opened achievement newest first, each opening that day, with the earlier times counted", () => {
    const { tabpanel, onOpenDay } = rowPanel(true);
    if (popup) {
      // The popup keeps the record short: first and latest day and how many times; the latest opens its day.
      fireEvent.click(screen.getByRole("button", { name: "Adrift, earned" }));
      const shell = screen.getByRole("dialog");
      const days = [...shell.querySelectorAll<HTMLElement>("[data-history-day]")];
      expect(days.map((node) => node.dataset.historyDay)).toEqual(["2026-11-07"]);
      expect(within(shell).getByText("5 times")).toBeTruthy();
      fireEvent.click(days[0]);
      expect(onOpenDay).toHaveBeenCalledWith("2026-11-07");
      return;
    }
    openRow("Adrift, earned");
    const region = openedRegion(tabpanel, "Adrift");
    expect(region).toBeTruthy();
    const days = [...(region?.querySelectorAll<HTMLElement>("[data-history-day]") ?? [])];
    expect(days.map((node) => node.dataset.historyDay)).toEqual(["2026-11-07", "2026-11-05", "2026-11-03"]);
    for (const node of days) fireEvent.click(node);
    expect(onOpenDay.mock.calls.map(([value]) => value)).toEqual(["2026-11-07", "2026-11-05", "2026-11-03"]);
    expect(region?.querySelector("[data-history-earlier]")?.getAttribute("data-history-earlier")).toBe("2");
  });

  it("counts held achievements by rarity tier, and shows no rarity words when rarity is unknown", () => {
    const withRarity = rowPanel(true);
    if (hasSummary) expect(withRarity.tabpanel.querySelector("[data-tier-summary]")?.textContent).toMatch(/Common|Uncommon|Rare|Legendary/);
    else expect(withRarity.tabpanel.querySelector("[data-tier-summary]")).toBeNull();
    cleanup();
    const { tabpanel } = rowPanel(false);
    expect(tabpanel.textContent).not.toMatch(/Common|Uncommon|Rare|Very rare|Legendary|of Drifty users|people have earned/);
  });
});
