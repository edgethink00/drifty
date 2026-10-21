import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  it("right-aligns Windows history controls to the expanded sidebar rail", () => {
    const styles = readStyles();
    const navigationBlock = cssBlock(styles, ':root[data-platform="windows"] .windows-titlebar-nav');
    const settingsNavigationBlock = cssBlock(styles, ':root[data-platform="windows"] .windows-titlebar-nav--settings');
    const historyBlock = cssBlock(styles, ':root[data-platform="windows"] .windows-titlebar-nav__history');
    const collapsedHistoryBlock = cssBlock(styles, ':root[data-platform="windows"] .windows-titlebar-nav--sidebar-collapsed .windows-titlebar-nav__history');
    const titlebarLeadingBlock = cssBlock(styles, ':root[data-platform="windows"] .windows-titlebar__leading');

    expect(navigationBlock).toContain("justify-content: space-between;");
    expect(styles).toContain("--sidebar-content-width: calc(");
    expect(styles).toContain("--sidebar-cta-slot-width: var(--sidebar-content-width);");
    expect(navigationBlock).toContain("width: var(--sidebar-content-width);");
    expect(navigationBlock).not.toMatch(/transition:[^;]*width/);
    expect(settingsNavigationBlock).toContain("justify-content: flex-end;");
    expect(historyBlock).toContain("flex: 0 0 var(--windows-titlebar-history-width);");
    expect(historyBlock).toContain("gap: var(--windows-titlebar-nav-gap);");
    expect(historyBlock).toContain("transition: transform var(--sidebar-duration) var(--sidebar-ease);");
    expect(collapsedHistoryBlock).toContain("transform: translateX(var(--windows-titlebar-collapsed-history-shift));");
    expect(titlebarLeadingBlock).toContain("pointer-events: none;");
    expect(styles).toMatch(/\.window-sidebar-toggle--titlebar,[\s\S]*?\.windows-titlebar-nav-button\s*\{[\s\S]*?pointer-events: auto;/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.windows-titlebar-nav__history,/);
  });

  it("keeps the Windows titlebar draggable around its trailing pills", () => {
    // jsdom cannot hit-test, so pin the pair that leaves the gaps between and
    // around the status and update pills to the drag region underneath.
    const styles = readStyles();

    expect(cssBlock(styles, ':root[data-platform="windows"] .windows-titlebar__trailing')).toContain("pointer-events: none;");
    expect(cssBlock(styles, ':root[data-platform="windows"] .windows-titlebar__trailing > *')).toContain("pointer-events: auto;");
  });

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
    expect(styles).toContain("--nav-item-height: 30px;");
  });

  it("groups dashboard and activity with labels instead of a period divider", () => {
    const styles = readStyles();
    expect(styles).not.toMatch(/\.sidebar-nav--periods\s*\{[^}]*border-bottom/);
    expect(styles).not.toMatch(/\.sidebar-nav--periods\s*\{[^}]*margin-bottom:\s*16px/);
    expect(styles).not.toMatch(/\.sidebar-nav--periods\s*\{[^}]*padding-bottom:\s*14px/);
    expect(styles).not.toMatch(/\.sidebar--collapsed \.sidebar-nav--periods\s*\{[^}]*margin-bottom:\s*16px/);
    expect(styles).not.toMatch(/\.sidebar--collapsed \.sidebar-nav--periods\s*\{[^}]*padding-bottom:\s*14px/);
  });

  it("fades collapsed rail copy in place and keeps the footer chip on the rail", () => {
    const styles = readStyles();
    const navTextBlock = cssBlock(styles, ".nav-item > span:not(.nav-item__hover-label):not(.status-badge)");
    const collapsedBrandBlock = cssBlock(styles, ".sidebar--collapsed .brand");
    const collapsedNavLabelBlock = cssBlock(styles, ".sidebar--collapsed .nav-label");
    const collapsedSidebarBlock = cssBlock(styles, ".sidebar--collapsed");
    const collapsedNavTextBlock = cssBlock(styles, ".sidebar--collapsed .nav-item > span:not(.nav-item__hover-label):not(.status-badge)");
    const collapsedAccountWidthBlock =
      styles.match(/\.sidebar--collapsed \.account-trigger\s*\{\s*width: var\(--sidebar-collapsed-account-width\);[\s\S]*?\n\s*\}/)?.[0] ?? "";
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
    // The label keeps its width and fades where it sits; snapping it to 0 made
    // it vanish at frame zero, and letting it shrink squeezed it into the rail.
    expect(collapsedNavTextBlock).not.toContain("max-width: 0;");
    expect(collapsedNavTextBlock).toContain("flex-shrink: 0;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapsed-account-width: 100%;");
    expect(collapsedAccountWidthBlock).toContain("max-width: var(--sidebar-collapsed-account-width);");
    expect(collapsedAccountWidthBlock).not.toContain("var(--sidebar-expanded-width)");
    expect(collapsedAccountTriggerBlock).toContain("grid-template-columns: 30px calc(var(--sidebar-content-width) - 76px) 16px;");
    expect(collapsedAccountTriggerBlock).toContain("overflow: clip;");
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
    const collapsedAccountTriggerBlock = cssBlock(styles, ".sidebar--collapsed .account-trigger", "last");
    const collapsedRailWidthBlock =
      styles.match(/\.sidebar--collapsed \.brand,\s*\.sidebar--collapsed \.nav-label,\s*\.sidebar--collapsed \.sidebar-nav,\s*\.sidebar--collapsed \.settings-sidebar-back,\s*\.sidebar--collapsed \.settings-nav,\s*\.sidebar--collapsed \.sidebar-foot\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? "";
    const reducedMotionBlock = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition-duration: 0\.01ms !important;[\s\S]*?\n\}/)?.[0] ?? "";

    expect(collapsedSidebarBlock).toContain("align-items: flex-start;");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-brand-align-x: var(--sidebar-collapse-mark-align-x);");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-nav-icon-align-x: var(--sidebar-collapse-mark-align-x);");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-settings-icon-align-x: var(--sidebar-collapse-mark-align-x);");
    expect(collapsedSidebarBlock).toContain("--sidebar-collapse-account-align-x: 0px;");
    expect(collapsedSidebarBlock).toContain("- (var(--sidebar-collapsed-gutter) - var(--sidebar-inline-gutter))");
    expect(collapsedSidebarBlock).toContain("padding: var(--window-chrome-height) var(--sidebar-collapsed-gutter) var(--content-panel-gap);");
    expect(cssBlock(styles, ".sidebar--collapsed .account-avatar-wrap")).toContain("transform: translateX(var(--sidebar-collapse-account-avatar-align-x));");
    expect(cssBlock(styles, ".account-avatar-wrap", "last")).toContain("transition: transform var(--sidebar-duration) var(--sidebar-ease);");
    // The scroll box lends 4px per side to focus rings (margin-inline -4px,
    // padding-inline 4px), so the collapsed box is 8px wider and its content
    // box still matches the rail.
    const scrollBlock = cssBlock(styles, ".sidebar-scroll");
    expect(scrollBlock).toContain("margin-inline: -4px;");
    expect(scrollBlock).toContain("padding-inline: 4px;");
    expect(collapsedScrollBlock).toContain("width: calc(100% + 8px);");
    expect(collapsedScrollBlock).toContain("min-width: 0;");
    expect(collapsedBrandBlock).toContain("transform: translateX(var(--sidebar-collapse-brand-align-x));");
    expect(collapsedBrandLogoBlock).not.toContain("transform:");
    expect(navItemMotionBlock).not.toMatch(/transition:[^;]*(?:width|padding)/);
    expect(navLabelMotionBlock).not.toMatch(/transition:[^;]*(?:width|max-width|padding|margin)/);
    expect(collapsedNavItemBlock).toContain("min-width: 0;");
    expect(collapsedNavIconBlock).toContain("transform: translateX(var(--sidebar-collapse-nav-icon-align-x));");
    expect(collapsedSettingsIconBlock).toContain("transform: translateX(var(--sidebar-collapse-settings-icon-align-x));");
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

  it("names collapsed rail icons in a body-level label with matching borderless typography", () => {
    const styles = readStyles();
    const hoverLabelBlock = cssBlock(styles, ".nav-item__hover-label");
    // The rail clips its overflow, which hid the in-button label; the name is
    // drawn by CollapsedRailTooltip outside the rail instead.
    const inButtonLabelBlock = cssBlock(styles, ".nav-item > .nav-item__hover-label");
    const railTooltipBlock = cssBlock(styles, ".nav-item__hover-label.rail-tooltip");
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
    expect(inButtonLabelBlock).toContain("display: none;");
    expect(railTooltipBlock).toContain("position: fixed;");
    expect(railTooltipBlock).toContain("opacity: 1;");
    expect(railTooltipBlock).toContain("transform: translate3d(0, -50%, 0);");
    expect(settingsHoverBlock).toContain("opacity: 1;");
    expect(settingsFocusBlock).toContain("opacity: 1;");
    expect(reducedMotionBlock).toContain(".nav-item__hover-label");
    expect(styles).toMatch(/\.nav-item__hover-label\.rail-tooltip \{\s*animation: none;/);
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

  it("fades collapsed copy where it sits instead of squeezing it through the shrinking rail", () => {
    const styles = readStyles();
    const navLabelMotionBlock = cssBlock(styles, ".nav-item > span:not(.nav-item__hover-label):not(.status-badge)", "last");
    const collapsedNavItemBlock = cssBlock(styles, ".sidebar--collapsed .nav-item");
    const collapsedCardBlock = cssBlock(styles, ".sidebar--collapsed .sidebar-cta-slot-wrap");

    expect(navLabelMotionBlock).not.toMatch(/transition:[^;]*(?:width|max-width|padding|margin)/);
    // The card fades out above the account row, then leaves the rail's height
    // to the menu; it comes back only after the rail has opened.
    expect(collapsedCardBlock).toContain("visibility: hidden;");
    expect(collapsedCardBlock).toContain("opacity: 0;");
    expect(collapsedCardBlock).toContain("position: absolute;");
    expect(collapsedCardBlock).toContain("bottom: calc(100% + 6px);");
    expect(collapsedCardBlock).toContain("width: calc(var(--sidebar-content-width) + 24px);");
    expect(collapsedCardBlock).toMatch(/visibility 0s linear var\(--sidebar-fade-duration\)/);
    expect(cssBlock(styles, ".app-shell:not(.app-shell--sidebar-collapsed) .sidebar-cta-slot-wrap")).toContain(
      "transition: opacity var(--sidebar-fade-duration) ease-out var(--sidebar-duration);",
    );
    expect(collapsedNavItemBlock).toContain("justify-content: flex-start;");
    expect(collapsedNavItemBlock).toContain("width: 100%;");
    expect(collapsedNavItemBlock).toContain("padding: 0 var(--sidebar-row-inline-padding);");
  });

  it("draws collapsed rail chips as squares whose height rides the collapse", () => {
    const styles = readStyles();
    const collapsedNavItemBlock = cssBlock(styles, ".sidebar--collapsed .nav-item");
    const navItemMotionBlock = cssBlock(styles, ".nav-item", "last");
    const navLabelBlock = cssBlock(styles, ".nav-label");
    const navListBlock = cssBlock(styles, ".sidebar-nav");

    expect(styles).toContain("--sidebar-collapsed-chip-size: 36px;");
    expect(styles).toContain("--sidebar-collapsed-chip-gap: 2px;");
    expect(styles).toContain("--sidebar-collapsed-chip-radius: 10px;");
    expect(collapsedNavItemBlock).toContain("height: var(--sidebar-collapsed-chip-size);");
    expect(collapsedNavItemBlock).toContain("border-radius: var(--sidebar-collapsed-chip-radius);");
    expect(cssBlock(styles, ".sidebar--collapsed .sidebar-nav")).toContain("gap: var(--sidebar-collapsed-chip-gap);");
    expect(cssBlock(styles, ".sidebar .nav-item")).toContain("height: var(--nav-item-height);");
    expect(navItemMotionBlock).toContain("height var(--sidebar-duration) var(--sidebar-ease)");
    expect(navItemMotionBlock).toContain("border-radius var(--sidebar-duration) var(--sidebar-ease)");
    // While an expand starts the rail is still narrow: labels must not wrap
    // and rows must follow the rail, not the widest label.
    expect(navLabelBlock).toContain("white-space: nowrap;");
    expect(navListBlock).toContain("grid-template-columns: minmax(0, 1fr);");
  });


  it("keeps no sidebar tracker card styles now that tracking lives in the account menu", () => {
    const styles = readStyles();

    expect(styles).not.toContain(".tracker-control");
    expect(styles).not.toContain(".live-pill");
    expect(styles).not.toContain(".sidebar-tracker-toggle");
    expect(styles).not.toContain("--sidebar-tracker-row");
  });

  // Owner choice 2026-10-07: the menu tracker block is grouped by its fill
  // alone, and a stopped tracker keeps the sidebar card's red dot.
  it("draws the account menu tracker block without an outline and a stopped tracker as a red dot", () => {
    const styles = readFileSync(resolve("src/features/auth/AccountMenuTracker.css"), "utf8");
    const block = cssBlock(styles, ".account-menu-tracker-block");
    const control = cssBlock(styles, ".account-tracker-control");

    expect(block).toContain("box-shadow: none;");
    expect(block).not.toContain("inset 0 0 0 1px");
    expect(control).not.toContain("inset 0 0 0 1px");
    expect(styles).toMatch(/\.account-tracker-dot\[data-state="resume"\]\s*\{\s*background:\s*var\(--warn\);/);
  });

  it("lets the CTA glow sit in a wrap bleed instead of clipping at the card edge", () => {
    const styles = readFileSync(resolve("src/features/sidebar/SidebarCtaSlot.css"), "utf8");
    const wrap = cssBlock(styles, ".sidebar-cta-slot-wrap");
    const tone = cssBlock(styles, ".sidebar-cta-slot[data-tone]");

    expect(wrap).toContain("margin: -12px;");
    expect(wrap).toContain("padding: 12px;");
    expect(wrap).toContain("overflow-x: clip;");
    expect(tone).toContain("0 6px 14px");
    expect(tone).not.toContain("0 10px 24px");
  });

  it("keeps the sidebar card translucent enough to sit in the glass rail", () => {
    const styles = readFileSync(resolve("src/features/sidebar/SidebarCtaSlot.css"), "utf8");
    const tone = cssBlock(styles, ".sidebar-cta-slot[data-tone]");
    const darkTone = cssBlock(styles, ':root[data-theme="dark"] .sidebar-cta-slot[data-tone]');

    expect(tone).toContain("--cta-surface-alpha: 86%;");
    expect(darkTone).toContain("--cta-surface-alpha: 90%;");
    expect(tone).not.toContain("--cta-surface-alpha: 95%;");
    expect(darkTone).not.toContain("--cta-surface-alpha: 97%;");
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
    expect(styles).toContain("--sidebar-row-inline-padding: 7.5px;");
    expect(sidebarBlock).toContain("padding: var(--window-chrome-height) var(--sidebar-inline-gutter) var(--content-panel-gap);");
    expect(settingsSidebarBlock).toContain("padding-inline: var(--sidebar-inline-gutter);");
    expect(navItemBlock).toContain("padding: 0 var(--sidebar-row-inline-padding);");
    expect(navLabelBlock).toContain("padding: 12px var(--sidebar-row-inline-padding) 4px;");
    expect(settingsBackBlock).toContain("padding: 0 var(--sidebar-row-inline-padding);");
    expect(settingsBackBlock).toContain("min-height: var(--nav-item-height);");
    expect(styles).not.toMatch(/:root\[data-platform="windows"\] \.sidebar--settings \.settings-sidebar-back\s*\{[^}]*display:\s*none;/);
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
    expect(iconSvgBlock).toContain("width: var(--sidebar-nav-icon-size);");
    expect(iconSvgBlock).toContain("height: var(--sidebar-nav-icon-size);");
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
