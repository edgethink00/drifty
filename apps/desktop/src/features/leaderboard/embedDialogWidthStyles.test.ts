// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Both embed dialogs share the `auth-modal profile-modal` shell, whose
// `.auth-modal.profile-modal` rule caps it at 470px. A single-class width
// rule loses to that cap and the two-column embed layout collapses.
describe("embed dialog width", () => {
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const shell = strip(readFileSync(new URL("../../styles/leaderboard.css", import.meta.url), "utf8"));
  const profileEmbeds = strip(readFileSync(new URL("./leaderboard.css", import.meta.url), "utf8"));
  const rankEmbeds = strip(readFileSync(new URL("./rank-embeds.css", import.meta.url), "utf8"));

  it("keeps the shared profile-modal cap that the embed dialogs must outrank", () => {
    expect(shell).toMatch(/\.auth-modal\.profile-modal\s*\{[^}]*max-width:\s*470px;/u);
  });

  it("sizes the profile embed dialog with a selector that outranks the cap", () => {
    expect(profileEmbeds).toMatch(/(?:^|\})\s*\.auth-modal\.profile-modal\.profile-embeds-modal\s*\{[^}]*max-width:\s*940px;/u);
  });

  it("sizes the rank embed dialog with a selector that outranks the cap", () => {
    expect(rankEmbeds).toMatch(/(?:^|\})\s*\.auth-modal\.profile-modal\.rank-embeds-modal\s*\{[^}]*max-width:\s*860px;/u);
  });
});
