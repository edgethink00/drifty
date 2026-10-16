import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";
import { BALANCED_PRESETS } from "../../lib/colorPalette";
import { contrastRatio, darkAccentTone } from "../../lib/accentTone";
import {
  accentColorForTheme,
  applyAppThemeColorOverrides,
  contrastingInk,
  derivedThemeColorCustomProperties,
} from "./settingsStorage";

function styleTarget() {
  return {
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
}

function darkSurface(): string {
  const match = /:root\[data-theme="dark"\] \{[^}]*?--surface: (#[0-9a-f]{6});/.exec(readAppStyles());
  if (!match?.[1]) throw new Error("dark --surface token not found");
  return match[1];
}

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

  it("paints a picked accent in its lighter dark tone in dark mode, with dark ink on it", () => {
    const target = styleTarget();
    applyAppThemeColorOverrides(target as unknown as CSSStyleDeclaration, { accent: "#4d4b45" }, "dark");
    const painted = target.getPropertyValue("--accent");
    expect(painted).toBe(darkAccentTone("#4d4b45"));
    expect(painted).not.toBe("#4d4b45");
    expect(contrastRatio(painted, darkSurface())).toBeGreaterThanOrEqual(4.5);
    expect(target.getPropertyValue("--accent-soft")).toBe(`color-mix(in srgb, ${painted} 18%, var(--surface))`);
    expect(target.getPropertyValue("--on-accent")).toBe("#0f0f0d");

    // Switching back to light paints the saved value itself.
    applyAppThemeColorOverrides(target as unknown as CSSStyleDeclaration, { accent: "#4d4b45" }, "light");
    expect(target.getPropertyValue("--accent")).toBe("#4d4b45");
    expect(target.getPropertyValue("--on-accent")).toBe("#ffffff");
  });

  it("keeps every palette accent readable on the dark surface and under dark ink", () => {
    const surface = darkSurface();
    for (const preset of BALANCED_PRESETS) {
      const tone = darkAccentTone(preset.color);
      expect(contrastRatio(tone, surface), preset.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tone, "#0f0f0d"), preset.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lets a stored moss pick fall back to the built-in light and dark moss", () => {
    expect(accentColorForTheme("#5F7F31", "dark")).toBeUndefined();
    expect(accentColorForTheme("#5f7f31", "light")).toBeUndefined();
    expect(accentColorForTheme(undefined, "dark")).toBeUndefined();
    const target = styleTarget();
    target.setProperty("--accent", "#123456");
    applyAppThemeColorOverrides(target as unknown as CSSStyleDeclaration, { accent: "#5f7f31" }, "dark");
    expect(target.getPropertyValue("--accent")).toBe("");
    expect(target.getPropertyValue("--on-accent")).toBe("");
  });

  it("keeps Insights focus/drift paints on productivity tokens", () => {
    const styles = readAppStyles();
    expect(styles).toContain(".productivity-rhythm-card__legend-dot--focus {\n  background: var(--productivity-focus);");
    expect(styles).toContain(".productivity-rhythm-card__cell--focus-1 {\n  background: color-mix(in srgb, var(--productivity-focus) 18%, var(--surface-strong));");
    expect(styles).toContain(".productivity-insight-group--focus {\n  --insight-group-tone: var(--productivity-focus);");
    expect(styles).not.toContain(".productivity-insight-group--focus {\n  --insight-group-tone: var(--accent);");
  });
});
