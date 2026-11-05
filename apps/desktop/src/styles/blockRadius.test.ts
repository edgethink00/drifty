import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC_ROOT, rel), "utf8");
const ruleBody = (css: string, selector: string) => {
  const start = css.indexOf(selector + " {");
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("block corner scale", () => {
  // Owner decision 2026-11-06: a content block rounds 12px and a block inside a
  // block 8px, replacing the 7/10/14/18px mix (Insights read too round at 18px).
  it("defines one outer and one inner block radius", () => {
    const tokens = read("styles/tokens-base.css");
    expect(tokens).toContain("--block-radius: 12px;");
    expect(tokens).toContain("--block-inner-radius: 8px;");
    expect(tokens).toContain("--stacked-column-plot-radius: var(--block-inner-radius);");
    expect(read("styles/app-shell.css")).toMatch(/\.app-shell \{\n  --radius-md: var\(--block-radius\);/);
  });

  it("puts the former 14-18px blocks on the outer radius", () => {
    const insights = read("features/insights/insights.css");
    expect(ruleBody(insights, ".content--trends .insight-section")).toContain("border-radius: var(--block-radius);");
    expect(ruleBody(read("features/leaderboard/leaderboard-screen.css"), ".lb7 .lb7-card")).toContain("border-radius: var(--block-radius);");
    expect(ruleBody(read("styles/classification.css"), ".classification-panel-view__grid")).toContain("border-radius: var(--block-radius);");
    const settings = read("styles/settings-polish.css");
    expect(settings).toContain("border-top-left-radius: var(--block-radius);");
    expect(settings).toContain("border-bottom-right-radius: var(--block-radius);");
    for (const rel of ["features/insights/insights.css", "features/leaderboard/leaderboard-screen.css", "styles/classification.css"]) {
      expect(read(rel), rel).not.toMatch(/border-radius:\s*(?:18px|var\(--radius-lg\))/);
    }
  });

  it("rounds blocks inside blocks less than their container", () => {
    const insights = read("features/insights/insights.css");
    expect(ruleBody(insights, ".content--trends .productivity-insight-group__section")).toContain("border-radius: var(--block-inner-radius);");
    const leaderboard = read("features/leaderboard/leaderboard-screen.css");
    expect(ruleBody(leaderboard, ".lb7-sb__tile")).toContain("border-radius: var(--block-inner-radius);");
    expect(ruleBody(leaderboard, ".lb7-pv8__week")).toContain("border-radius: var(--block-inner-radius);");
  });
});
