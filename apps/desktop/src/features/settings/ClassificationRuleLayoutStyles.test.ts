import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("Classification rule layout styles", () => {
  it("places the Domain rule type control above the input row without wrapping labels", () => {
    const styles = readAppStyles();
    const domainGridRule = cssRule(styles, ".classification-rule-form__grid:not(.classification-rule-form__grid--app)");
    const modeFieldRule = cssRule(styles, ".classification-rule-form__grid:not(.classification-rule-form__grid--app) > .classification-rule-mode-field");
    const modeOptionLabelRule = cssRule(styles, ".classification-rule-mode-control .settings-mode-option span");

    expect(domainGridRule).toContain('"mode mode mode mode"');
    expect(domainGridRule).toContain('"target category productivity action"');
    expect(modeFieldRule).toContain("grid-area: mode;");
    expect(modeFieldRule).toContain("width: min(100%, 15.5rem);");
    expect(modeOptionLabelRule).toContain("white-space: nowrap;");
  });

  it("keeps Domain rule fields responsive after the feature override import", () => {
    const styles = readAppStyles();

    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain('"target target"');
    expect(styles).toContain("grid-template-columns: 1fr;");
    expect(styles).toContain('"productivity"');
  });
});
