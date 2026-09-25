// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom has no layout, so the weekly breakdown header's rendered behaviour is
// verified in a browser; these assertions keep the two rules that produce it.
describe("Insights weekly breakdown header", () => {
  const styles = readFileSync(new URL("./insights.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");

  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u").exec(styles);
    if (!match?.groups) throw new Error(`Missing rule for ${selector}`);
    return match.groups.body;
  }

  it("keeps the title and the mode toggle on one row so the card matches its loading skeleton", () => {
    // A second row made the loaded card taller than the skeleton, which moved
    // everything below it when the Insights body finished loading.
    expect(ruleBody(".weekly-productivity-trend-card__head")).toMatch(/flex-wrap:\s*nowrap;/u);
  });

  it("folds a long title between words instead of clipping it behind a three-mode toggle", () => {
    const label = ruleBody(".weekly-productivity-trend-card__head .insight-section__label");
    expect(label).toMatch(/white-space:\s*normal;/u);
    expect(label).toMatch(/overflow-wrap:\s*normal;/u);
    // Two lines at line-height 1 fit inside the toggle's height, so folding
    // never grows the row.
    expect(label).toMatch(/line-height:\s*1;/u);
  });
});
