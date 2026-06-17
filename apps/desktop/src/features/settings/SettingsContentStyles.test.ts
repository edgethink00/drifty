import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    const styles = readFileSync("src/styles.css", "utf8");
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
    const styles = readFileSync("src/styles.css", "utf8");
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

  it("emphasizes only the top general settings heading", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const generalHeadingRule = cssRule(
      styles,
      ".content--settings .settings-section--general .settings-block:first-child > h3",
    );

    expect(generalHeadingRule).toContain("font-size: 1.18rem;");
    expect(generalHeadingRule).toContain("font-weight: 700;");
  });

  it("keeps settings segmented controls outline-free like AI setup tabs", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const switchRules = [
      cssRule(styles, ".content--settings .settings-mode-switch"),
      cssRule(styles, ".content--settings .settings-section--general .settings-mode-switch"),
      cssRule(styles, ".content--settings .settings-mode-switch--compact"),
    ];
    const activeRules = [
      cssRule(styles, ".content--settings .settings-mode-option.is-active"),
      cssRule(styles, ".content--settings .settings-section--general .settings-mode-option.is-active"),
      cssRule(styles, ".content--settings .settings-mode-switch--compact .settings-mode-option.is-active"),
    ];

    expect(switchRules.every((rule) => rule.includes("border: 1px solid transparent;"))).toBe(true);
    expect(switchRules.every((rule) => rule.includes("box-shadow: none;"))).toBe(true);
    expect(activeRules.every((rule) => rule.includes("border-color: transparent;"))).toBe(true);
    expect(activeRules.every((rule) => rule.includes("box-shadow: none;"))).toBe(true);
  });

  it("keeps AI setup provider rows compact", () => {
    const aiSetupStyles = readAiSetupStyles();
    const toggleRule = cssRule(aiSetupStyles, ".ai-setup-choice__toggle");
    const brandMarkRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark");
    const brandImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark img");
    const driftyRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--drifty");
    const openRouterImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--openrouter img");

    expect(toggleRule).toContain("grid-template-columns: 2rem minmax(0, 1fr) 0.78rem;");
    expect(toggleRule).toContain("min-height: 3.7rem;");
    expect(toggleRule).toContain("padding: 0.58rem var(--space-3);");
    expect(brandMarkRule).toContain("height: 2rem;");
    expect(brandMarkRule).toContain("width: 2rem;");
    expect(brandImageRule).toContain("height: 1.45rem;");
    expect(brandImageRule).toContain("width: 1.45rem;");
    expect(driftyRule).toContain("background: color-mix(in srgb, #7bea56 24%, var(--surface));");
    expect(openRouterImageRule).toContain("height: 1.28rem;");
    expect(openRouterImageRule).toContain("width: 1.28rem;");
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
    expect(tabRule).toContain("font-size: 0.84rem;");
    expect(tabRule).toContain("min-height: 2.08rem;");
    expect(activeTabRule).toContain("background: color-mix(in srgb, var(--surface) 98%, var(--bg-2));");
    expect(activeTabRule).toContain("color: var(--text);");
    expect(tabPanelRule).toContain("gap: var(--space-4);");
  });

  it("keeps managed local model actions concise", () => {
    const aiSetupStyles = readAiSetupStyles();
    const modelRule = cssRule(aiSetupStyles, ".ai-managed-model");
    const actionsRule = cssRule(aiSetupStyles, ".ai-managed-model__actions");
    const primaryActionRule = cssRule(aiSetupStyles, ".ai-managed-model__primary-action");
    const deleteActionRule = cssRule(aiSetupStyles, ".ai-managed-model__delete-action");
    const mobilePrimaryActionRule = cssRule(aiSetupStyles, ".ai-managed-model__primary-action");

    expect(modelRule).toContain("grid-template-columns: auto minmax(13rem, 1fr) minmax(12rem, 0.68fr) minmax(8.8rem, auto);");
    expect(actionsRule).toContain("display: flex;");
    expect(actionsRule).toContain("justify-content: flex-end;");
    expect(actionsRule).toContain("min-width: 8.8rem;");
    expect(primaryActionRule).toContain("gap: 0.42rem;");
    expect(deleteActionRule).toContain("width: 2rem;");
    expect(mobilePrimaryActionRule).toContain("gap: 0.42rem;");
  });

  it("uses the focus color for the Cloud setup CTA", () => {
    const aiSetupStyles = readAiSetupStyles();
    const cloudPrimaryRule = cssRule(aiSetupStyles, ".ai-setup-cloud-route .settings-btn--primary");

    expect(cloudPrimaryRule).toContain("background: var(--productivity-focus);");
    expect(cloudPrimaryRule).toContain("border-color: var(--productivity-focus);");
    expect(cloudPrimaryRule).toContain("box-shadow: 0 8px 18px color-mix(in srgb, var(--productivity-focus) 24%, transparent);");
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

    expect(appSource).toContain('settingsSection === "notifications"');
    expect(appSource).toContain("<h3>Notifications</h3>");
    expect(appSource).toContain('settingsSection === "privacy"');
    expect(appSource).toContain("<PrivacySettingsSection />");
    expect(appSource).toContain('settingsSection === "data"');
    expect(appSource).toContain("<h3>Data & Export</h3>");
  });

  it("shares one privacy review component between AI setup and Privacy settings", () => {
    const aiSetupSource = readFileSync("src/features/settings/AiSetupSupportSections.tsx", "utf8");
    const privacySource = readFileSync("src/features/settings/PrivacySettingsSection.tsx", "utf8");

    expect(aiSetupSource).toContain("<AiPrivacyReview />");
    expect(privacySource).toContain("<AiPrivacyReview />");
  });
});
