import { describe, expect, it } from "vitest";

import { readCssWithImports } from "../../test/readStyles";

const leaderboardStyles = readCssWithImports("src/features/leaderboard/leaderboard.css");

function rules(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...leaderboardStyles.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)}`, "g"))];
  return matches.map((match) => match.groups?.body ?? "");
}

function ruleContaining(selector: string, property: RegExp): string {
  return rules(selector).reverse().find((body) => property.test(body)) ?? "";
}

describe("leaderboard operate layout styles", () => {
  it("keeps page scrolling off while the ranking list owns vertical overflow", () => {
    expect(ruleContaining(".content--leaderboard", /overflow-y:/)).toMatch(/overflow-y:\s*hidden;/);
    expect(ruleContaining(".content--leaderboard .leaderboard-list-frame", /overflow-y:/)).toMatch(/overflow-y:\s*auto;/);
  });

  it("lets the split profile rail scroll when the card is taller than the pane", () => {
    expect(ruleContaining(".leaderboard-split.lb-v2 > .leaderboard-profile-block", /overflow-y:/)).toMatch(/overflow-y:\s*auto/);
    expect(ruleContaining(".lb-v2 .leaderboard-hero__totals-row", /height:/)).toMatch(/height:\s*auto/);
  });

  it("keeps short final pages aligned below the sticky list header", () => {
    expect(ruleContaining(".content--leaderboard .leaderboard-list-frame", /align-content:/)).toMatch(/align-content:\s*start;/);
    expect(ruleContaining(".content--leaderboard .leaderboard-list-head", /position:/)).toMatch(/position:\s*sticky;/);
  });

  it("uses a quiet compact pagination dock", () => {
    expect(ruleContaining(".leaderboard-pagination", /background:/)).toMatch(/background:\s*transparent;/);
    expect(ruleContaining(".leaderboard-pagination__actions .app-btn", /min-width:/)).toMatch(/min-width:\s*1\.75rem;/);
    expect(ruleContaining(".leaderboard-pagination__actions .app-btn", /border-radius:/)).toMatch(/border-radius:\s*var\(--radius-sm\);/);
  });

  it("gives the ranking list extra height by tightening board chrome", () => {
    expect(ruleContaining(".content--leaderboard .leaderboard-board-block", /padding:/)).toMatch(/padding:\s*0\.35rem 0\.85rem 0;/);
    expect(ruleContaining(".content--leaderboard .leaderboard-list-frame", /margin-top:/)).toMatch(/margin-top:\s*var\(--space-1\);/);
    expect(ruleContaining(".leaderboard-list-head", /min-height:/)).toMatch(/min-height:\s*1\.75rem;/);
  });

  it("keeps status beside period controls so search does not jump during refresh", () => {
    const previewToolbar = ".content--leaderboard .lb-v2 .leaderboard-board-block .leaderboard-toolbar";
    expect(ruleContaining(".content--leaderboard .leaderboard-board-block .leaderboard-toolbar", /flex-wrap:/)).toMatch(/flex-wrap:\s*wrap;/);
    // Narrow boards stack controls, stats, then search; with room the toolbar
    // collapses to a single row since only the Total focus stat remains.
    expect(rules(previewToolbar).some((body) => /"controls status" "stats stats" "search search"/.test(body))).toBe(true);
    expect(ruleContaining(previewToolbar, /grid-template-areas:/)).toMatch(/"controls stats search"/);
    expect(ruleContaining(".content--leaderboard .lb-v2 .leaderboard-toolbar__control-row", /display:/)).toMatch(/display:\s*contents;/);
    expect(rules(previewToolbar).some((body) => /display:\s*flex;/.test(body))).toBe(true);
    expect(ruleContaining(".content--leaderboard .lb-v2 .leaderboard-toolbar__status-slot--list-backed", /display:/)).toMatch(/display:\s*none;/);
    expect(ruleContaining(".content--leaderboard .lb-v2 .leaderboard-list-head__status > .leaderboard-refresh-status", /display:/)).toMatch(/display:\s*inline-flex;/);
    expect(ruleContaining(".content--leaderboard .lb-v2 .leaderboard-list-head__metrics", /grid-column:/)).toMatch(/grid-column:\s*2;/);
  });

  it("lays Embed and Share side by side at equal width in the split preview", () => {
    const shareRow = '.lb-v2 .leaderboard-hero__share-actions';
    expect(ruleContaining(shareRow, /grid-auto-flow:/)).toMatch(/grid-auto-flow:\s*column;/);
    expect(ruleContaining(shareRow, /grid-auto-columns:/)).toMatch(/grid-auto-columns:\s*minmax\(0, 1fr\);/);
  });

  it("drops the Daily avg column on narrow boards so names keep their room", () => {
    // The header and the rows share one rule, so the second selector carries the declaration.
    expect(leaderboardStyles).toContain(".content--leaderboard .lb-v2 .leaderboard-list-head__metrics > :nth-child(n + 2),");
    expect(ruleContaining(".content--leaderboard .lb-v2 .leaderboard-row__meta--compact > :nth-child(n + 2)", /display:/)).toMatch(/display:\s*none;/);
    expect(leaderboardStyles).toMatch(/@container leaderboard-board \(max-width: 34rem\)/);
  });

  it("keeps Join as the filled primary action while Leave and Embed stay quiet", () => {
    expect(ruleContaining(".lb-v2 .leaderboard-hero__rail-actions .hero-action-btn:not(.leaderboard-hero__participation--join)", /background:/)).toMatch(/background:\s*transparent !important;/);
    expect(rules(".lb-v2 .leaderboard-hero__participation--join").some((body) => /background:/.test(body))).toBe(false);
  });

  it("starts the split preview at the top of the page once the title row is gone", () => {
    const flushPage = ".content--leaderboard .page.page--lb-flush";
    expect(ruleContaining(flushPage, /grid-template-rows:/)).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\);/);
  });
});
