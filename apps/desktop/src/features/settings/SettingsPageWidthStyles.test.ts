import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

function cssRules(styles: string, selector: string): readonly string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`, "g"))].map((match) => match[0]);
}

function expectRuleToContain(rule: string, declarations: readonly string[]): void {
  for (const declaration of declarations) expect(rule).toContain(declaration);
}

describe("Settings page width styles", () => {
  it("preserves the Settings-specific inset instead of shared page gutters", () => {
    const styles = readAppStyles();
    const pageRule = cssRules(styles, ".content--settings .page")
      .find((rule) => rule.includes("max-width: 1120px;")) ?? "";

    expectRuleToContain(pageRule, [
      "max-width: 1120px;",
      "margin: 0 auto;",
      "padding: 24px clamp(var(--space-6), 5.35vw, 6.5rem) 40px;",
    ]);

  });
});
