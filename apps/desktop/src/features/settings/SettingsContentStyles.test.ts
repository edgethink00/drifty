import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

function readAiSetupStyles(): string {
  return [
    "src/features/settings/AiSetupPanel.css",
    "src/features/settings/AiSetupProviderRows.css",
    "src/features/settings/AiSetupProviderDetails.css",
    "src/features/settings/AiSetupSupportSections.css",
    "src/features/settings/AiSetupWorkProfileSection.css",
    "src/features/settings/AiSetupPrivacyReview.css",
    "src/features/settings/AiSetupPanelResponsive.css",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
}

describe("Settings content styles", () => {
  it("presents direct settings block headings outside the grouped rows", () => {
    const styles = readAppStyles();
    const blockRule = cssRule(styles, ".content--settings .settings-block:has(> h3)");
    const headingRule = cssRule(styles, ".content--settings .settings-block > h3");

    expect(blockRule).toContain("background: transparent;");
    expect(blockRule).toContain("box-shadow: none;");
    expect(headingRule).toContain("border-bottom: 0;");
    expect(headingRule).toContain("padding: 0 0 0 0.5rem;");
    expect(headingRule).toContain("font-size: 0.94rem;");
    expect(headingRule).toContain("font-weight: 620;");
  });

  it("uses inset separators inside grouped settings rows", () => {
    const styles = readAppStyles();
    const rowRule = cssRule(styles, ".content--settings .settings-block:has(> h3) > .settings-row");
    const separatorRule = cssRule(
      styles,
      ".content--settings .settings-block:has(> h3) > .settings-row:not(:last-child):not(.settings-row--group-end)::after",
    );

    expect(rowRule).toContain("border-right: 1px solid var(--line);");
    expect(rowRule).toContain("border-top: 0;");
    expect(rowRule).toContain("border-bottom: 0;");
    expect(rowRule).toContain("border-left: 1px solid var(--line);");
    expect(rowRule).not.toContain("border-bottom: 1px solid var(--line);");
    expect(separatorRule).toContain("left: 1rem;");
    expect(separatorRule).toContain("right: 1rem;");
    expect(separatorRule).toContain("background: var(--line);");
    expect(styles).toContain(".content--settings .settings-block:has(> h3) > .settings-row--group-end");
    expect(styles).toContain("border-bottom: 1px solid var(--line);");
  });

  it("emphasizes the top heading of every settings section", () => {
    const styles = readAppStyles();
    const sectionHeadingRule = cssRule(
      styles,
      ".content--settings .settings-section .settings-block:first-child > h3",
    );
    const aiSetupHeadingRule = cssRule(
      styles,
      ".content--settings .settings-section--ai-setup .ai-setup-panel__header h3",
    );

    expect(sectionHeadingRule).toContain("font-size: 1.18rem;");
    expect(sectionHeadingRule).toContain("font-weight: 700;");
    expect(aiSetupHeadingRule).toContain("font-size: 1.18rem;");
    expect(aiSetupHeadingRule).toContain("font-weight: 700;");
  });

  it("keeps settings segmented controls outline-free like AI setup tabs", () => {
    const styles = readAppStyles();
    const switchRules = [
      cssRule(styles, ".content--settings .settings-mode-switch"),
      cssRule(styles, ".content--settings .settings-section--appearance .settings-mode-switch"),
      cssRule(styles, ".content--settings .settings-mode-switch--compact"),
    ];
    const activeRules = [
      cssRule(styles, ".content--settings .settings-mode-option.is-active"),
      cssRule(styles, ".content--settings .settings-section--appearance .settings-mode-option.is-active"),
      cssRule(styles, ".content--settings .settings-mode-switch--compact .settings-mode-option.is-active"),
    ];

    expect(switchRules.every((rule) => rule.includes("border: 1px solid transparent;"))).toBe(true);
    expect(switchRules.every((rule) => rule.includes("box-shadow: none;"))).toBe(true);
    expect(activeRules.every((rule) => rule.includes("border-color: transparent;"))).toBe(true);
    expect(activeRules.every((rule) => rule.includes("box-shadow: none;"))).toBe(true);
  });

  it("keeps focused classification rule suggestions above adjacent rule fields", () => {
    const styles = readAppStyles();
    const searchRule = cssRule(styles, ".classification-rule-search");
    const focusedSearchRule = cssRule(styles, ".classification-rule-search:focus-within");
    const popoverRule = cssRule(styles, ".classification-rule-search__popover");

    expect(searchRule).toContain("z-index: 3;");
    expect(focusedSearchRule).toContain("z-index: 24;");
    expect(popoverRule).toContain("z-index: 25;");
  });

  it("keeps AI setup provider rows compact", () => {
    const aiSetupStyles = readAiSetupStyles();
    const toggleRule = cssRule(aiSetupStyles, ".ai-setup-choice__toggle");
    const brandMarkRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark");
    const brandImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark img");
    const driftyRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--drifty");
    const openRouterImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--openrouter img");

    expect(toggleRule).toContain("grid-template-columns: 1.8rem minmax(0, 1fr) 0.78rem;");
    expect(toggleRule).toContain("min-height: 3.35rem;");
    expect(toggleRule).toContain("padding: 0.52rem var(--space-3);");
    expect(brandMarkRule).toContain("height: 1.8rem;");
    expect(brandMarkRule).toContain("width: 1.8rem;");
    expect(brandImageRule).toContain("height: 1.3rem;");
    expect(brandImageRule).toContain("width: 1.3rem;");
    expect(driftyRule).toContain("background: color-mix(in srgb, #7bea56 24%, var(--surface));");
    expect(openRouterImageRule).toContain("height: 1.16rem;");
    expect(openRouterImageRule).toContain("width: 1.16rem;");
  });

  it("presents AI setup internal tabs as compact pill controls", () => {
    const aiSetupStyles = readAiSetupStyles();
    const tabListRule = cssRule(aiSetupStyles, ".ai-setup-panel-tabs");
    const tabRule = cssRule(aiSetupStyles, ".ai-setup-panel-tab");
    const activeTabRule = cssRule(aiSetupStyles, ".ai-setup-panel-tab.is-active");
    const tabPanelRule = cssRule(aiSetupStyles, ".ai-setup-tab-panel");

    expect(tabListRule).toContain("background: color-mix(in srgb, var(--bg-2) 38%, transparent);");
    expect(tabListRule).toContain("gap: 0.16rem;");
    expect(tabListRule).toContain("padding: 0.16rem;");
    expect(tabListRule).toContain("width: fit-content;");
    expect(tabRule).toContain("border: 1px solid transparent;");
    expect(tabRule).toContain("border-radius: 9px;");
    expect(tabRule).toContain("font-size: 0.76rem;");
    expect(tabRule).toContain("min-height: 1.66rem;");
    expect(activeTabRule).toContain("background: color-mix(in srgb, var(--surface) 98%, var(--bg-2));");
    expect(activeTabRule).toContain("color: var(--text);");
    expect(tabPanelRule).toContain("gap: var(--space-4);");
  });

  it("places managed local model specs on the right with actions under the copy", () => {
    const aiSetupStyles = readAiSetupStyles();
    const modelRule = cssRule(aiSetupStyles, ".ai-managed-model");
    const copyRule = cssRule(aiSetupStyles, ".ai-managed-model__copy");
    const metaRule = cssRule(aiSetupStyles, ".ai-managed-model__meta");
    const actionsRule = cssRule(aiSetupStyles, ".ai-managed-model__actions");
    const primaryActionRule = cssRule(aiSetupStyles, ".ai-managed-model__primary-action");
    const deleteActionRule = cssRule(aiSetupStyles, ".ai-managed-model__actions .settings-btn.ai-managed-model__delete-action");

    expect(modelRule).toContain('"copy meta"');
    expect(modelRule).toContain('"actions meta"');
    expect(copyRule).toContain("display: flex;");
    expect(copyRule).toContain("align-items: baseline;");
    expect(copyRule).toContain("flex-wrap: wrap;");
    expect(metaRule).toContain("justify-items: end;");
    expect(actionsRule).toContain("display: flex;");
    expect(actionsRule).not.toContain("border-top:");
    expect(actionsRule).not.toContain("min-width: 8.8rem;");
    expect(primaryActionRule).toContain("gap: 0.42rem;");
    expect(deleteActionRule).toContain("background: color-mix(in srgb, var(--warn-soft) 86%, var(--surface));");
    expect(deleteActionRule).toContain("border-radius: 999px;");
    expect(deleteActionRule).toContain("min-width: 2rem;");
    expect(deleteActionRule).toContain("width: 2rem;");
  });

  it("tints the full AI connection test panel on errors", () => {
    const aiSetupStyles = readAiSetupStyles();
    const currentModelErrorRule = cssRule(aiSetupStyles, ".ai-setup-current-model.is-error");
    const currentModelErrorStatusRule = cssRule(aiSetupStyles, ".ai-setup-current-model.is-error .ai-setup-current-model__status");

    expect(currentModelErrorRule).toContain("background: color-mix(in srgb, var(--warn-soft) 72%, var(--surface));");
    expect(currentModelErrorRule).toContain("border-color: color-mix(in srgb, var(--warn) 24%, var(--line));");
    expect(currentModelErrorStatusRule).not.toContain("border-top");
    expect(currentModelErrorStatusRule).toContain("color: var(--warn);");
  });

  it("flattens the managed local section so model cards are not boxed twice", () => {
    const aiSetupStyles = readAiSetupStyles();
    const statusRule = cssRule(aiSetupStyles, ".ai-managed-status");
    const routeRule = cssRule(aiSetupStyles, ".ai-setup-route-option");

    expect(statusRule).toContain("background: transparent;");
    expect(statusRule).toContain("border: 0;");
    expect(routeRule).toContain("background: transparent;");
    expect(routeRule).toContain("border: 0;");
    expect(aiSetupStyles).not.toContain(".ai-setup-route-option.is-selected");
  });

  it("keeps the Cloud setup CTA compact and slightly brighter", () => {
    const aiSetupStyles = readAiSetupStyles();
    const cloudSource = readFileSync("src/features/settings/CloudSetupPanel.tsx", "utf8");
    const cloudRouteRule = cssRule(aiSetupStyles, ".ai-setup-cloud-route");
    const cloudRouteDarkRule = cssRule(aiSetupStyles, ':root[data-theme="dark"] .ai-setup-cloud-route');
    const cloudActionRule = cssRule(aiSetupStyles, ".ai-setup-cloud-route .settings-btn.ai-setup-cloud-route__action");

    expect(cloudSource).toContain("settings-btn settings-btn--primary ai-setup-cloud-route__action");
    expect(cloudRouteRule).toContain("--cloud-action: #344622;");
    expect(cloudRouteDarkRule).toContain("--cloud-action: #5a7042;");
    expect(cloudActionRule).toContain("font-size: 0.756rem;");
    expect(cloudActionRule).toContain("font-weight: 520;");
    expect(cloudActionRule).toContain("height: 2.25rem;");
    expect(cloudActionRule).toContain("min-height: 2.25rem;");
    expect(cloudActionRule).toContain("background: var(--cloud-action);");
    expect(cloudActionRule).toContain("border-color: var(--cloud-action);");
    expect(cloudActionRule).toContain("box-shadow: 0 8px 18px color-mix(in srgb, var(--cloud-action) 20%, transparent);");
  });

  it("separates AI providers from shared prompt settings", () => {
    const aiSetupStyles = readAiSetupStyles();
    const supportZoneRule = cssRule(aiSetupStyles, ".ai-setup-support-zone");
    const supportHeaderTitleRule = cssRule(aiSetupStyles, ".ai-setup-support-zone__header strong");
    const supportToggleRule = cssRule(aiSetupStyles, ".ai-setup-support-section__toggle");
    const supportTitleRule = cssRule(aiSetupStyles, ".ai-setup-support-section__copy strong");

    expect(supportZoneRule).toContain("border-top: 0;");
    expect(supportZoneRule).toContain("margin-top: 0;");
    expect(supportZoneRule).toContain("padding-top: 0;");
    expect(supportHeaderTitleRule).toContain("font-size: 0.94rem;");
    expect(supportHeaderTitleRule).toContain("font-weight: 650;");
    expect(supportToggleRule).toContain("min-height: 3.55rem;");
    expect(supportToggleRule).toContain("padding: 0.72rem var(--space-3);");
    expect(supportTitleRule).toContain("font-size: var(--type-setting-label-size);");
    expect(supportTitleRule).toContain("font-weight: 650;");
  });

  it("keeps the first heading aligned to the active settings section label", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const notificationsSource = readFileSync("src/features/settings/NotificationsSettingsSection.tsx", "utf8");
    const dataExportSource = readFileSync("src/features/settings/DataExportSettingsSection.tsx", "utf8");

    expect(appSource).toContain('settingsSection === "notifications"');
    expect(appSource).toContain("<NotificationsSettingsSection");
    expect(notificationsSource).toContain("<h3>Notifications</h3>");
    expect(appSource).toContain('settingsSection === "privacy"');
    expect(appSource).toContain("<PrivacySettingsSection />");
    expect(appSource).toContain('settingsSection === "data"');
    expect(appSource).toContain("<DataExportSettingsSection");
    expect(dataExportSource).toContain("<h3>Data &amp; Export</h3>");
  });

  it("shares one privacy review component between AI setup and Privacy settings", () => {
    const aiSetupSource = readFileSync("src/features/settings/AiSetupSupportSections.tsx", "utf8");
    const privacySource = readFileSync("src/features/settings/PrivacySettingsSection.tsx", "utf8");

    expect(aiSetupSource).toContain("<AiPrivacyReview />");
    expect(privacySource).toContain("<AiPrivacyReview />");
  });
});
