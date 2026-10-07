import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Settings search target highlight", () => {
  it("draws a fully rounded ring inside a row so it stays within the grouped card", () => {
    const styles = readFileSync("src/features/settings/SettingsSearch.css", "utf8");
    const rowRule = styles.match(/\.settings-search-target\.settings-row\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const ringRule = styles.match(/\.settings-search-target\.settings-row::before\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    // The row's own outline would spill past the rounded card and cut across neighbouring rows.
    expect(rowRule).toContain("outline: none !important;");
    // The ring is a rounded box inset within the row, so the card edges and dividers stay intact.
    expect(ringRule).toContain("border: 2px solid var(--accent);");
    expect(ringRule).toContain("border-radius: 12px;");
    expect(ringRule).toMatch(/inset: \d+px \d+px;/);
  });
});
