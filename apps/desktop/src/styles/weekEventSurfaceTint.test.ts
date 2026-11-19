import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("./tokens-base.css", import.meta.url), "utf8");
const weekStyleSources = [
  readFileSync(new URL("./week-dashboard.css", import.meta.url), "utf8"),
  readFileSync(new URL("../features/dashboard/week-dashboard.css", import.meta.url), "utf8"),
];

const weekFeature = weekStyleSources[1]!;

// Owner-tuned soft week blocks (2026-11-20): the block is 35% surface in
// light and 53% in dark (74% and 59% of the old fill), its ink is the same hue,
// and hover steps back toward the colour instead of brightening it.
describe("Your Week event surface tint", () => {
  it("draws pastel blocks with a deeper hover step in both themes", () => {
    const light = /:root\s*\{[\s\S]*?--week-event-surface-tint:\s*(\d+)%/.exec(tokens);
    const dark = /:root\[data-theme="dark"\]\s*\{[\s\S]*?--week-event-surface-tint:\s*(\d+)%/.exec(tokens);
    const lightHover = /:root\s*\{[\s\S]*?--week-event-surface-tint-hover:\s*(\d+)%/.exec(tokens);
    const darkHover = /:root\[data-theme="dark"\]\s*\{[\s\S]*?--week-event-surface-tint-hover:\s*(\d+)%/.exec(tokens);

    expect(light?.[1]).toBe("35");
    expect(dark?.[1]).toBe("53");
    expect(Number(lightHover?.[1])).toBeLessThan(Number(light?.[1]));
    expect(Number(darkHover?.[1])).toBeLessThan(Number(dark?.[1]));
  });

  it("inks block text in the block's own hue and drops the light-theme white text", () => {
    expect(weekFeature).toContain("--week-event-ink: color-mix(in srgb, var(--event-tone, var(--accent)) 30%, black);");
    expect(weekFeature).toContain("--week-event-ink: color-mix(in srgb, var(--event-tone, var(--accent)) 15%, white);");
    expect(weekFeature).toMatch(/\.week-v2-calendar__event strong \{[^}]*color: var\(--week-event-ink\);/);
    expect(weekFeature).toMatch(/\.week-v2-calendar__event small \{[^}]*color: var\(--week-event-ink-soft\);/);
    expect(weekFeature).not.toMatch(/:root:not\(\[data-theme="dark"\]\) \.week-v2-calendar__event strong/);
  });

  it("drives the event background from the themed token, not a fixed percentage", () => {
    for (const styles of weekStyleSources) {
      expect(styles).toMatch(
        /\.week-v2-calendar__event\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--surface\) var\(--week-event-surface-tint\), var\(--event-tone/,
      );
      expect(styles).not.toMatch(/color-mix\(in srgb, var\(--surface\) 20%, var\(--event-tone/);
    }
  });
});
