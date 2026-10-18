import { describe, expect, it } from "vitest";

import { readCssWithImports } from "../../test/readStyles";

const screenStyles = readCssWithImports("src/features/leaderboard/leaderboard-screen.css");
const panelStyles = readCssWithImports("src/features/leaderboard/leaderboard.css");

function rules(styles: string, selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(escapedSelector + "\\s*\\{(?<body>[^}]*)}", "g"))];
  return matches.map((match) => match.groups?.body ?? "");
}

function ruleContaining(styles: string, selector: string, property: RegExp): string {
  return rules(styles, selector).reverse().find((body) => property.test(body)) ?? "";
}

describe("leaderboard screen layout styles", () => {
  it("keeps page scrolling off while only the ranking list scrolls", () => {
    expect(ruleContaining(panelStyles, ".content--leaderboard", /overflow-y:/)).toMatch(/overflow-y:\s*hidden;/);
    expect(ruleContaining(screenStyles, ".lb7-list", /overflow-y:/)).toMatch(/overflow-y:\s*auto;/);
  });

  // Owner decision 2026-10-19: joining, leaving and "not ranked yet" share one
  // top-row height, so the list never jumps under the member's pointer.
  it("holds the profile and Top 3 row at one height in every participation state", () => {
    expect(ruleContaining(screenStyles, ".lb7-top", /min-height:/)).toMatch(/min-height:\s*13\.25rem;/);
  });
});

