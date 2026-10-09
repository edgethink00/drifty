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
const appShell = read("./app-shell.css");

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
    expect(tokens).toContain("button:hover:where(:not(:disabled)) { transform: translateY(-1px); }");
    expect(ruleBody(tokens, "button:disabled {")).not.toContain("transform");
    expect(ruleBody(shareCard, ".share-card-stage__arrow {")).toContain("transform: translateY(-50%);");
  });

  it("keeps the hover lift below one-class component hover rules", () => {
    // A bare :not(:disabled) made the lift (0,2,1) in 1.12.2. It then beat
    // one-class hover rules such as .window-sidebar-toggle:hover (0,2,0):
    // the macOS sidebar toggle lost the translateX that places it and the
    // share card arrows lost their translateY(-50%), so both slid out from
    // under the cursor and ignored clicks.
    const lifts = [...tokens.matchAll(/^([^{}\n]*button[^{}\n]*:hover[^{}\n]*)\{[^}]*translateY\(-1px\)/gm)].map(match => match[1].trim());
    expect(lifts).toHaveLength(1);
    expect(lifts[0].replace(/:where\([^)]*\)+/g, "")).toBe("button:hover");
    expect(ruleBody(appShell, ".window-sidebar-toggle:hover {")).toContain("transform: translateX(var(--window-sidebar-toggle-shift));");
    expect(ruleBody(shareCard, ".share-card-stage__arrow:hover {")).toContain("transform: translateY(-50%) scale(1.05);");
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
