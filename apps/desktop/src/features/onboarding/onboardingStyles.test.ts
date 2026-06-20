import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./onboarding.css", import.meta.url), "utf8");

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

  it("lets the nudges confirmation backdrop cover the viewport", () => {
    // Given: the nudges step can open a fixed-position confirmation window.
    const bodyRule = cssRule(".onboarding-card .onboarding-body--nudges");
    const viewportRule = cssRule(".onboarding-card .onboarding-body--nudges .onboarding-viewport");

    // Then: the fixed backdrop must not be constrained by the step body or viewport.
    expect(bodyRule).toContain("contain: none;");
    expect(bodyRule).toContain("overflow: visible;");
    expect(viewportRule).toContain("overflow: visible;");
  });
});
