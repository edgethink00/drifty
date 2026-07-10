import { describe, it, expect } from "vitest";
import { buildBadgeUrl, buildEmbedSnippets } from "./embedSnippets";

const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";

describe("buildBadgeUrl", () => {
  it("serves the badge under the drifty.so /embed namespace with an encoded id", () => {
    expect(buildBadgeUrl(PUBLIC_ID)).toBe(`https://drifty.so/embed/badge?id=${PUBLIC_ID}`);
  });
  it("threads the dark theme, omitting the light default", () => {
    expect(buildBadgeUrl(PUBLIC_ID, { theme: "dark" })).toBe(`https://drifty.so/embed/badge?id=${PUBLIC_ID}&theme=dark`);
    expect(buildBadgeUrl(PUBLIC_ID)).not.toContain("theme=");
  });
});

describe("buildEmbedSnippets", () => {
  const snippets = buildEmbedSnippets(PUBLIC_ID);

  it("keeps every public surface on drifty.so (no supabase.co leaks)", () => {
    for (const url of [snippets.badgeUrl, snippets.embedUrl, snippets.profileUrl, snippets.dataUrl]) {
      expect(url.startsWith("https://drifty.so/")).toBe(true);
      expect(url).not.toContain("supabase.co");
    }
  });

  it("links the badge image to the hosted profile in markdown", () => {
    expect(snippets.markdown).toBe(`[![Drifty focus](${snippets.badgeUrl})](${snippets.profileUrl})`);
    expect(snippets.profileUrl).toContain(`drifty.so/profile/?id=${PUBLIC_ID}`);
  });

  it("produces an equivalent html snippet", () => {
    expect(snippets.html).toContain(`src="${snippets.badgeUrl}"`);
    expect(snippets.html).toContain(`href="${snippets.profileUrl}"`);
    expect(snippets.html).toContain(`alt="Drifty focus"`);
  });

  it("provides an iframe card snippet pointing at the hosted embed page", () => {
    expect(snippets.embedUrl).toContain(`drifty.so/embed/?id=${PUBLIC_ID}`);
    expect(snippets.iframe).toContain("<iframe");
    expect(snippets.iframe).toContain(`src="${snippets.embedUrl}"`);
    expect(snippets.iframe).toContain(`title="Drifty focus"`);
  });

  it("provides a chart iframe pointing at the chart view", () => {
    expect(snippets.chartIframe).toContain("view=chart");
    expect(snippets.chartIframe).toContain("<iframe");
    expect(snippets.chartIframe).toContain(`title="Drifty focus chart"`);
  });

  it("provides a raw-data JSON url on the badge endpoint", () => {
    expect(snippets.dataUrl).toBe(`${snippets.badgeUrl}&format=json`);
    expect(snippets.dataUrl).toBe(`https://drifty.so/embed/badge?id=${PUBLIC_ID}&format=json`);
  });

  it("threads theme and range options into the urls, omitting defaults", () => {
    const dark30 = buildEmbedSnippets(PUBLIC_ID, { theme: "dark", range: 30 });
    expect(dark30.badgeUrl).toContain("&theme=dark");
    expect(dark30.embedUrl).toContain("&theme=dark");
    expect(dark30.embedUrl).toContain("&range=30");
    expect(dark30.iframe).toContain('height="200"');
    // Defaults stay clean.
    expect(snippets.badgeUrl).not.toContain("theme=");
    expect(snippets.embedUrl).not.toContain("range=");
  });
});
