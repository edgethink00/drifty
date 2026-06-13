import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Settings content styles", () => {
  it("does not stack an inner heading divider against each settings card border", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const headingRule = styles.match(/\.content--settings \.settings-block h3\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(headingRule).toContain("border-bottom: 0;");
    expect(headingRule).toContain("padding-bottom: 0;");
  });
});
