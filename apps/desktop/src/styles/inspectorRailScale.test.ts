import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../features/dashboard/week-dashboard.css", import.meta.url), "utf8");

// The inspector chips are sized in rem, so they grow with the root font size the
// app steps up at 1600px/2000px/2400px. Any row or column that surrounds a chip
// has to ride the same scale, or the breathing room around the chip collapses on
// a wide window while looking correct on the default one.
describe("activity inspector density scales with the type scale", () => {
  it("sizes the picker option row in rem", () => {
    expect(styles).toMatch(/\.week-activity-inspector__picker \[role="option"\]\s*\{[^}]*min-height:\s*1\.6875rem/);
  });

  it("sizes the attribute row in rem", () => {
    expect(styles).toMatch(/\.week-activity-inspector__attribute-trigger\s*\{[^}]*min-height:\s*1\.875rem/);
  });

  it("sizes the attribute label column in rem so long labels stay unclipped when type grows", () => {
    expect(styles).toMatch(/--inspector-attribute-label-width:\s*4\.5rem/);
  });

  it("keeps the chip itself on the same rem scale the rows assume", () => {
    const chip = styles.match(/\.week-activity-inspector__chip\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(chip).toMatch(/font-size:\s*0\.7rem/);
    expect(chip).toMatch(/padding:\s*0\.23rem\s+0\.5rem/);
  });
});
