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
    const openRouterImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--openrouter img");
    const ollamaImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--ollama img");

    expect(toggleRule).toContain("grid-template-columns: 2.75rem minmax(0, 1fr) 1rem;");
    expect(toggleRule).toContain("min-height: 5.1rem;");
    expect(toggleRule).toContain("padding: 0.85rem var(--space-4);");
    expect(brandMarkRule).toContain("height: 2.75rem;");
    expect(brandMarkRule).toContain("width: 2.75rem;");
    expect(brandImageRule).toContain("height: 2.02rem;");
    expect(brandImageRule).toContain("width: 2.02rem;");
    expect(openRouterImageRule).toContain("height: 1.77rem;");
    expect(openRouterImageRule).toContain("width: 1.77rem;");
    expect(ollamaImageRule).toContain("height: 1.8rem;");
    expect(ollamaImageRule).toContain("width: 1.45rem;");
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

    expect(supportZoneRule).toContain("border-top: 1px solid color-mix(in srgb, var(--text) 10%, transparent);");
    expect(supportZoneRule).toContain("margin-top: clamp(1.35rem, 3vw, 2.25rem);");
    expect(supportZoneRule).toContain("padding-top: clamp(1.1rem, 2.4vw, 1.8rem);");
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
