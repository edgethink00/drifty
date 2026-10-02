// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("alarm follow-through split layout", () => {
  const styles = readFileSync(new URL("./insights.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");

  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u").exec(styles);
    if (!match?.groups) throw new Error(`Missing rule for ${selector}`);
    return match.groups.body;
  }

  it("packs the rate and the path list instead of stretching them apart", () => {
    const card = ruleBody('.insights-fit-window [data-alarm-structure="split-led"]');
    expect(card).toMatch(/grid-template-rows:\s*auto auto;/u);
    expect(card).not.toMatch(/48px/u);
    const paths = ruleBody('.insights-fit-window [data-alarm-structure="split-led"] .alarm-follow-through__paths');
    expect(paths).toMatch(/gap:\s*3px;/u);
    const lede = ruleBody('.insights-fit-window [data-alarm-structure="split-led"] .alarm-follow-through__lede');
    expect(lede).toMatch(/align-self:\s*center;/u);
    expect(paths).not.toMatch(/space-between/u);
    expect(lede).toMatch(/display:\s*flex;/u);
    expect(lede).toMatch(/flex-direction:\s*column;/u);
  });
});
