import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles/first-day-preparation.css", import.meta.url), "utf8");

describe("first-day preparation styles", () => {
  it("keeps failure actions wrapping inside a small window", () => {
    expect(styles).toContain(".first-day-prep__actions");
    expect(styles).toMatch(/\.first-day-prep__actions\s*\{[\s\S]*flex-wrap:\s*wrap;/);
    expect(styles).toMatch(/\.first-day-prep__line\s*\{[\s\S]*max-width:\s*min\(420px, calc\(100vw - 64px\)\);/);
  });

  it("provides a dark-theme surface so the gate does not stay light on a dark app", () => {
    expect(styles).toContain(':root[data-theme="dark"] .first-day-prep');
    expect(styles).toContain(':root[data-theme="dark"] .first-day-prep__action--primary');
  });
});
