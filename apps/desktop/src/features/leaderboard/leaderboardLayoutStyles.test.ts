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
});
