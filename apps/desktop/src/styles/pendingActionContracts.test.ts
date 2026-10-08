import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contracts for the 2026-10-08 pending/failed-action pass. Each one names the
 * movement it exists to prevent; the geometry itself is measured in the
 * review harness, so these only guard the rules that make the measurement
 * hold.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const tokens = read("./tokens-base.css");
const actionLabel = read("../components/action-label.css");
const shareCard = read("../features/share/share-card.css");

function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `missing selector ${selector}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

describe("pending and failed actions keep their place", () => {
  it("skips the hover lift on disabled buttons instead of resetting every transform", () => {
    // button:disabled { transform: none } also dropped the translateY(-50%)
    // that centers the share card's stage arrows, so they fell 19px while an
    // export was pending.
    expect(tokens).toContain("button:hover:not(:disabled) { transform: translateY(-1px); }");
    expect(ruleBody(tokens, "button:disabled {")).not.toContain("transform");
    expect(ruleBody(shareCard, ".share-card-stage__arrow {")).toContain("transform: translateY(-50%);");
  });

  it("stacks every button label in one grid cell so the busy state cannot resize it", () => {
    expect(ruleBody(actionLabel, ".action-label {")).toContain("display: inline-grid;");
    expect(ruleBody(actionLabel, ".action-label > * {")).toContain("grid-area: 1 / 1;");
    expect(ruleBody(actionLabel, ".action-label__size {")).toContain("visibility: hidden;");
    // A busy button is working, not unavailable.
    expect(actionLabel).toContain('.modal-btn[aria-busy="true"]:disabled,');
    expect(ruleBody(actionLabel, '.excluded-apps-item__history[aria-busy="true"]:disabled {')).toContain("opacity: 1;");
  });

  it("delays the spinner so a fast request does not flash", () => {
    expect(ruleBody(actionLabel, ".action-label__spinner {")).toContain("action-label-appear 120ms 150ms");
  });
});
