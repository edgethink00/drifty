import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readStyles(): string {
  return readFileSync("src/styles.css", "utf8");
}

function cssBlock(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
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
    const collapsedTrackerToggleBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle");
    const collapsedAccountTriggerBlock = cssBlock(styles, ".sidebar--collapsed .account-trigger");

    expect(navTextBlock).toContain("max-width: 9rem;");
    expect(collapsedNavLabelBlock).toContain("padding: 4px 0;");
    expect(collapsedNavTextBlock).toContain("max-width: 0;");
    expect(collapsedNavTextBlock).not.toMatch(/(?:^|\n)\s*width:\s*0/);
    expect(collapsedLivePillBlock).toContain("width: 100%;");
    expect(collapsedLivePillBlock).toContain("max-height: 2.25rem;");
    expect(collapsedLivePillBlock).toContain("overflow: hidden;");
    expect(collapsedLiveStatusBlock).toContain("opacity: 1;");
    expect(collapsedLiveCopyBlock).toContain("max-height: 0;");
    expect(collapsedLiveCopyBlock).not.toMatch(/(?:^|\n)\s*width:\s*0/);
    expect(collapsedTrackerToggleBlock).toContain("width: 100%;");
    expect(collapsedAccountTriggerBlock).toContain("width: 100%;");
  });
});
