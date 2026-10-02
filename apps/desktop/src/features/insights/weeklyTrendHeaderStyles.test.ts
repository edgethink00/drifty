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

  it("keeps the mode toggle on one row, aligned to the hour-axis edge", () => {
    // A second row made the loaded card taller than the skeleton, which moved
    // everything below it when the Insights body finished loading.
    const head = ruleBody(".weekly-productivity-trend-card__head");
    expect(head).toMatch(/flex-wrap:\s*nowrap;/u);
    expect(head).toMatch(/justify-content:\s*flex-end;/u);
  });

  it("does not reserve a title beside the mode toggle", () => {
    expect(styles).not.toMatch(/\.weekly-productivity-trend-card__head \.insight-section__label/u);
  });
});
