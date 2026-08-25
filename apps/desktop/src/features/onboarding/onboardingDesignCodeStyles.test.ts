import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("./styles/onboarding-designcode-reference.css", import.meta.url),
  "utf8",
);

describe("onboarding design-code accessibility styles", () => {
  it("keeps an explicit keyboard focus ring on every custom interactive control", () => {
    const focusBlock = styles.match(/\/\* Keep keyboard focus deterministic[\s\S]*?\n\}/)?.[0] ?? "";

    expect(focusBlock).toContain(".dc-onb-primary");
    expect(focusBlock).toContain(".dc-onb-input:not(.dc-onb-textarea)");
    expect(focusBlock).toContain(".dc-onb-setup-card");
    expect(focusBlock).toContain(".dc-onb-toggle");
    expect(focusBlock).toContain(".dc-onb-confirm__primary");
    expect(focusBlock).toContain(":focus-visible");
    expect(focusBlock).toContain("outline: 2px solid var(--dc-onb-accent)");
    expect(focusBlock).toContain("outline-offset: 2px");
  });

  it("uses the operating-system highlight color in forced-colors mode", () => {
    const forcedColorsBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));

    expect(forcedColorsBlock).toContain("outline-color: Highlight");
    expect(forcedColorsBlock).toContain(".dc-onb-textarea:focus-visible");
    expect(forcedColorsBlock).toContain("border: 1px solid ButtonText");
    expect(forcedColorsBlock).toContain("background: ButtonFace");
    expect(forcedColorsBlock).toContain("color: ButtonText");
  });

  it("keeps progress dots circular while animating with composited transforms", () => {
    const dotBlock = styles.match(/\.dc-onb-card \.dc-onb-dot::before \{[\s\S]*?\n\}/)?.[0] ?? "";
    const activeDotBlock = styles.match(/\.dc-onb-card \.dc-onb-dot--active::before \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(dotBlock).toContain("transform: scale(0.8333)");
    expect(dotBlock).toContain("transition: transform");
    expect(dotBlock).toContain("var(--dc-onb-text) 18%");
    expect(dotBlock).not.toContain("transition: width");
    expect(activeDotBlock).toContain("transform: scale(1.1667)");
    expect(activeDotBlock).not.toContain("scaleX");
  });

  it("keeps the work description field visually quiet while typing", () => {
    const textareaFocusBlock = styles.match(/\.dc-onb-textarea:focus \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(textareaFocusBlock).toContain("box-shadow: none");
    expect(textareaFocusBlock).toContain("caret-color: var(--dc-onb-accent)");
    expect(textareaFocusBlock).not.toContain("outline:");
  });

  it("keeps the nudge spacing balance explicit", () => {
    const nudgeCopyBlock = styles.match(/\.dc-onb-content--nudges \.dc-onb-copy \{[\s\S]*?\n\}/)?.[0] ?? "";
    const interventionBlock = styles.match(/\.dc-onb-intervene \{[\s\S]*?\n\}/)?.[0] ?? "";
    const interventionLabelBlock = styles.match(/\.dc-onb-intervene__label \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(nudgeCopyBlock).toContain("margin-bottom: 9px");
    expect(interventionBlock).toContain("gap: 6px");
    expect(interventionLabelBlock).toContain("margin: 0 0 3px");
  });
});

describe("onboarding desktop cat preview", () => {
  it("keeps a clipped stage large enough for the happy heart", () => {
    expect(styles).toContain(".dc-onb-cat-preview {");
    expect(styles).toContain("overflow: hidden;");
    expect(styles).toContain("width: 92px;");
    expect(styles).toContain("height: 80px;");
    expect(styles).not.toContain("@keyframes dcOnbCatArrive");
    expect(styles).toContain(".dc-onb-cat-preview:focus-visible");
    expect(styles).toContain(".dc-onb-cat-preview:hover");
    expect(styles).toContain("transform: none");
  });
});
