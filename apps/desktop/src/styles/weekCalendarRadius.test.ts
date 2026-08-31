import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("./tokens-base.css", import.meta.url), "utf8");
const weekStyleSources = [
  readFileSync(new URL("./week-dashboard.css", import.meta.url), "utf8"),
  readFileSync(new URL("../features/dashboard/week-dashboard.css", import.meta.url), "utf8"),
];

describe("Your Week event radius", () => {
  it("keeps dense calendar events on the structural 4px radius", () => {
    expect(tokens).toContain("--week-calendar-event-radius: 4px;");

    for (const styles of weekStyleSources) {
      expect(styles).toMatch(/\.week-v2-calendar__event\s*\{[\s\S]*?border-radius:\s*var\(--week-calendar-event-radius\);/);
      expect(styles).toMatch(/\.week-v2-calendar__event--micro\s*\{[\s\S]*?border-radius:\s*4px;/);
    }
  });
});
