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
    const navTextBlock = cssBlock(styles, ".nav-item > span:not(.nav-item__hover-label)");
    const collapsedNavLabelBlock = cssBlock(styles, ".sidebar--collapsed .nav-label");
    const collapsedSidebarBlock = cssBlock(styles, ".sidebar--collapsed");
    const collapsedNavTextBlock = cssBlock(styles, ".sidebar--collapsed .nav-item > span:not(.nav-item__hover-label)");
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
    expect(collapsedSidebarBlock).toContain("overflow: visible;");
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

  it("reveals collapsed sidebar hover labels with matching borderless typography", () => {
    const styles = readStyles();
    const hoverLabelBlock = cssBlock(styles, ".nav-item__hover-label");
    const collapsedHoverBlock = cssBlock(styles, ".sidebar--collapsed .nav-item:hover .nav-item__hover-label");
    const collapsedFocusBlock = cssBlock(styles, ".sidebar--collapsed .nav-item:focus-visible .nav-item__hover-label");
    const settingsHoverBlock = cssBlock(styles, ".sidebar--collapsed .settings-nav-item:hover .nav-item__hover-label");
    const settingsFocusBlock = cssBlock(styles, ".sidebar--collapsed .settings-nav-item:focus-visible .nav-item__hover-label");
    const reducedMotionBlock = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.nav-item__hover-label[\s\S]*?\n\}/)?.[0] ?? "";

    expect(hoverLabelBlock).toContain("position: absolute;");
    expect(hoverLabelBlock).toContain("pointer-events: none;");
    expect(hoverLabelBlock).toContain("border: none;");
    expect(hoverLabelBlock).toContain("box-shadow:");
    expect(hoverLabelBlock).toContain("0 12px 26px");
    expect(hoverLabelBlock).toContain("font-family: var(--font-sans);");
    expect(hoverLabelBlock).toContain("letter-spacing: 0;");
    expect(hoverLabelBlock).toContain("text-transform: none;");
    expect(hoverLabelBlock).toContain("opacity: 0;");
    expect(hoverLabelBlock).toMatch(/transition:\s*opacity var\(--transition-fast\),\s*transform var\(--transition-fast\);/);
    expect(hoverLabelBlock).not.toMatch(/transition:[^;]*(?:width|height|top|left|margin|padding)/);
    expect(collapsedHoverBlock).toContain("opacity: 1;");
    expect(collapsedHoverBlock).toContain("transform: translate3d(0, -50%, 0);");
    expect(collapsedFocusBlock).toContain("opacity: 1;");
    expect(settingsHoverBlock).toContain("opacity: 1;");
    expect(settingsFocusBlock).toContain("opacity: 1;");
    expect(reducedMotionBlock).toContain(".nav-item__hover-label");
  });

  it("keeps collapsed settings sidebar chrome inside the rail", () => {
    const styles = readStyles();
    const collapsedBackBlock = cssBlock(styles, ".sidebar--collapsed .settings-sidebar-back");
    const collapsedBackCopyBlock = cssBlock(styles, ".sidebar--collapsed .settings-sidebar-back span");
    const collapsedHeadingBlock = cssBlock(styles, ".sidebar--collapsed .settings-sidebar-heading");

    expect(collapsedBackBlock).toContain("justify-content: center;");
    expect(collapsedBackBlock).toContain("padding: 0;");
    expect(collapsedBackCopyBlock).toContain("max-width: 0;");
    expect(collapsedBackCopyBlock).toContain("opacity: 0;");
    expect(collapsedHeadingBlock).toContain("max-height: 0;");
    expect(collapsedHeadingBlock).toContain("opacity: 0;");
    expect(collapsedHeadingBlock).toContain("pointer-events: none;");
  });

  it("keeps the settings sidebar column the same width as the dashboard sidebar", () => {
    const styles = readStyles();
    const appShellBlock = cssBlock(styles, ".app-shell");
    const settingsShellBlock = cssBlock(styles, ".app-shell--settings");
    const settingsNavControlsBlock = cssBlock(styles, ".app-shell--settings .window-nav-controls");

    expect(appShellBlock).toContain("grid-template-columns: var(--sidebar-expanded-width) minmax(0, 1fr);");
    expect(settingsShellBlock).toContain("grid-template-columns: var(--sidebar-expanded-width) minmax(0, 1fr);");
    expect(settingsShellBlock).not.toContain("calc(var(--sidebar-expanded-width) + var(--space-7))");
    expect(settingsNavControlsBlock).toContain("left: calc(var(--sidebar-expanded-width) + 16px);");
  });
});
