import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readCssWithImports(url: URL, seen = new Set<string>()): string {
  const key = url.href;
  if (seen.has(key)) return "";
  seen.add(key);

  const css = readFileSync(url, "utf8");

  return css.replace(/^@import\s+"(?<path>[^"]+)";$/gmu, (_match, path: string) =>
    readCssWithImports(new URL(path, url), seen),
  );
}

const styles = readCssWithImports(new URL("./onboarding.css", import.meta.url));

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));

  return match?.groups?.body ?? "";
}

describe("onboarding setup choice styles", () => {
  it("keeps choice card hover and focus paint visible at the viewport edge", () => {
    // Given: the first setup choice card starts flush with the onboarding viewport.
    const viewportRule = cssRule(".onboarding-card .onboarding-body--choose_setup .onboarding-viewport");

    // When: the card paints hover/focus affordances outside its own border box.
    // Then: the viewport must not clip that paint vertically.
    expect(viewportRule).toContain("overflow: visible;");
    expect(viewportRule).not.toContain("overflow-y: hidden;");
  });
});

describe("onboarding design-code reference styles", () => {
  it("does not add an inner framed window to individual design-code steps", () => {
    expect(styles).not.toContain("dc-onb-card--framed-step");
  });

  it("keeps the design-code continue button static on hover", () => {
    const primaryButtonRule = styles.match(
      /\.onboarding-card\.dc-onb-card \.dc-onb-actions \.dc-onb-primary,\s*\.onboarding-card\.dc-onb-card \.dc-onb-actions \.dc-onb-primary:hover:not\(:disabled, \[aria-disabled="true"\]\),\s*\.onboarding-card\.dc-onb-card \.dc-onb-actions \.dc-onb-primary:active:not\(:disabled, \[aria-disabled="true"\]\)\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body ?? "";

    expect(primaryButtonRule).toContain("height: 41px;");
    expect(primaryButtonRule).toContain("background: var(--dc-onb-accent);");
    expect(primaryButtonRule).toContain("transform: none;");
    expect(primaryButtonRule).toContain("transition: opacity 0.15s;");
  });

  it("keeps local model cards in the reference row layout at the 720px card width", () => {
    const mediumQueryStart = styles.indexOf("@media (max-width: 760px)");
    const compactQueryStart = styles.indexOf("@media (max-width: 560px)");
    const mediumQuery = styles.slice(mediumQueryStart, compactQueryStart);
    const compactQuery = styles.slice(compactQueryStart);

    expect(mediumQuery).not.toContain(".dc-onb-local-card");
    expect(compactQuery).toContain(".dc-onb-local-card");
    expect(compactQuery).toContain("flex-direction: column;");
  });
});

describe("onboarding job-step contrast", () => {
  it("keeps dark selected work chips on a light fill with dark text", () => {
    const selectedRule = cssRule(".dc-onb-choice--selected");
    const darkSelectedRule = cssRule(':root[data-theme="dark"] .dc-onb-choice--selected');
    const textareaRule = cssRule(".dc-onb-textarea");

    expect(selectedRule).toContain("background: #4f4e48;");
    expect(selectedRule).toContain("color: #f6f5f1;");
    expect(darkSelectedRule).toContain("background: #eceae3;");
    expect(darkSelectedRule).toContain("color: #151513;");
    expect(textareaRule).toContain("background: var(--dc-onb-raised);");
    expect(textareaRule).toContain("color: var(--dc-onb-text);");
  });
});
