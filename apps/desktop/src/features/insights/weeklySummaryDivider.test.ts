// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("insights weekly summary divider", () => {
  const styles = readFileSync(new URL("./insights.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");

  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u").exec(styles);
    if (!match?.groups) throw new Error(`Missing rule for ${selector}`);
    return match.groups.body;
  }

  it("keeps the chart rule and drops the rule between the two summaries", () => {
    const chartRule = ruleBody(".insights-stacked__breakdown .weekly-productivity-trend-card + .weekly-summary-rail");
    expect(chartRule).toMatch(/border-top:\s*1px solid var\(--line\);/u);
    const summaryRule = ruleBody(".insights-stacked__breakdown .flow-compact-split-chart__panel \+ .flow-compact-split-chart__panel");
    expect(summaryRule).toMatch(/border-top:\s*0;/u);
    const circle = ruleBody(".insights-stacked__breakdown .weekly-summary-rail .flow-compact-split-chart__panel--circle");
    expect(circle).toMatch(/gap:\s*14px;/u);
  });
});
