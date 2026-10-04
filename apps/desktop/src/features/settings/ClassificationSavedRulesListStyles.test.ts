import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("Classification saved rules list styles", () => {
  it("keeps saved classifications in one compact, page-scrolling list", () => {
    const styles = readAppStyles();
    const source = readFileSync("src/features/settings/ClassificationSavedRulesList.tsx", "utf8");
    const shellRule = cssRule(styles, ".classification-rule-list-shell");
    const listRule = cssRule(styles, ".classification-rule-list");
    const cardRule = cssRule(styles, ".classification-rule-card");
    const pathRule = cssRule(styles, ".classification-rule-card__detail--path");
    const metaRule = cssRule(styles, ".classification-rule-card__meta");

    expect(source).toContain("settings-row settings-row--group-start settings-row--group-end classification-rule-list-section");
    expect(source).toContain("classification-rule-list-shell");
    // A second scroll region hid saved choices; no rule may cap the list height.
    expect(listRule).toContain("display: grid;");
    expect(styles).not.toMatch(/\.classification-rule-list\s*\{[^}]*(max-height|overflow)/);
    // Each row's options menu extends past the last row, so the shell must not clip it.
    expect(shellRule).toContain("border: 1px solid var(--line);");
    expect(shellRule).not.toContain("overflow");
    expect(cardRule).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(cardRule).not.toContain("min-height");
    // Only the matched URL path uses the mono face; labels stay in the UI face.
    expect(pathRule).toContain("font-family: var(--font-mono);");
    expect(metaRule).toContain("font-family: var(--font-ui);");
  });
});
