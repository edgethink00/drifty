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
    expect(focusBlock).toContain(".dc-onb-input");
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
    expect(forcedColorsBlock).toContain("border: 1px solid ButtonText");
    expect(forcedColorsBlock).toContain("background: ButtonFace");
    expect(forcedColorsBlock).toContain("color: ButtonText");
  });

  it("animates progress with composited transforms instead of layout width", () => {
    const dotBlock = styles.match(/\.dc-onb-card \.dc-onb-dot::before \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(dotBlock).toContain("transform: scaleX(1)");
    expect(dotBlock).toContain("transition: transform");
    expect(dotBlock).not.toContain("transition: width");
  });
});
