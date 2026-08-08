import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCssWithImports } from "../../test/readStyles";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("Project corrections card styles", () => {
  const styles = readCssWithImports("src/features/classification/project-corrections.css");

  it("keeps long correction lists inside a capped scrollable shell", () => {
    const source = readFileSync("src/features/classification/ProjectCorrectionsCard.tsx", "utf8");
    const shellRule = cssRule(styles, ".corrections-list-shell");
    const listRule = cssRule(styles, ".corrections-list");

    expect(source).toContain("corrections-list-shell");
    expect(shellRule).toContain("overflow: hidden;");
    expect(listRule).toContain("max-height: min(16rem, 42vh);");
    expect(listRule).toContain("overflow-y: auto;");
    expect(listRule).toContain("scrollbar-gutter: stable;");
    expect(listRule).toContain("overscroll-behavior: contain;");
  });

  it("shows an always-visible scrollbar thumb inside the list", () => {
    const scrollbarRule = cssRule(styles, ".corrections-list::-webkit-scrollbar");
    const thumbRule = cssRule(styles, ".corrections-list::-webkit-scrollbar-thumb");

    expect(scrollbarRule).toContain("width: 8px;");
    expect(thumbRule).toContain("border-radius: 999px;");
    expect(thumbRule).toContain("background: color-mix(in srgb, var(--text-soft) 40%, transparent);");
    // The standard scrollbar-color property must stay unset: it disables
    // ::-webkit-scrollbar styling in WebKit/Chromium and hides the thumb.
    const listRule = cssRule(styles, ".corrections-list");
    expect(listRule).not.toContain("scrollbar-color");
  });
});
