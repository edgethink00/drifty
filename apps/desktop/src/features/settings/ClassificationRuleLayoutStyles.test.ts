import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

// Anchored at a line start so a longer, more specific selector that merely ends
// with the same text cannot be picked up instead of the rule under test.
function cssRuleExact(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`^${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`, "m"))?.[0] ?? "";
}

describe("Classification rule layout styles", () => {
  it("keeps the Domain rule row on a single band with the Rule type toggle inline", () => {
    const styles = readAppStyles();
    const domainGridRule = cssRule(styles, ".classification-rule-form__grid:not(.classification-rule-form__grid--app)");
    const labelRowRule = cssRule(styles, ".classification-rule-field__labelrow");
    const modeOptionLabelRule = cssRuleExact(styles, ".classification-rule-mode-control .settings-mode-option span");

    expect(domainGridRule).toContain('"target category productivity action"');
    // The dedicated full-width "mode" band is gone; the toggle rides in the label row.
    expect(domainGridRule).not.toContain('"mode mode mode mode"');
    expect(labelRowRule).toContain("justify-content: space-between;");
    expect(modeOptionLabelRule).toContain("white-space: nowrap;");
  });

  it("keeps Domain rule fields responsive after the feature override import", () => {
    const styles = readAppStyles();

    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain('"target target"');
    expect(styles).toContain("grid-template-columns: 1fr;");
    expect(styles).toContain('"productivity"');
  });

  it("uses the UI face for classification prose and reserves mono for typed data", () => {
    const styles = readAppStyles();
    const labelRule = cssRule(styles, ".classification-rule-field span,\n.classification-rule-field label,\n.classification-rule-hint,\n.classification-rule-copy,\n.classification-rule-selected,\n.classification-rule-candidates__heading");
    const inputRule = cssRule(styles, ".settings-section--classification .classification-rule-field .settings-input");

    expect(labelRule).toContain("font-family: var(--font-ui);");
    expect(inputRule).toContain("font-family: var(--font-mono);");
  });

  it("keeps the primary save button filled inside the classification card", () => {
    const styles = readAppStyles();
    const primaryRule = cssRule(styles, ".settings-section--classification .classification-rule-form__grid .settings-btn--primary");

    expect(primaryRule).toContain("background: var(--text);");
    expect(primaryRule).toContain("color: var(--canvas);");
  });

  it("differentiates the Productivity mark from the Category swatch", () => {
    const styles = readAppStyles();
    const productivityDot = cssRule(styles, ".classification-rule-picker-field--productivity .settings-select-control__dot");

    expect(productivityDot).toContain("border-radius: var(--radius-sm);");
    expect(productivityDot).toContain("height: 0.82rem;");
  });
});
