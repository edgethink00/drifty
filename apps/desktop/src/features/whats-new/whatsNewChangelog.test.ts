// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWhatsNewChangelog, parseChangelogHtml, parseChangelogLabel } from "./whatsNewChangelog";

// Mirrors the drifty.so changelog markup that its own tests enforce.
const PAGE = String.raw`<!doctype html><html><body><main><ol>
  <li class="release-entry" id="v1-12-4">
    <div class="release-entry__meta">
      <time datetime="2026-10-12">October 12, 2026</time>
      <a class="release-entry__versions" href="#v1-12-4">Mac v1.12.4</a>
    </div>
    <article class="release-entry__body">
      <h3>Page clues in more browsers.</h3>
      <ul>
        <li>Safari &amp; Firefox
          send page clues.</li>
        <li>You can hide the pet's quick controls.</li>
      </ul>
    </article>
  </li>
  <li class="release-entry" id="v1-12-3-win">
    <div class="release-entry__meta"><time datetime="2026-10-12">October 12, 2026</time>
      <a class="release-entry__versions" href="#v1-12-3-win">Windows v1.12.3</a></div>
    <article class="release-entry__body"><h3>A simpler first start.</h3><ul><li>Welcome and sign-in share one screen.</li></ul></article>
  </li>
  <li class="release-entry" id="v1-11-17">
    <div class="release-entry__meta"><time datetime="2026-09-26">September 26, 2026</time>
      <a class="release-entry__versions" href="#v1-11-17">v1.11.17–1.11.21</a></div>
    <article class="release-entry__body"><h3>Steadier tracking.</h3><ul><li>Tracking recovers faster.</li></ul></article>
  </li>
  <li class="release-entry" id="broken">
    <div class="release-entry__meta"><a class="release-entry__versions" href="#broken">Coming soon</a></div>
    <article class="release-entry__body"><h3>Not a release.</h3></article>
  </li>
</ol></main></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("drifty.so changelog parsing", () => {
  it("reads chapters as plain text with their platform and version range", () => {
    const entries = parseChangelogHtml(PAGE);

    expect(entries.map((entry) => [entry.id, entry.label, entry.platforms, entry.fromVersion, entry.toVersion])).toEqual([
      ["v1-12-4", "v1.12.4", ["macos"], "1.12.4", "1.12.4"],
      ["v1-12-3-win", "v1.12.3", ["windows"], "1.12.3", "1.12.3"],
      ["v1-11-17", "v1.11.17–1.11.21", ["macos", "windows"], "1.11.17", "1.11.21"],
    ]);
    expect(entries[0].summary).toBe("Page clues in more browsers.");
    expect(entries[0].items).toEqual(["Safari & Firefox send page clues.", "You can hide the pet's quick controls."]);
    expect(entries[0].date).toBe("2026-10-12");
  });

  it("rejects labels that are not a version or a version range", () => {
    expect(parseChangelogLabel("Linux v1.0.0")).toBeNull();
    expect(parseChangelogLabel("v1.12")).toBeNull();
    expect(parseChangelogLabel("v1.11.17-1.11.21")?.toVersion).toBe("1.11.21");
  });
});

describe("changelog loading", () => {
  it("keeps the last good copy for offline launches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(PAGE, { status: 200 })));
    expect(await loadWhatsNewChangelog("en")).toHaveLength(3);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect((await loadWhatsNewChangelog("en")).map((entry) => entry.id)).toEqual(["v1-12-4", "v1-12-3-win", "v1-11-17"]);
    await expect(loadWhatsNewChangelog("ko")).rejects.toThrow();
  });
});
