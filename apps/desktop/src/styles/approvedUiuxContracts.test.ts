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
const tokens = read("./tokens-base.css");
const sharedSurfaces = read("./shared-surfaces.css");
const authModal = read("../features/auth/AuthModal.css");
const projectEditorFields = read("../components/project-editor-fields.css");
const team = read("../features/team/team.css");

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

  it("packs the Classification stat label against its value instead of stretching them apart", () => {
    // A 28px icon made the strip taller than the two text lines, and
    // space-between put that spare height between the label and the number.
    for (const [label, source] of [["settings-polish", polish], ["visual-parity", parity]] as const) {
      const tile = ruleBody(source, ".content--classification .clf-stat {");
      expect(tile, label).toContain("justify-content: flex-start;");
      expect(tile, label).toContain("gap: 8px;");
      expect(tile, label).toContain("padding: 7px 16px;");
      expect(tile, label).not.toContain("space-between");
    }

    const label = ruleBody(parity, ".content--classification .clf-stat .eyebrow {");
    expect(label).toContain("line-height: 1.3;");
    expect(label).toContain("letter-spacing: 0.04em;");
    expect(label).toContain("margin-bottom: 0;");

    expect(ruleBody(parity, ".content--classification .clf-stat > strong {")).toContain("min-height: 22px;");
    expect(ruleBody(parity, ".content--classification .clf-stat .app-icon--sm,")).toContain("width: 22px;");
    expect(ruleBody(parity, ".content--classification .clf-stat .app-icon--sm,")).toContain("height: 22px;");
  });

  it("keeps the Classification stat strip out of the panel's shrink pool", () => {
    // The strip clips to its own rounded corners, and that overflow waives the
    // flex automatic minimum size: the page's flex column then handed it a
    // share of the scrolling panel's overflow and sliced "1h 44m" in half.
    // Expanding a capture-detail row grew the panel until the values vanished.
    const strip = ruleBody(polish, ".content--classification .clf-summary {");
    expect(strip).toContain("overflow: hidden;");
    expect(strip).toContain("flex: 0 0 auto;");
  });

  it("wraps the capture-detail classification pairs instead of truncating their values", () => {
    // Four fixed columns inside the detail panel left ~70px per value, which
    // turned "Not classified" into "Not classifie…".
    const grid = ruleBody(classification, ".classification-panel-view__activity-classification {");
    expect(grid).toContain("repeat(auto-fit, minmax(5rem, 1fr))");
    const block = classification.slice(
      classification.indexOf(".classification-panel-view__activity-classification {"),
      classification.indexOf("/* Reclassification popover"),
    );
    expect(block).not.toContain("white-space: nowrap;");
    expect(block).not.toContain("text-overflow: ellipsis;");
    expect(block).toContain("overflow-wrap: anywhere;");
  });

  it("fades the expanded sidebar foot under the glass account menu and respects reduced motion", () => {
    // The popover stays translucent by contract, so the fix is underneath it.
    const fade = ruleBody(prototype, "body:has(.account-popover) .sidebar:not(.sidebar--collapsed) .sidebar-cta-slot-wrap");
    expect(fade).toContain("opacity: 0.08;");
    // Upgrade to Pro sits in there; a dismissing click on an invisible control
    // must not reach it.
    expect(fade).toContain("pointer-events: none;");
    expect(prototype).toContain("@media (prefers-reduced-motion: reduce)");

    // The collapsed rail opens the menu beside the foot, so it must keep its cards.
    expect(prototype).not.toContain("body:has(.account-popover) .sidebar .sidebar-cta-slot-wrap");
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

  it("keeps the account language submenu solid and anchored to prevent background bleed", () => {
    const submenu = ruleBody(prototype, ".account-menu-language-submenu {");
    expect(submenu).toContain("background: var(--surface-strong);");
    expect(submenu).toContain("top: 0;");
    expect(submenu).toContain("left: calc(100% + 4px);");
    expect(submenu).toContain("width: 9.75rem;");
    expect(submenu).toContain("backdrop-filter: none;");

    const toggle = ruleBody(prototype, ".account-menu-toggle {");
    expect(toggle).toContain("width: 32px;");
    expect(toggle).toContain("height: 18px;");

    const knob = ruleBody(prototype, ".account-menu-toggle__knob {");
    expect(knob).toContain("width: 14px;");
    expect(knob).toContain("height: 14px;");
  });

  it("draws every writing field with one outline rule instead of four fills", () => {
    // Approved 2026-09-11. Settings dug the box out of --bg-2, feedback used a
    // 70/30 mix that read as dirty white, sign-in used --surface-strong, and
    // account deletion used bare --surface. A later edit could restore any of
    // those four by "matching the surrounding panel", so pin the token.
    expect(tokens).toContain("--field-bg: var(--surface);");
    expect(tokens).toContain("--field-line: color-mix(in srgb, var(--text) 13%, transparent);");
    expect(tokens).toContain("--field-radius: 11px;");

    for (const [source, selector] of [
      [settings, ".settings-input {"],
      [prototype, ".settings-input,"],
      [sharedSurfaces, ".auth-modal__field input {"],
      [sharedSurfaces, ".feedback-modal__input,"],
    ] as const) {
      const body = ruleBody(source, selector);
      expect(body).toContain("background: var(--field-bg);");
      expect(body).toContain("border: 1px solid var(--field-line);");
    }

    // The dark theme used to lift the feedback field with a white mix, which
    // floated it above the dialog instead of sitting it on the same paper.
    expect(sharedSurfaces).not.toContain('color-mix(in srgb, var(--bg-2) 80%, #ffffff)');
    // Focus has to out-rank rest now that idle fields carry a 13% edge.
    expect(tokens).toContain("--field-focus-border: color-mix(in srgb, var(--text) 30%, transparent);");
  });

  it("draws the reveal control instead of labelling it with a second link", () => {
    // "Show password" used to be a text button inside an empty field, styled
    // exactly like the "Forgot password?" link stacked under it. Two identical
    // text actions on different levels read as a defect. The icon is the fix;
    // the recovery link stays under the field where the reading order wants it.
    const toggle = ruleBody(authModal, ".auth-modal__password-toggle {");
    expect(toggle).toContain("width: 28px;");
    expect(toggle).toContain("text-decoration: none;");
    // The 8rem reserve only existed to hold the old text label.
    expect(ruleBody(authModal, ".auth-modal .auth-modal__password-control input {")).toContain("padding-right: 2.5rem;");
    // Flush right keeps it in one column with the fields and the submit button.
    expect(ruleBody(authModal, ".auth-modal__forgot-row {")).not.toContain("padding-right");
  });

  it("drops the feedback resize grip that cut across the field corner", () => {
    // The native handle is drawn in the corner square and cannot be styled, so
    // it crossed the border arc once the field radius grew to 11px.
    expect(sharedSurfaces).toContain("min-height: 168px;");
    expect(sharedSurfaces).toContain("resize: none;");
    // Every writing textarea, not just the one that surfaced the defect. Three
    // of the app's seven already shipped resize: none, so the odd ones out were
    // the four that still drew a handle over a rounded corner.
    for (const source of [sharedSurfaces, projectEditorFields, settings, leaderboard, team]) {
      expect(source).not.toContain("resize: vertical");
    }
  });
});
