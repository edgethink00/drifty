import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("Empty state style contracts", () => {
  it("keeps the shared empty state quiet and removes the legacy override", () => {
    const sharedStyles = readFileSync("src/styles/shared-surfaces.css", "utf8");
    const compatibilityStyles = readFileSync("src/styles/prototype-compat.css", "utf8");
    const emptyStateRule = cssRule(sharedStyles, ".empty-state");

    expect(emptyStateRule).toContain("background: transparent;");
    expect(emptyStateRule).toContain("border: 0;");
    expect(emptyStateRule).toContain("box-shadow: none;");
    expect(compatibilityStyles).not.toMatch(/(^|\n)\.empty-state\s*\{/);
  });

  it("uses quiet solid hairlines for Team empty, onboarding, and access states", () => {
    const teamStyles = readFileSync("src/features/team/team.css", "utf8");

    for (const selector of [
      ".content--team .team-empty",
      ".content--team .team-onboard",
      ".content--team .team-state",
    ]) {
      const rule = cssRule(teamStyles, selector);
      expect(rule).toContain("border: 1px solid var(--line);");
      expect(rule).not.toContain("dashed");
    }
  });
});
