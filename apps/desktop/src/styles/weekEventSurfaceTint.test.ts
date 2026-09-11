import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("./tokens-base.css", import.meta.url), "utf8");
const weekStyleSources = [
  readFileSync(new URL("./week-dashboard.css", import.meta.url), "utf8"),
  readFileSync(new URL("../features/dashboard/week-dashboard.css", import.meta.url), "utf8"),
];

describe("Your Week event surface tint", () => {
  it("softens the light theme less than the dark theme", () => {
    const light = /:root\s*\{[\s\S]*?--week-event-surface-tint:\s*(\d+)%/.exec(tokens);
    const dark = /:root\[data-theme="dark"\]\s*\{[\s\S]*?--week-event-surface-tint:\s*(\d+)%/.exec(tokens);

    expect(light?.[1]).toBe("12");
    expect(dark?.[1]).toBe("20");
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
