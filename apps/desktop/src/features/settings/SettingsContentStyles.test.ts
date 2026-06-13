import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("Settings content styles", () => {
  it("does not stack an inner heading divider against each settings card border", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const headingRule = cssRule(styles, ".content--settings .settings-block h3");

    expect(headingRule).toContain("border-bottom: 0;");
    expect(headingRule).toContain("padding-bottom: 0;");
  });

  it("keeps settings segmented controls outline-free like AI setup tabs", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const switchRules = [
      cssRule(styles, ".content--settings .settings-mode-switch"),
      cssRule(styles, ".content--settings .settings-section--general .settings-mode-switch"),
      cssRule(styles, ".content--settings .settings-mode-switch--compact"),
    ];
    const activeRules = [
      cssRule(styles, ".content--settings .settings-mode-option.is-active"),
      cssRule(styles, ".content--settings .settings-section--general .settings-mode-option.is-active"),
      cssRule(styles, ".content--settings .settings-mode-switch--compact .settings-mode-option.is-active"),
    ];

    expect(switchRules.every((rule) => rule.includes("border: 1px solid transparent;"))).toBe(true);
    expect(switchRules.every((rule) => rule.includes("box-shadow: none;"))).toBe(true);
    expect(activeRules.every((rule) => rule.includes("border-color: transparent;"))).toBe(true);
    expect(activeRules.every((rule) => rule.includes("box-shadow: none;"))).toBe(true);
  });
});
