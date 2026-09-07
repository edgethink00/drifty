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
  it("aligns desktop settings with shared page gutters and limits form width", () => {
    const styles = readAppStyles();
    const pageRule = cssRules(styles, ".content--settings .page")
      .find((rule) => rule.includes("max-width: none;")) ?? "";

    expectRuleToContain(pageRule, [
      "max-width: none;",
      "margin: 0;",
      "padding: var(--page-content-block-start) var(--page-content-inline) 40px;",
    ]);
    expect(cssRules(styles, ".content--settings .settings-panel-stack").some((rule) => rule.includes("max-width: 1000px;"))).toBe(true);
  });
});
