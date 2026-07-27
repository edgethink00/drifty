import { describe, expect, it } from "vitest";
import { buildRankEmbedSnippet, buildRankEmbedUrl } from "./rankEmbedSnippets";

const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";

describe("rank embed snippets", () => {
  it("omits the legacy card design from a default weekly light embed URL", () => {
    expect(buildRankEmbedUrl(PUBLIC_ID)).toBe(
      `https://drifty.so/embed/?id=${PUBLIC_ID}&view=rank`,
    );
  });

  it("includes non-default period and theme options", () => {
    const url = buildRankEmbedUrl(PUBLIC_ID, { period: "monthly", theme: "dark" });
    expect(url).toContain("view=rank");
    expect(url).toContain("period=monthly");
    expect(url).toContain("theme=dark");
  });

  it("generates a labelled iframe", () => {
    const snippet = buildRankEmbedSnippet(PUBLIC_ID, { period: "daily" });
    expect(snippet).toContain("<iframe");
    expect(snippet).toContain("period=daily");
    expect(snippet).toContain('title="Drifty leaderboard rank"');
  });
});
