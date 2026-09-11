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

/**
 * The collapsed play/pause control is declared twice: once as the real rule and
 * once inside the reduced-motion opt-out. Positional lookups ("first"/"last")
 * silently pick the wrong one when either moves, so select the rule that owns
 * the plate geometry.
 */
function collapsedToggleRule(styles: string): string {
  const blocks = Array.from(
    styles.matchAll(/\.sidebar--collapsed \.sidebar-tracker-toggle\s*\{[\s\S]*?\n\s*\}/g),
  ).map((match) => match[0]);
  const rule = blocks.find((block) => block.includes("height:"));
  if (!rule) throw new Error("collapsed tracker toggle rule not found");
  return rule;
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

  it("keeps one-line dashboard period items on the primary nav vertical rhythm", () => {
    const styles = readStyles();
    const navItemBlock = cssBlock(styles, ".nav-item");
    const periodTextBlock = cssBlock(styles, ".nav-item--period > span:not(.nav-item__hover-label)");

    // Row height now comes from the shared --nav-item-height token, so period
    // rows inherit the primary nav rhythm instead of re-declaring their own
    // vertical padding.
    expect(navItemBlock).toContain("min-height: var(--nav-item-height);");
    expect(navItemBlock).toContain("padding: 0 var(--sidebar-row-inline-padding);");
    expect(styles).not.toMatch(/\.nav-item\.nav-item--period\s*\{[^}]*padding-block/);
    expect(periodTextBlock).toContain("line-height: inherit;");
  });

  it("groups dashboard and activity with labels instead of a period divider", () => {
    const styles = readStyles();
    expect(styles).not.toMatch(/\.sidebar-nav--periods\s*\{[^}]*border-bottom/);
    expect(styles).not.toMatch(/\.sidebar-nav--periods\s*\{[^}]*margin-bottom:\s*16px/);
    expect(styles).not.toMatch(/\.sidebar-nav--periods\s*\{[^}]*padding-bottom:\s*14px/);
    expect(styles).not.toMatch(/\.sidebar--collapsed \.sidebar-nav--periods\s*\{[^}]*margin-bottom:\s*16px/);
    expect(styles).not.toMatch(/\.sidebar--collapsed \.sidebar-nav--periods\s*\{[^}]*padding-bottom:\s*14px/);
  });

  it("collapses sidebar text and footer copy with max-size transitions", () => {
    const styles = readStyles();
    const navTextBlock = cssBlock(styles, ".nav-item > span:not(.nav-item__hover-label):not(.status-badge)");
    const collapsedBrandBlock = cssBlock(styles, ".sidebar--collapsed .brand");
    const collapsedNavLabelBlock = cssBlock(styles, ".sidebar--collapsed .nav-label");
    const collapsedSidebarBlock = cssBlock(styles, ".sidebar--collapsed");
    const collapsedNavTextBlock = cssBlock(styles, ".sidebar--collapsed .nav-item > span:not(.nav-item__hover-label):not(.status-badge)");
    const collapsedLivePillBlock = cssBlock(styles, ".sidebar--collapsed .live-pill");
    const collapsedLiveStatusBlock = cssBlock(styles, ".sidebar--collapsed .live-pill .k");
    const collapsedLiveCopyBlock =
      styles.match(/\.sidebar--collapsed \.live-pill \.app-name,\s*\.sidebar--collapsed \.live-pill \.app-class\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? "";
    const collapsedTrackerControlBlock = cssBlock(styles, ".sidebar--collapsed .tracker-control");
    const collapsedAccountWidthBlock =
      styles.match(/\.sidebar--collapsed \.account-trigger\s*\{\s*width: var\(--sidebar-collapsed-account-width\);[\s\S]*?\n\s*\}/)?.[0] ?? "";
    const collapsedTrackerToggleBlock = collapsedToggleRule(styles);
    const collapsedTrackerToggleLabelBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle span");
    const collapsedTrackerIconBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle::before");
    const collapsedTrackerDotBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle::after");
    const collapsedTrackerResumeIconBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle[data-state=\"resume\"]::before");
    const collapsedTrackerPauseIconBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle[data-state=\"pause\"]::before");
    const collapsedAccountTriggerBlock = cssBlock(styles, ".sidebar--collapsed .account-trigger", "last");

    expect(navTextBlock).toContain("max-width: 9rem;");
    /* overflow-x: clip paired with overflow-y: hidden computes back to hidden,
       which restores the scrollport that hid the avatar. */
    expect(collapsedSidebarBlock).toContain("overflow: clip;");
    expect(collapsedSidebarBlock).not.toContain("overflow-y: hidden;");
    expect(collapsedBrandBlock).toContain("justify-content: flex-start;");
    expect(collapsedBrandBlock).toContain("margin: 0 0 4px;");
    expect(collapsedNavLabelBlock).toContain("padding: 12px 10px 4px;");
    expect(collapsedNavTextBlock).toContain("opacity: 0;");
    expect(collapsedNavTextBlock).toContain("max-width: 0;");
    expect(collapsedTrackerControlBlock).toContain("width: 2.25rem;");
    expect(collapsedTrackerControlBlock).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(collapsedTrackerControlBlock).toContain("padding: 0;");
    expect(collapsedTrackerControlBlock).toContain("background: transparent;");
    expect(collapsedTrackerControlBlock).toContain("box-shadow: none;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapsed-account-width: 38px;");
    expect(collapsedAccountWidthBlock).toContain("max-width: var(--sidebar-collapsed-account-width);");
    expect(collapsedAccountWidthBlock).not.toContain("var(--sidebar-expanded-width)");
    expect(collapsedLivePillBlock).toContain("place-items: center;");
    expect(collapsedLiveStatusBlock).toContain("width: 8px;");
    expect(collapsedLiveStatusBlock).not.toContain("display: none;");
    expect(collapsedLiveCopyBlock).toContain("opacity: 0;");
    expect(collapsedTrackerToggleBlock).toContain("height: 2.25rem;");
    expect(collapsedTrackerToggleBlock).toContain("place-content: center;");
    expect(collapsedTrackerToggleBlock).toContain("sidebar-collapsed-toggle-ride");
    expect(collapsedTrackerPauseIconBlock).toContain("width: 6.3px;");
    expect(collapsedTrackerPauseIconBlock).toContain("height: 9px;");
  });

  it("pins collapsed rail boxes while their marks ride onto one center axis", () => {
    const styles = readStyles();
    const collapsedSidebarBlock = cssBlock(styles, ".sidebar--collapsed");
    const collapsedScrollBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-scroll");
    const collapsedBrandBlock = cssBlock(styles, ".sidebar--collapsed .brand");
    const collapsedBrandLogoBlock = cssBlock(styles, ".sidebar--collapsed .brand__logo");
    const navItemMotionBlock = cssBlock(styles, ".nav-item", "last");
    const navLabelMotionBlock = cssBlock(styles, ".nav-item > span:not(.nav-item__hover-label):not(.status-badge)", "last");
    const collapsedNavItemBlock = cssBlock(styles, ".sidebar--collapsed .nav-item");
    const collapsedNavIconBlock = cssBlock(styles, ".sidebar--collapsed .nav-item > svg");
    const collapsedSettingsIconBlock = cssBlock(styles, ".sidebar--collapsed .settings-nav-item__icon");
    const collapsedTrackerControlBlock = cssBlock(styles, ".sidebar--collapsed .tracker-control");
    const collapsedAccountTriggerBlock = cssBlock(styles, ".sidebar--collapsed .account-trigger", "last");
    const collapsedRailWidthBlock =
      styles.match(/\.sidebar--collapsed \.brand,\s*\.sidebar--collapsed \.nav-label,\s*\.sidebar--collapsed \.sidebar-nav,\s*\.sidebar--collapsed \.settings-sidebar-back,\s*\.sidebar--collapsed \.settings-nav,\s*\.sidebar--collapsed \.sidebar-foot\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? "";
    const reducedMotionBlock = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition-duration: 0\.01ms !important;[\s\S]*?\n\}/)?.[0] ?? "";

    expect(collapsedSidebarBlock).toContain("align-items: flex-start;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-brand-align-x: 1px;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-nav-icon-align-x: 2px;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-settings-icon-align-x: 1px;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-tracker-align-x: 1px;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-account-align-x: 0px;");
    expect(collapsedScrollBlock).toContain("width: 100%;");
    expect(collapsedScrollBlock).toContain("min-width: 0;");
    expect(collapsedBrandBlock).toContain("transform: translateX(var(--sidebar-collapse-brand-align-x));");
    expect(collapsedBrandLogoBlock).not.toContain("transform:");
    expect(navItemMotionBlock).not.toMatch(/transition:[^;]*(?:width|padding)/);
    expect(navLabelMotionBlock).not.toMatch(/transition:[^;]*(?:width|max-width|padding|margin)/);
    expect(collapsedNavItemBlock).toContain("min-width: 0;");
    expect(collapsedNavIconBlock).toContain("transform: translateX(var(--sidebar-collapse-nav-icon-align-x));");
    expect(collapsedSettingsIconBlock).toContain("transform: translateX(var(--sidebar-collapse-settings-icon-align-x));");
    expect(collapsedTrackerControlBlock).toContain("transform: translateX(var(--sidebar-collapse-tracker-align-x));");
    expect(collapsedAccountTriggerBlock).toContain("transform: translateX(var(--sidebar-collapse-account-align-x));");
    expect(styles).toMatch(/\.nav-item > svg\s*\{[^}]*transition:\s*transform var\(--sidebar-duration\) var\(--sidebar-ease\);/);
    expect(styles).toMatch(/\.settings-nav-item__icon\s*\{[^}]*transform var\(--sidebar-duration\) var\(--sidebar-ease\)/);
    expect(reducedMotionBlock).toContain(".nav-item > svg");
    expect(reducedMotionBlock).toContain(".settings-nav-item__icon");
    expect(collapsedRailWidthBlock).toContain(".sidebar--collapsed .brand");
    expect(collapsedRailWidthBlock).toContain(".sidebar--collapsed .sidebar-nav");
    expect(collapsedRailWidthBlock).toContain(".sidebar--collapsed .sidebar-foot");
    expect(collapsedRailWidthBlock).toContain("width: 100%;");
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
    const collapsedNavLabelBlock = cssBlock(styles, ".sidebar--collapsed .nav-label");

    expect(collapsedBackBlock).toContain("justify-content: center;");
    expect(collapsedBackBlock).toContain("padding: 0;");
    expect(collapsedBackCopyBlock).toContain("max-width: 0;");
    expect(collapsedBackCopyBlock).toContain("opacity: 0;");
    expect(collapsedNavLabelBlock).toContain("overflow: hidden;");
    expect(collapsedNavLabelBlock).toContain("color: transparent;");
  });

  it("keeps collapsed section labels from wrapping in the narrow rail", () => {
    const styles = readStyles();
    const collapsedNavLabelBlock = cssBlock(styles, ".sidebar--collapsed .nav-label");

    expect(collapsedNavLabelBlock).toContain("overflow: hidden;");
    expect(collapsedNavLabelBlock).toContain("white-space: nowrap;");
    expect(collapsedNavLabelBlock).toContain("color: transparent;");
  });

  it("hides collapsed copy immediately instead of squeezing it through the shrinking rail", () => {
    const styles = readStyles();
    const expandedLiveStatusBlock = cssBlock(styles, ".app-shell:not(.app-shell--sidebar-collapsed) .live-pill .k");
    const navLabelMotionBlock = cssBlock(styles, ".nav-item > span:not(.nav-item__hover-label):not(.status-badge)", "last");
    const collapsedNavItemBlock = cssBlock(styles, ".sidebar--collapsed .nav-item");

    expect(expandedLiveStatusBlock).toContain("display: none;");
    expect(navLabelMotionBlock).not.toMatch(/transition:[^;]*(?:width|max-width|padding|margin)/);
    expect(cssBlock(styles, ".sidebar--collapsed .sidebar-cta-slot-wrap")).toContain("visibility: hidden;");
    expect(cssBlock(styles, ".sidebar--collapsed .sidebar-cta-slot-wrap")).toContain("transition: none;");
    expect(cssBlock(styles, ".sidebar--collapsed .live-pill .k")).toContain("width: 8px;");
    expect(collapsedToggleRule(styles)).toContain("height: 2.25rem;");
    expect(collapsedToggleRule(styles)).toContain("sidebar-collapsed-toggle-ride");
    expect(cssBlock(styles, ".sidebar--collapsed .sidebar-tracker-toggle[data-state=\"pause\"]::before")).toContain("width: 6.3px;");
    expect(collapsedNavItemBlock).toContain("justify-content: flex-start;");
    expect(collapsedNavItemBlock).toContain("width: 100%;");
    expect(collapsedNavItemBlock).toContain("padding: 0 10px;");
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

  it("keeps main and Settings sidebar rows on one horizontal grid", () => {
    const styles = readStyles();
    const sidebarBlock = cssBlock(styles, ".sidebar");
    const settingsSidebarBlock = cssBlock(styles, ".sidebar--settings");
    const navItemBlock = cssBlock(styles, ".nav-item");
    const navLabelBlock = cssBlock(styles, ".nav-label");
    const settingsBackBlock = cssBlock(styles, ".settings-sidebar-back");
    const settingsNavItemBlock = cssBlock(styles, ".sidebar--settings .settings-nav-item");
    const settingsNavLabelBlock = cssBlock(styles, ".sidebar--settings .nav-label");

    expect(styles).toContain("--sidebar-inline-gutter: 8px;");
    expect(styles).toContain("--sidebar-row-inline-padding: 10px;");
    expect(sidebarBlock).toContain("padding: var(--window-chrome-height) var(--sidebar-inline-gutter) var(--content-panel-gap);");
    expect(settingsSidebarBlock).toContain("padding-inline: var(--sidebar-inline-gutter);");
    expect(navItemBlock).toContain("padding: 0 var(--sidebar-row-inline-padding);");
    expect(navLabelBlock).toContain("padding: 12px var(--sidebar-row-inline-padding) 4px;");
    expect(settingsBackBlock).toContain("padding: 0 var(--sidebar-row-inline-padding);");
    expect(settingsBackBlock).toContain("min-height: var(--nav-item-height);");
    expect(settingsNavLabelBlock).toContain("padding-top: 10px;");
    expect(settingsNavItemBlock).toContain("padding: 0 var(--sidebar-row-inline-padding);");
    expect(settingsNavItemBlock).not.toContain("overflow: hidden;");
    expect(settingsNavItemBlock).not.toContain("text-overflow: ellipsis;");
    expect(settingsNavItemBlock).not.toContain("white-space: nowrap;");
  });

  it("centers settings nav glyphs in a square slot and ellipsizes the label", () => {
    const styles = readStyles();
    const settingsNavItemBlock = cssBlock(styles, ".settings-nav-item");
    const iconBlock = cssBlock(styles, ".settings-nav-item__icon");
    const iconSvgBlock = cssBlock(styles, ".settings-nav-item__icon svg");
    const labelBlock = cssBlock(styles, ".settings-nav-item__label");
    const settingsRowBlock = cssBlock(styles, ".sidebar--settings .settings-nav-item");

    expect(settingsNavItemBlock).toContain("display: flex;");
    expect(settingsNavItemBlock).toContain("align-items: center;");
    expect(iconBlock).toContain("display: inline-flex;");
    expect(iconBlock).toContain("width: 16px;");
    expect(iconBlock).toContain("height: 16px;");
    expect(iconBlock).toContain("flex: 0 0 16px;");
    expect(iconBlock).toContain("align-items: center;");
    expect(iconBlock).toContain("justify-content: center;");
    expect(iconBlock).toContain("line-height: 0;");
    expect(iconBlock).toContain("overflow: visible;");
    expect(iconSvgBlock).toContain("width: 15px;");
    expect(iconSvgBlock).toContain("height: 15px;");
    expect(iconSvgBlock).toContain("display: block;");
    expect(iconSvgBlock).toContain("overflow: visible;");
    expect(iconSvgBlock).toContain("transform: translateY(0.5px);");
    expect(labelBlock).toContain("min-width: 0;");
    expect(labelBlock).toContain("display: flex;");
    expect(labelBlock).toContain("align-items: center;");
    expect(labelBlock).toContain("height: 16px;");
    expect(labelBlock).toContain("overflow: hidden;");
    expect(labelBlock).toContain("text-overflow: ellipsis;");
    expect(labelBlock).toContain("white-space: nowrap;");
    expect(labelBlock).toContain("line-height: 1;");
    expect(settingsRowBlock).not.toContain("overflow: hidden;");
    expect(settingsRowBlock).not.toContain("text-overflow: ellipsis;");
    expect(settingsRowBlock).not.toContain("white-space: nowrap;");
  });
});
