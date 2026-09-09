import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppStyles, readCssWithImports } from "../../test/readStyles";

function cssRuleExact(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`^\\s*${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\s*\\}`, "m"))?.[0] ?? "";
}

/**
 * The settings rail stacks Back, the search field, and the section rows in one
 * column. Their heights drifted apart once the nav rows moved to the shared
 * --nav-item-height token: Back and the search field kept the pre-token 36px.
 * Pin all three to the token so a future density change moves them together.
 */
describe("settings sidebar rail sync", () => {
  it("puts the search field on the shared nav row token", () => {
    const searchStyles = readCssWithImports(resolve("src/features/settings/SettingsSearch.css"));
    const fieldRule = cssRuleExact(searchStyles, ".settings-search__field");

    expect(fieldRule).toContain("min-height: var(--nav-item-height);");
    expect(fieldRule).not.toMatch(/min-height:\s*36px/);
    // Block padding on the input would out-grow the field's row height.
    expect(searchStyles).not.toMatch(/\.settings-search__field input\s*\{[^}]*padding:\s*7px/);
  });

  it("puts the settings back button on the shared nav row token", () => {
    const styles = readAppStyles();
    const backRule = cssRuleExact(styles, ".settings-sidebar-back");

    expect(backRule).toContain("min-height: var(--nav-item-height);");
    expect(backRule).toContain("padding: 0 var(--sidebar-row-inline-padding);");
    expect(backRule).not.toMatch(/min-height:\s*2\.25rem/);
  });

  /**
   * --surface is the content-panel color. On the tinted rail it rendered as a
   * bright warm chip in light mode and a near-black bar in dark mode, so the
   * resting field must stay a tint of the rail instead.
   */
  it("keeps the resting search field in the rail's material", () => {
    const searchStyles = readCssWithImports(resolve("src/features/settings/SettingsSearch.css"));
    const fieldRule = cssRuleExact(searchStyles, ".settings-search__field");
    const focusRule = cssRuleExact(searchStyles, ".settings-search__field:focus-within");

    expect(fieldRule).toContain("background: color-mix(in srgb, var(--text) 5%, transparent);");
    expect(fieldRule).not.toMatch(/background:\s*var\(--surface\)/);
    expect(fieldRule).toContain("border: 1px solid transparent;");
    // Focus deepens the same well; swapping to the panel color reintroduces the bar.
    expect(focusRule).not.toMatch(/background:\s*var\(--surface\)/);
    expect(focusRule).toContain("border-color: var(--accent);");
  });
});
