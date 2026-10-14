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
  it("uses the UI face for classification prose and reserves mono for typed data", () => {
    const styles = readAppStyles();
    const labelRule = cssRule(styles, ".classification-rule-field span,\n.classification-rule-field label,\n.classification-rule-hint,\n.classification-rule-copy");
    const inputRule = cssRule(styles, ".settings-section--classification .classification-rule-field .settings-input");

    expect(labelRule).toContain("font-family: var(--font-ui);");
    expect(inputRule).toContain("font-family: var(--font-mono);");
  });

  it("keeps the primary save button filled inside the add form", () => {
    const styles = readAppStyles();
    const primaryRule = cssRuleExact(styles, ".settings-section--classification .classification-rule-composer .settings-btn--primary");

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
