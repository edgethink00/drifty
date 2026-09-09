import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contracts for the approved 2026-09-09 polish pass. Each one names the
 * regression it exists to catch, because every rule here undoes an older
 * treatment that a later edit could plausibly restore by accident.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const settings = read("./settings.css");
const polish = read("./settings-polish.css");
const parity = read("./visual-parity.css");
const classification = read("./classification.css");
const prototype = read("./prototype-compat.css");
const weekFeature = read("../features/dashboard/week-dashboard.css");
const flowChart = read("../features/flow-chart/flow-chart.css");
const settingsSearch = read("../features/settings/SettingsSearch.css");
const projects = read("../features/projects/projects.css");
const leaderboard = read("../features/leaderboard/leaderboard.css");

/** The declaration block that follows an exact selector line. */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `missing selector ${selector}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  expect(open, `unterminated rule for ${selector}`).toBeGreaterThan(-1);
  expect(close, `unterminated rule for ${selector}`).toBeGreaterThan(open);
  return source.slice(open + 1, close);
}

/** Everything inside an at-rule, found by matching its braces. */
function atRuleBody(source: string, header: string): string {
  const start = source.indexOf(header);
  expect(start, `missing at-rule ${header}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated at-rule ${header}`);
}

describe("approved UI polish contracts", () => {
  it("sets settings descriptions in the UI face, so prose stops being typeset as values", () => {
    expect(ruleBody(settings, ".settings-row .desc")).toContain("font-family: var(--font-ui);");
    // The Classification-only override existed solely to escape the mono default.
    expect(polish).not.toContain(".settings-section--classification .settings-row > div > .desc");
  });

  it("keeps the Classification stats as one divided strip instead of four cards", () => {
    const summary = ruleBody(polish, ".content--classification .clf-summary");
    expect(summary).toContain("border: 1px solid var(--line);");
    expect(summary).toContain("gap: 0;");
    expect(ruleBody(polish, ".content--classification .clf-stat +")).toContain("border-left: 1px solid var(--line);");

    // Both later cascade layers have to agree, or the tiles regain their borders.
    for (const [label, source] of [["settings-polish", polish], ["visual-parity", parity]] as const) {
      const tile = ruleBody(source, ".content--classification .clf-stat {");
      expect(tile, label).toContain("border: 0;");
      expect(tile, label).toContain("background: transparent;");
      expect(tile, label).toContain("box-shadow: none;");
    }

    // The empty state used to tint each tile, which reads as cards again.
    expect(
      ruleBody(classification, ".content--classification .page:has(.classification-panel-view--empty-state) .clf-stat {"),
    ).toContain("background: transparent;");
  });

  it("fades the expanded sidebar foot under the glass account menu and respects reduced motion", () => {
    // The popover stays translucent by contract, so the fix is underneath it.
    expect(prototype).toContain("body:has(.account-popover) .sidebar:not(.sidebar--collapsed) .sidebar-cta-slot-wrap,");
    const fade = ruleBody(prototype, "body:has(.account-popover) .sidebar:not(.sidebar--collapsed) .tracker-control");
    expect(fade).toContain("opacity: 0.08;");
    // Pause tracking and Upgrade to Pro sit in there; a dismissing click on an
    // invisible control must not reach them.
    expect(fade).toContain("pointer-events: none;");
    expect(prototype).toContain("@media (prefers-reduced-motion: reduce)");

    // The collapsed rail opens the menu beside the foot, so it must keep its cards.
    expect(prototype).not.toContain("body:has(.account-popover) .sidebar .tracker-control");
  });

  it("drops the label on 12px week events, where a 12px line could only clip", () => {
    const hidden = ruleBody(weekFeature, ".week-v2-calendar__event--tiny strong,");
    expect(hidden).toContain("display: none;");
    expect(weekFeature).toContain(".week-v2-calendar__event--tiny .week-v2-calendar__identity-strip");
  });

  it("compacts the flow-chart actions row without going under the 11px type floor", () => {
    const start = flowChart.indexOf("@container (max-width: 640px)");
    expect(start).toBeGreaterThan(-1);
    // The 640px band sits between the 820px label fold and the 660px stack.
    expect(start).toBeGreaterThan(flowChart.indexOf("@container (max-width: 660px)"));
    const band = atRuleBody(flowChart, "@container (max-width: 640px)");
    // Both marker kinds share the row in Category mode, so both must shrink.
    expect(band).toContain(".flow-chart-legend__dot,");
    expect(band).toContain(".flow-chart-legend__tone-dot");
    // typographyScale.test.ts owns the floor; this asserts the band never tries.
    expect(band).not.toContain("font-size:");
  });

  it("aligns the Projects and Leaderboard search fields to the 2rem control row", () => {
    const projectSearch = ruleBody(projects, ".projects-page .projects-search .settings-input");
    expect(projectSearch).toContain("height: 2rem;");
    expect(ruleBody(leaderboard, ".leaderboard-search {")).toContain("min-height: 2rem;");

    // All three search fields read at one size, taken from the Settings field
    // that already shipped it. 0.86rem and the mono default were the outliers.
    const searchSize = "font-size: 0.8125rem;";
    expect(ruleBody(settingsSearch, ".settings-search__field input")).toContain(searchSize);
    expect(projectSearch).toContain(searchSize);
    expect(ruleBody(leaderboard, ".leaderboard-search input")).toContain(searchSize);
  });
});
