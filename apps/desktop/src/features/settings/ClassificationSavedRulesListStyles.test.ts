import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("Classification saved rules list styles", () => {
  it("keeps saved classification rules inside an inset scrollable list shell", () => {
    const styles = readAppStyles();
    const source = readFileSync("src/features/settings/ClassificationSavedRulesList.tsx", "utf8");
    const sectionRule = cssRule(styles, ".content--settings .classification-rule-list-section.settings-row");
    const shellRule = cssRule(styles, ".classification-rule-list-shell");
    const listRule = cssRule(styles, ".classification-rule-list");
    const cardRule = cssRule(styles, ".classification-rule-card");
    const textRule = cssRule(styles, ".classification-rule-card__text");
    const detailRule = cssRule(styles, ".classification-rule-card__detail");
    const deleteActionRule = cssRule(styles, ".content--settings .classification-rule-card__delete.settings-btn");

    expect(source).toContain("settings-row settings-row--group-start settings-row--group-end classification-rule-list-section");
    expect(source).toContain("classification-rule-list-shell");
    expect(source).not.toContain("classification-rule-list-panel");
    expect(sectionRule).toContain("display: grid;");
    expect(sectionRule).toContain("gap: var(--space-3);");
    expect(shellRule).toContain("border: 1px solid var(--line);");
    expect(shellRule).toContain("background: color-mix(in srgb, var(--surface-strong) 38%, transparent);");
    expect(shellRule).toContain("overflow: hidden;");
    expect(listRule).toContain("gap: 0;");
    expect(listRule).toContain("max-height: min(14.75rem, 42vh);");
    expect(listRule).toContain("overflow-y: auto;");
    expect(cardRule).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(cardRule).toContain("min-height: 3.45rem;");
    expect(textRule).toContain("min-width: 0;");
    expect(detailRule).toContain("text-overflow: ellipsis;");
    expect(detailRule).toContain("white-space: nowrap;");
    expect(deleteActionRule).toContain("background: color-mix(in srgb, var(--warn-soft) 86%, var(--surface));");
    expect(deleteActionRule).toContain("color: var(--warn);");
    expect(deleteActionRule).toContain("min-width: 6.25rem;");
  });
});
