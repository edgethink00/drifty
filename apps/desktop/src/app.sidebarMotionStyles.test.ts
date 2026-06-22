import { describe, expect, it } from "vitest";
import { readAppStyles } from "./test/readStyles";

function readStyles(): string {
  return readAppStyles();
}

function cssBlock(styles: string, selector: string, occurrence: "first" | "last" = "first"): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(styles.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\s*\\}`, "g")));
  return (occurrence === "last" ? matches[matches.length - 1] : matches[0])?.[0] ?? "";
}

describe("sidebar motion styles", () => {
  it("moves the titlebar sidebar toggle with transform instead of left", () => {
    const styles = readStyles();
    const toggleBlock = cssBlock(styles, ".window-sidebar-toggle");
    const hoverBlock = cssBlock(styles, ".window-sidebar-toggle:hover");

    expect(toggleBlock).toContain("--window-sidebar-toggle-shift: 0px;");
    expect(toggleBlock).toContain("transform: translateX(var(--window-sidebar-toggle-shift));");
    expect(toggleBlock).not.toMatch(/left var\(--sidebar-duration\)/);
    expect(hoverBlock).toContain("transform: translateX(var(--window-sidebar-toggle-shift));");
  });

  it("collapses sidebar text and footer copy with max-size transitions", () => {
    const styles = readStyles();
    const navTextBlock = cssBlock(styles, ".nav-item span");
    const collapsedNavLabelBlock = cssBlock(styles, ".sidebar--collapsed .nav-label");
    const collapsedNavTextBlock = cssBlock(styles, ".sidebar--collapsed .nav-item span");
    const collapsedLivePillBlock = cssBlock(styles, ".sidebar--collapsed .live-pill");
    const collapsedLiveStatusBlock = cssBlock(styles, ".sidebar--collapsed .live-pill .k");
    const collapsedLiveCopyBlock =
      styles.match(/\.sidebar--collapsed \.live-pill \.app-name,\s*\.sidebar--collapsed \.live-pill \.app-class\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? "";
    const collapsedFooterControlsBlock =
      styles.match(/\.sidebar--collapsed \.live-pill,\s*\.sidebar--collapsed \.sidebar-tracker-toggle,\s*\.sidebar--collapsed \.account-menu-shell,\s*\.sidebar--collapsed \.account-trigger\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? "";
    const collapsedTrackerToggleBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle");
    const collapsedTrackerDotBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle::after");
    const collapsedTrackerPauseIconBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle[data-state=\"pause\"]::before");
    const collapsedAccountTriggerBlock = cssBlock(styles, ".sidebar--collapsed .account-trigger", "last");

    expect(navTextBlock).toContain("max-width: 9rem;");
    expect(collapsedNavLabelBlock).toContain("padding: 4px 0;");
    expect(collapsedNavTextBlock).toContain("max-width: 0;");
    expect(collapsedNavTextBlock).not.toMatch(/(?:^|\n)\s*width:\s*0/);
    expect(collapsedFooterControlsBlock).toContain("width: 2.25rem;");
    expect(collapsedFooterControlsBlock).toContain("max-width: 2.25rem;");
    expect(collapsedLivePillBlock).toContain("max-height: 2.25rem;");
    expect(collapsedLivePillBlock).toContain("overflow: hidden;");
    expect(collapsedLiveStatusBlock).toContain("opacity: 1;");
    expect(collapsedLiveCopyBlock).toContain("max-height: 0;");
    expect(collapsedLiveCopyBlock).not.toMatch(/(?:^|\n)\s*width:\s*0/);
    expect(collapsedTrackerToggleBlock).toContain("overflow: visible;");
    expect(collapsedTrackerDotBlock).toContain("display: block;");
    expect(collapsedTrackerPauseIconBlock).toContain("width: 6.3px;");
    expect(collapsedTrackerPauseIconBlock).toContain("height: 9px;");
    expect(collapsedAccountTriggerBlock).toContain("display: flex;");
    expect(collapsedAccountTriggerBlock).toContain("justify-content: center;");
  });
});
