import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

function expectRuleToContain(rule: string, declarations: readonly string[]): void {
  for (const declaration of declarations) expect(rule).toContain(declaration);
}

function readAiSetupStyles(): string {
  return [
    "src/features/settings/AiSetupPanel.css",
    "src/features/settings/AiSetupProviderRows.css",
    "src/features/settings/AiSetupProviderDetails.css",
    "src/features/settings/AiSetupSupportSections.css",
    "src/features/settings/AiSetupWorkProfileSection.css",
    "src/features/settings/AiSetupPanelResponsive.css",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
}

describe("Settings content styles", () => {
  it("bounds the Pet Lab ancestor track so full diagnostic rows wrap without omitting values", () => {
    const styles = readAppStyles();
    const lab = cssRule(styles, ".pet-mode-lab");
    const diagnostics = cssRule(styles, ".pet-mode-lab__diagnostics");
    const row = cssRule(styles, ".pet-mode-lab__diagnostic");
    const label = cssRule(styles, ".pet-mode-lab__diagnostic span");
    const value = cssRule(styles, ".pet-mode-lab__diagnostic code");

    // Child wrapping alone cannot constrain an implicit auto grid column or
    // its grid item's automatic minimum. Keep that ancestor boundary explicit.
    expectRuleToContain(lab, ["grid-template-columns: minmax(0, 1fr);", "min-width: 0;"]);
    expectRuleToContain(diagnostics, ["min-width: 0;", "flex-wrap: wrap;"]);
    expectRuleToContain(row, ["flex-basis: 100%;", "min-width: 0;", "align-items: flex-start;"]);
    expect(label).toContain("flex-shrink: 0;");
    expectRuleToContain(value, ["flex: 1;", "min-width: 0;", "overflow-wrap: anywhere;", "white-space: normal;"]);
    for (const rule of [lab, diagnostics, row, value]) {
      expect(rule).not.toMatch(/overflow(?:-x)?:\s*(?:hidden|clip)|text-overflow:\s*ellipsis/);
    }
  });

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

  it("keeps select option fills balanced while reserving a second column only for in-flow actions", () => {
    const styles = readAppStyles();
    const optionRowRule = cssRule(styles, ".settings-select-control__option-row");
    const actionRowRule = cssRule(styles, ".settings-select-control__option-row.has-action");
    const selectedOptionRule = cssRule(styles, ".settings-select-control__option.is-selected");
    const hoverOptionRule = cssRule(styles, ".settings-select-control__option:hover:not(.is-selected),\n.settings-select-control__option.is-active:not(.is-selected)");
    const aiActionRowRule = cssRule(
      readAiSetupStyles(),
      ".ai-setup-select-control .settings-select-control__option-row.has-action",
    );

    expectRuleToContain(optionRowRule, [
      "gap: 0;",
      "grid-template-columns: minmax(0, 1fr);",
    ]);
    expectRuleToContain(actionRowRule, [
      "gap: var(--space-1);",
      "grid-template-columns: minmax(0, 1fr) auto;",
    ]);
    expect(selectedOptionRule).toContain("background: color-mix(in srgb, var(--surface-strong) 82%, var(--accent-soft));");
    expect(hoverOptionRule).toContain("background: color-mix(in srgb, var(--surface-strong) 90%, var(--accent-soft));");
    // Below-trigger selects keep their fill-only selection; the in-place picker
    // uses a check so hover and the committed value can be shown separately.
    expect(styles).not.toMatch(/(?:^|\n)\.settings-select-control__check\s*\{/);
    expect(cssRule(styles, '.settings-select-control[data-placement="selected"] .settings-select-control__check')).toContain("margin-left: auto;");
    expectRuleToContain(aiActionRowRule, [
      "gap: 0;",
      "grid-template-columns: minmax(0, 1fr);",
      "position: relative;",
    ]);
  });

  it("keeps exact URL classification rule controls compact and readable", () => {
    const styles = readAppStyles();
    const modeControlRule = cssRule(styles, ".classification-rule-mode-control");
    const selectedUrlRule = cssRule(styles, ".classification-rule-selected--url");
    const correctionDetailRule = cssRule(styles, ".classification-correction__match");

    expect(modeControlRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(modeControlRule).toContain("width: 100%;");
    expect(selectedUrlRule).toContain("overflow-wrap: anywhere;");
    expect(correctionDetailRule).toContain("overflow-wrap: anywhere;");
    expect(correctionDetailRule).toContain("white-space: normal;");
  });

  it("keeps AI setup provider rows compact", () => {
    const aiSetupStyles = readAiSetupStyles();
    const toggleRule = cssRule(aiSetupStyles, ".ai-setup-choice__toggle");
    const brandMarkRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark");
    const brandImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark img");
    const driftyRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--drifty");
    const openRouterImageRule = cssRule(aiSetupStyles, ".ai-setup-brand-mark--openrouter img");
    const titleRule = cssRule(aiSetupStyles, ".ai-setup-choice__title");

    expect(toggleRule).toContain("grid-template-columns: 1.8rem minmax(0, 1fr) 0.78rem;");
    expect(toggleRule).toContain("min-height: 3.35rem;");
    expect(toggleRule).toContain("padding: 0.52rem var(--space-3);");
    expect(titleRule).toContain("font-weight: 500;");
    expect(brandMarkRule).toContain("height: 1.8rem;");
    expect(brandMarkRule).toContain("width: 1.8rem;");
    expect(brandImageRule).toContain("height: 1.3rem;");
    expect(brandImageRule).toContain("width: 1.3rem;");
    expect(driftyRule).toContain("background: color-mix(in srgb, #7bea56 24%, var(--surface));");
    expect(openRouterImageRule).toContain("height: 1.16rem;");
    expect(openRouterImageRule).toContain("width: 1.16rem;");
  });

  it("positions discovered custom-endpoint models as an out-of-flow popover", () => {
    const aiSetupStyles = readAiSetupStyles();
    const controlRule = cssRule(aiSetupStyles, ".ai-setup-model-control.settings-select-control");
    const openControlRule = cssRule(aiSetupStyles, '.ai-setup-model-control.settings-select-control[data-open="true"]');
    const menuRule = cssRule(aiSetupStyles, ".ai-setup-model-control .settings-select-control__menu");

    expect(controlRule).toContain("overflow: hidden;");
    expect(openControlRule).toContain("overflow: visible;");
    expectRuleToContain(menuRule, [
      "max-height: min(12.5rem, 32vh);",
      "position: absolute;",
      "top: calc(100% + var(--space-1));",
      "z-index: var(--z-settings-popover);",
    ]);
  });

  it("collapses custom-endpoint fields without horizontal overflow at the narrow container breakpoint", () => {
    const aiSetupStyles = readAiSetupStyles();
    const responsiveBlockStart = aiSetupStyles.indexOf("@container ai-custom-endpoint (max-width: 35rem)");
    expect(responsiveBlockStart).toBeGreaterThanOrEqual(0);
    const responsiveBlock = aiSetupStyles.slice(responsiveBlockStart, responsiveBlockStart + 260);
    const fieldsRule = cssRule(aiSetupStyles, ".ai-setup-custom-fields");
    const actionRule = cssRule(aiSetupStyles, ".ai-setup-connection-actions");

    expect(fieldsRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(fieldsRule).toContain("min-width: 0;");
    expect(responsiveBlock).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(responsiveBlock).toContain("grid-column: auto;");
    expect(actionRule).toContain("flex-wrap: wrap;");
    expect(actionRule).toContain("min-width: 0;");
  });

  it("presents AI setup internal tabs as compact pill controls", () => {
    const aiSetupStyles = readAiSetupStyles();
    const tabListRule = cssRule(aiSetupStyles, ".ai-setup-panel-tabs");
    const tabRule = cssRule(aiSetupStyles, ".ai-setup-panel-tab");
    const activeTabRule = cssRule(aiSetupStyles, ".ai-setup-panel-tab.is-active");
    const tabPanelRule = cssRule(aiSetupStyles, ".ai-setup-tab-panel");
    const panelRule = cssRule(aiSetupStyles, ".ai-setup-panel");
    const panelDarkRule = cssRule(aiSetupStyles, ':root[data-theme="dark"] .ai-setup-panel');
    const modelSelectRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__trigger");
    const selectMenuRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__menu");
    const selectActionRowRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__option-row.has-action");
    const selectOptionRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__option");
    const selectSelectedOptionRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__option.is-selected");
    const selectActionOptionRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__option-row.has-action .settings-select-control__option");
    const selectActionRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__option-row.has-action .settings-select-control__option-action");
    const selectIconActionRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__option-row.has-action .settings-select-control__option-action--icon");
    const selectActionsContainerRule = cssRule(aiSetupStyles, ".ai-setup-select-control .settings-select-control__option-actions");

    expectRuleToContain(tabListRule, ["background: color-mix(in srgb, var(--bg-2) 38%, transparent);", "gap: 0.16rem;", "padding: 0.16rem;", "width: fit-content;"]);
    expectRuleToContain(tabRule, ["border: 1px solid transparent;", "border-radius: 9px;", "font-size: 0.76rem;", "min-height: 1.66rem;"]);
    expectRuleToContain(activeTabRule, ["background: color-mix(in srgb, var(--surface) 98%, var(--bg-2));", "color: var(--text);"]);
    expect(tabPanelRule).toContain("gap: var(--space-4);");
    expect(panelRule).toContain("--cloud-action: #344622;");
    expect(panelDarkRule).toContain("--cloud-action: #5a7042;");
    expect(modelSelectRule).toContain("font-weight: 500;");
    expect(selectMenuRule).toContain("max-height: 16rem;");
    // Redesigned dropdown: full-width block-level options with a flex icon column.
    expect(selectMenuRule).toContain("width: 100%;");
    expect(selectActionRowRule).toContain("position: relative;");
    expect(selectOptionRule).toContain("display: flex;");
    expect(selectOptionRule).toContain("align-items: center;");
    expect(selectOptionRule).toContain("font-family: var(--font-display);");
    expect(selectOptionRule).toContain("font-size: 0.9rem;");
    expect(selectOptionRule).toContain("gap: 0.55rem;");
    expect(selectOptionRule).toContain("min-height: 2.08rem;");
    expect(selectSelectedOptionRule).toContain("font-weight: 500;");
    expect(selectSelectedOptionRule).toContain("background: color-mix(in srgb, var(--text) 9%, transparent);");
    expect(aiSetupStyles).not.toContain(".settings-select-control__check");
    expect(selectActionOptionRule).toContain("padding-right: 6.7rem;");
    expectRuleToContain(selectActionRule, ["background: #5b6068;", "border-radius: var(--radius-sm);", "color: #fff;"]);
    expect(selectIconActionRule).toContain("border-radius: var(--radius-pill);");
    // The action buttons live in an absolutely-pinned flex container so a row can carry more than one.
    expectRuleToContain(selectActionsContainerRule, ["display: flex;", "position: absolute;"]);
  });

  it("places managed local model specs on the right with actions under the copy", () => {
    const aiSetupStyles = readAiSetupStyles();
    const modelRule = cssRule(aiSetupStyles, ".ai-managed-model");
    const copyRule = cssRule(aiSetupStyles, ".ai-managed-model__copy");
    const titleRule = cssRule(aiSetupStyles, ".ai-managed-model strong");
    const metaRule = cssRule(aiSetupStyles, ".ai-managed-model__meta");
    const actionsRule = cssRule(aiSetupStyles, ".ai-managed-model__actions");
    const primaryActionRule = cssRule(aiSetupStyles, ".ai-managed-model__primary-action");
    const downloadActionRule = cssRule(aiSetupStyles, ".ai-managed-model__primary-action.ai-managed-model__download-action:not(.is-retry)");
    const deleteActionRule = cssRule(aiSetupStyles, ".ai-managed-model__actions .settings-btn.ai-managed-model__delete-action");

    expect(modelRule).toContain('"copy meta"');
    expect(modelRule).toContain('"actions meta"');
    expect(copyRule).toContain("display: flex;");
    expect(copyRule).toContain("align-items: baseline;");
    expect(copyRule).toContain("flex-wrap: wrap;");
    expect(titleRule).toContain("font-weight: 520;");
    expect(metaRule).toContain("justify-items: end;");
    expect(actionsRule).toContain("display: flex;");
    expect(actionsRule).not.toContain("border-top:");
    expect(actionsRule).not.toContain("min-width: 8.8rem;");
    expect(primaryActionRule).toContain("gap: 0.42rem;");
    expect(downloadActionRule).toBe("");
    expect(deleteActionRule).toContain("background: color-mix(in srgb, var(--warn-soft) 86%, var(--surface));");
    expect(deleteActionRule).toContain("border-radius: var(--radius-pill);");
    expect(deleteActionRule).toContain("min-width: 2rem;");
    expect(deleteActionRule).toContain("width: 2rem;");
  });

  it("carries AI connection error tone on the inline message, not a card fill", () => {
    const aiSetupStyles = readAiSetupStyles();
    const currentModelStatusRule = cssRule(aiSetupStyles, ".ai-setup-current-model.is-error .ai-setup-current-model__status");

    // The redesigned selector drops the card chrome, so there is no red card
    // fill — error tone is carried by the inline test-connection message.
    expect(cssRule(aiSetupStyles, ".ai-setup-current-model.is-error")).toBe("");
    expect(currentModelStatusRule).not.toContain("border-top");
    expect(currentModelStatusRule).toContain("color: var(--warn);");
  });

  it("keeps the managed local runtime status as a compact message strip", () => {
    const aiSetupStyles = readAiSetupStyles();
    const statusRule = cssRule(aiSetupStyles, ".ai-managed-status");
    const routeRule = cssRule(aiSetupStyles, ".ai-setup-route-option");

    expect(statusRule).toContain("background: color-mix(in srgb, var(--surface-strong) 42%, transparent);");
    expect(statusRule).toContain("border: 1px solid color-mix(in srgb, var(--line) 76%, transparent);");
    expect(statusRule).toContain("padding: var(--space-2) var(--space-3);");
    expect(routeRule).toContain("background: transparent;");
    expect(routeRule).toContain("border: 0;");
    expect(aiSetupStyles).not.toContain(".ai-setup-route-option.is-selected");
  });

  it("keeps the Cloud setup CTA compact and visually quiet", () => {
    const aiSetupStyles = readAiSetupStyles();
    const cloudRouteRule = cssRule(aiSetupStyles, ".ai-setup-cloud-route");
    const cloudRouteDarkRule = cssRule(aiSetupStyles, ':root[data-theme="dark"] .ai-setup-cloud-route');
    const cloudRouteTitleRule = cssRule(aiSetupStyles, ".ai-setup-cloud-route strong");
    const cloudActionRule = cssRule(aiSetupStyles, ".ai-setup-cloud-route .settings-btn.ai-setup-cloud-route__action");

    expect(cloudRouteRule).toContain("--cloud-action: #344622;");
    expect(cloudRouteDarkRule).toContain("--cloud-action: #5a7042;");
    expect(cloudRouteTitleRule).toContain("font-weight: 520;");
    expect(cloudActionRule).toContain("font-size: 0.756rem;");
    expect(cloudActionRule).toContain("font-weight: 620;");
    expect(cloudActionRule).toContain("height: 2.25rem;");
    expect(cloudActionRule).toContain("min-height: 2.25rem;");
    expect(cloudActionRule).toContain("border-radius: var(--radius-pill);");
    expect(cloudActionRule).toContain("background: color-mix(in srgb, var(--accent-soft) 82%, var(--surface));");
    expect(cloudActionRule).toContain("border-color: color-mix(in srgb, var(--accent) 24%, var(--line));");
    expect(cloudActionRule).toContain("box-shadow: none;");
  });

  it("keeps Memory in the same column and card language as the sibling AI tabs", () => {
    const memoryStyles = readFileSync("src/features/settings/AiSetupSupportSections.css", "utf8");
    const aiSetupStyles = readAiSetupStyles();
    const supportZoneRule = cssRule(aiSetupStyles, ".ai-setup-support-zone");
    const cardRule = cssRule(aiSetupStyles, ".memory-card");
    const rowRule = cssRule(aiSetupStyles, ".memory-row");
    const feedbackRule = cssRule(aiSetupStyles, ".memory-feedback");

    expect(supportZoneRule).toContain("border-top: 0;");
    expect(supportZoneRule).toContain("margin-top: 0;");
    expect(supportZoneRule).toContain("padding-top: 0;");

    // Memory uses the shared Settings column. Widening only this tab moved the
    // page title and tab bar when switching between AI tabs.
    expect(memoryStyles).not.toMatch(/\.page:has\(\.ai-memory\)/);
    expect(memoryStyles).not.toMatch(/\.ai-memory\s*\{[^}]*max-width:\s*[\d.]+(rem|px)/);

    // Cards reuse the provider-row surface: one border, the standard card radius.
    expect(cardRule).toContain("border: 1px solid var(--line);");
    // Settings cards are 14px; the provider rows hard-code the same value.
    expect(cardRule).toContain("border-radius: 14px;");
    expect(cssRule(aiSetupStyles, ".ai-setup-choice")).toContain("border-radius: 14px;");
    expect(cardRule).toContain("--settings-row-card-bg");
    expect(rowRule).toContain("grid-template-columns: minmax(0, 1fr) auto;");

    // Feedback is a joined icon control on the Settings control tokens.
    expect(feedbackRule).toContain("border: 1px solid var(--settings-control-border);");
    expect(feedbackRule).toContain("border-radius: var(--radius-sm);");

    // Radii and font sizes come from the shared scales.
    // The only literal radius is the 14px settings card family (cards and the banner above them).
    expect(new Set(memoryStyles.match(/border-radius:\s*\d+px;/g))).toEqual(new Set(["border-radius: 14px;"]));
    expect(/font-size:\s*[\d.]+(rem|px);/.test(memoryStyles)).toBe(false);

    // The redesign must not reintroduce the marketing hero, card grid, or numbered loop.
    expect(aiSetupStyles).not.toContain(".ai-memory-hero");
    expect(aiSetupStyles).not.toContain(".ai-memory-cards");
    expect(aiSetupStyles).not.toContain(".ai-memory-loop");
  });

  it("keeps the first heading aligned to the active settings section label", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const notificationsSource = readFileSync("src/features/settings/NotificationsSettingsSection.tsx", "utf8");
    const privacySource = readFileSync("src/features/settings/PrivacySettingsSection.tsx", "utf8");

    expect(appSource).toContain('settingsSection === "notifications"');
    expect(appSource).toContain("<NotificationsSettingsSection");
    expect(notificationsSource).toContain('<h3>{t("settings.section.notifications")}</h3>');
    expect(appSource).toContain('settingsSection === "privacy"');
    expect(appSource).toContain("<PrivacySettingsSection");
    expect(appSource).not.toContain('settingsSection === "data"');
    expect(privacySource).toContain('<h3>{t("settings.section.privacy")}</h3>');
    expect(privacySource).toContain('<h3>{t("settings.privacy.localData")}</h3>');
  });

  it("keeps the privacy review rows in Privacy settings only", () => {
    const aiSetupSource = readFileSync("src/features/settings/AiSetupSupportSections.tsx", "utf8");
    const privacySource = readFileSync("src/features/settings/PrivacySettingsSection.tsx", "utf8");

    expect(aiSetupSource).not.toContain("<AiDataSendingRows");
    expect(privacySource).toContain("<AiDataSendingRows");
  });

  it("builds Privacy from the same flat blocks as General, with the AI group as its one folded card", () => {
    const privacySource = readFileSync("src/features/settings/PrivacySettingsSection.tsx", "utf8");
    const privacyRowSources = [
      "AiPrivacyReview.tsx",
      "AppExclusionSettingsRows.tsx",
      "DriftySharingRows.tsx",
    ].map((file) => readFileSync("src/features/settings/" + file, "utf8"));

    // The page title, Drifty sharing and data on this device are settings-blocks with a title and
    // direct-child rows. The AI group is the only card and it is folded.
    expect(privacySource.match(/<div className="settings-block"/g)).toHaveLength(3);
    expect(privacySource.match(/<h3>/g)).toHaveLength(3);
    expect(privacySource.match(/<SettingsCollapsibleCard/g)).toHaveLength(1);
    expect(privacySource).toContain("<AiDataSendingRows");
    // The folded header carries its title and subtitle only. A state badge there would have to
    // be kept in step with the switches and would leave the card looking unlike the other groups.
    const card = privacySource.slice(privacySource.indexOf("<SettingsCollapsibleCard"), privacySource.indexOf("</SettingsCollapsibleCard>"));
    expect(card).not.toContain("summary=");
    expect(card).toContain('searchReveal="privacy-ai"');
    for (const source of [privacySource, ...privacyRowSources]) {
      expect(source).not.toContain("SettingsCard");
      expect(source).not.toContain("drifty-checkbox");
    }
    for (const source of privacyRowSources) expect(source).not.toContain("SettingsCollapsibleCard");
    // One switch everywhere: the shared Toggle, not a privacy-only checkbox.
    expect(privacyRowSources[0]).toContain("<Toggle");
    expect(privacyRowSources[2]).toContain("<Toggle");
  });

  it("keeps dark selected work-profile chips and the description field readable", () => {
    const aiSetupStyles = readAiSetupStyles();
    const selectedRule = cssRule(aiSetupStyles, ".ai-setup-work-choice--selected");
    const darkSelectedRule = cssRule(aiSetupStyles, ':root[data-theme="dark"] .ai-setup-work-choice--selected');
    const textareaRule = cssRule(aiSetupStyles, ".content--settings .ai-setup-work-description textarea");
    const darkTextareaRule = cssRule(
      aiSetupStyles,
      ':root[data-theme="dark"] .content--settings .ai-setup-work-description textarea',
    );

    expect(selectedRule).toContain("background: #4f4e48;");
    expect(selectedRule).toContain("color: #f6f5f1;");
    expect(darkSelectedRule).toContain("background: #eceae3;");
    expect(darkSelectedRule).toContain("color: #151513;");
    expect(textareaRule).toContain("color: var(--text);");
    expect(darkTextareaRule).toContain("color: var(--text);");
  });
});
