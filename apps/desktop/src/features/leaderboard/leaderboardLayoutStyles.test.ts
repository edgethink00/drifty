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
    expect(ruleContaining(".content--leaderboard .leaderboard-list-frame", /margin-top:/)).toMatch(/margin-top:\s*0\.28rem;/);
    expect(ruleContaining(".leaderboard-list-head", /min-height:/)).toMatch(/min-height:\s*1\.75rem;/);
  });

  it("keeps the period control on the same toolbar row as the board stats", () => {
    const toolbarColumns = rules(".content--leaderboard .leaderboard-board-block .leaderboard-toolbar")
      .filter((body) => /grid-template-columns:/.test(body));
    expect(toolbarColumns.some((body) => /max-content minmax\(0, 1fr\) minmax\(11rem, 14rem\)/.test(body))).toBe(true);
    expect(toolbarColumns.every((body) => !/grid-column:\s*1 \/ -1/.test(body))).toBe(true);
  });

});
