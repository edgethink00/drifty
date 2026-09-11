import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";
import {
  applyAppThemeColorOverrides,
  contrastingInk,
  derivedThemeColorCustomProperties,
} from "./settingsStorage";

describe("theme color token roles", () => {
  it("derives the accent family from a custom accent and restores defaults when cleared", () => {
    const target = {
      values: new Map<string, string>(),
      setProperty(property: string, value: string) {
        this.values.set(property, value);
      },
      removeProperty(property: string) {
        this.values.delete(property);
      },
      getPropertyValue(property: string) {
        return this.values.get(property) ?? "";
      },
    };

    applyAppThemeColorOverrides(target as unknown as CSSStyleDeclaration, { accent: "#3b6cb5" });
    expect(target.getPropertyValue("--accent")).toBe("#3b6cb5");
    expect(target.getPropertyValue("--accent-soft")).toBe("color-mix(in srgb, #3b6cb5 18%, var(--surface))");
    expect(target.getPropertyValue("--on-accent")).toBe("#ffffff");
    expect(derivedThemeColorCustomProperties("productivityFocus", "#476f8f")[0]?.value).toBe(
      "color-mix(in srgb, #476f8f 18%, var(--surface))",
    );

    applyAppThemeColorOverrides(target as unknown as CSSStyleDeclaration, {});
    expect(target.getPropertyValue("--accent")).toBe("");
    expect(target.getPropertyValue("--accent-soft")).toBe("");
    expect(target.getPropertyValue("--on-accent")).toBe("");
  });

  it("picks dark ink on a light accent", () => {
    expect(contrastingInk("#e8d34d")).toBe("#0f0f0d");
    expect(contrastingInk("#5f7f31")).toBe("#ffffff");
  });

  it("keeps Insights focus/drift paints on productivity tokens", () => {
    const styles = readAppStyles();
    expect(styles).toContain(".productivity-rhythm-card__legend-dot--focus {\n  background: var(--productivity-focus);");
    expect(styles).toContain(".productivity-rhythm-card__cell--focus-1 {\n  background: color-mix(in srgb, var(--productivity-focus) 18%, var(--surface-strong));");
    expect(styles).toContain(".productivity-insight-group--focus {\n  --insight-group-tone: var(--productivity-focus);");
    expect(styles).not.toContain(".productivity-insight-group--focus {\n  --insight-group-tone: var(--accent);");
  });
});
