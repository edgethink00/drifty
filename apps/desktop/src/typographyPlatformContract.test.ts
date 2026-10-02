import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

/** macOS uses system faces, so each base stack has to name its own platform
 * group. The original stacks named only Apple faces, so the entire Windows
 * build resolved past every one of them into a browser default: measured on a
 * real Windows host, body text and mono both landed on faces that match no
 * Windows UI font. Windows now leads with the bundled Pretendard face because
 * Malgun Gothic's three weights could not follow the app's weight scale beside
 * Segoe; the system names stay behind it as a load-failure fallback. */
const tokens = read("./styles/tokens-base.css");

function stack(name: string): string {
  const match = tokens.match(new RegExp(`--${name}:([^;]+);`));
  if (!match) throw new Error(`${name} is not declared in tokens-base.css`);
  return match[1];
}

function block(selector: string): string {
  const start = tokens.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} is not declared in tokens-base.css`);
  return tokens.slice(start, tokens.indexOf("}", start));
}

function windowsStack(name: string, selector = ':root[data-platform="windows"]'): string {
  const match = block(selector).match(new RegExp(`--${name}:([^;]+);`));
  if (!match) throw new Error(`${name} is not overridden in ${selector}`);
  return match[1].trim();
}

function fontFace(family: string): string {
  const face = [...tokens.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]).find((body) => body.includes(`"${family}"`));
  if (!face) throw new Error(`no @font-face declares ${family}`);
  return face;
}

const srcRoot = new URL("./", import.meta.url);
const cssFiles = (readdirSync(srcRoot, { recursive: true }) as string[])
  .filter((path) => path.endsWith(".css"))
  .map((path) => ({ path, css: read(`./${path}`) }));

describe("typography platform coverage", () => {
  it("names a Windows UI face in the sans and display stacks", () => {
    for (const token of ["font-sans", "font-display"]) {
      const value = stack(token);
      expect(value, token).toMatch(/Segoe UI Variable (Text|Display)/);
      // Windows 10 has no Segoe UI Variable, so the static face is required too.
      expect(value, token).toMatch(/"Segoe UI"/);
    }
  });

  it("names a Hangul face, because no Segoe face carries Hangul", () => {
    // Without this the browser chooses the Korean fallback itself and the
    // choice varies by machine, so Korean copy renders inconsistently.
    for (const token of ["font-sans", "font-display"]) {
      expect(stack(token), token).toMatch(/"Malgun Gothic"/);
    }
  });

  it("names a Hangul face in the mono stack too", () => {
    // Cascadia and Consolas carry no Hangul. Left unnamed, Chromium picked the
    // system's fixed-width Korean face: the sidebar section labels rendered in
    // bitmap-era GulimChe, verified through CSS.getPlatformFontsForNode on a
    // real Windows host. Korean text in this stack is read, not column-aligned.
    expect(stack("font-mono")).toMatch(/"Malgun Gothic"/);
  });

  it("names a Windows monospace face ahead of the generic", () => {
    const value = stack("font-mono");
    expect(value).toMatch(/"Cascadia Mono"/);
    // Windows 10 fallback; the generic alone resolves to Courier New.
    expect(value).toMatch(/Consolas/);
    // lastIndexOf, because indexOf("monospace") matches inside "ui-monospace".
    expect(value.indexOf("Cascadia Mono")).toBeLessThan(value.lastIndexOf("monospace"));
  });

  it("keeps the Apple faces first so macOS rendering is unchanged", () => {
    for (const token of ["font-sans", "font-display"]) {
      const value = stack(token);
      expect(value.trimStart().startsWith("-apple-system"), token).toBe(true);
      expect(value.indexOf("-apple-system")).toBeLessThan(value.indexOf("Segoe"));
    }
  });
});

describe("Windows bundled typography", () => {
  it("leads every Windows text stack with the bundled face, with system names behind it", () => {
    for (const token of ["font-sans", "font-display"]) {
      const value = windowsStack(token);
      expect(value.startsWith('"Drifty Pretendard"'), token).toBe(true);
      expect(value, token).toMatch(/"Segoe UI"/);
      expect(value, token).toMatch(/"Malgun Gothic"/);
    }
  });

  it("ships the font file and its OFL notice", () => {
    const src = fontFace("Drifty Pretendard").match(/url\("([^"]+)"\)/)?.[1];
    expect(src).toBeTruthy();
    expect(existsSync(new URL(`./styles/${src}`, import.meta.url))).toBe(true);
    expect(read("../public/third-party/Pretendard-OFL.txt")).toMatch(/SIL Open Font License/);
  });

  it("leads Windows mono with the bundled Geist Mono and ships its notice", () => {
    // Cascadia Mono read as a code-editor face beside Pretendard, and Windows 10
    // has no Cascadia at all. The bundled face renders the same everywhere.
    for (const selector of [':root[data-platform="windows"]', ':root[data-platform="windows"]:lang(ko)']) {
      const value = windowsStack("font-mono", selector);
      expect(value.indexOf('"Drifty Geist Mono"'), selector).toBeGreaterThanOrEqual(0);
      expect(value.indexOf("Drifty Geist Mono"), selector).toBeLessThan(value.indexOf("Cascadia Mono"));
    }
    expect(windowsStack("font-mono").startsWith('"Drifty Geist Mono"')).toBe(true);
    const src = fontFace("Drifty Geist Mono").match(/url\("([^"]+)"\)/)?.[1];
    expect(existsSync(new URL(`./styles/${src}`, import.meta.url))).toBe(true);
    expect(read("../public/third-party/GeistMono-OFL.txt")).toMatch(/SIL Open Font License/);
  });

  it("keeps Georgia out of the Windows serif role", () => {
    // Georgia defaults to old-style figures, so large totals bounced, and it has
    // no Hangul, so Korean titles fell to the system serif.
    expect(windowsStack("font-serif")).not.toMatch(/Georgia/);
  });

  it("lets Korean mono labels take Hangul and spaces from the companion face only", () => {
    const value = windowsStack("font-mono", ':root[data-platform="windows"]:lang(ko)');
    expect(value.startsWith('"Drifty Hangul Companion"')).toBe(true);
    expect(value.indexOf("Drifty Hangul Companion")).toBeLessThan(value.indexOf("Cascadia Mono"));
    const range = fontFace("Drifty Hangul Companion").match(/unicode-range:([^;]+);/)?.[1] ?? "";
    expect(range).toMatch(/U\+AC00-D7A3/);
    expect(range).toMatch(/U\+0020/);
    // Digits and Latin must stay in the mono face so figures keep aligning.
    expect(range).not.toMatch(/U\+00(2[1-9A-F]|[3-7][0-9A-F])/);
  });
});

describe("typography cascade hygiene", () => {
  it("scales every wide letter-spacing so Korean labels do not spread apart", () => {
    const offenders = cssFiles.flatMap(({ path, css }) =>
      [...css.matchAll(/letter-spacing:\s*([^;]+);/g)]
        .filter(([, value]) => /^0?\.(\d+)em$/.test(value.trim()) && Number.parseFloat(value) >= 0.06)
        .map(([declaration]) => `${path}: ${declaration}`),
    );
    expect(offenders).toEqual([]);
    expect(block(":lang(ko)")).toMatch(/--caps-tracking-scale:\s*0\.\d+/);
  });

  it("references only font tokens that are declared", () => {
    const declared = new Set(cssFiles.flatMap(({ css }) => [...css.matchAll(/(--font-[\w-]+)\s*:/g)].map((m) => m[1])));
    const missing = cssFiles.flatMap(({ path, css }) =>
      [...css.matchAll(/var\((--font-[\w-]+)\)/g)].filter(([, name]) => !declared.has(name)).map(([, name]) => `${path}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("lets the boot shell body rules yield to the font token once the app loads", () => {
    // html[data-platform="windows"] body outranks the app's body rule, so a
    // literal stack there pinned all inherited text to Segoe and Malgun Gothic.
    const indexHtml = read("../index.html");
    const bodyRules = [...indexHtml.matchAll(/(html[^{]*body)\s*\{([^}]*)\}/g)].filter(([, , body]) => body.includes("font-family"));
    expect(bodyRules.length).toBeGreaterThan(0);
    for (const [, selector, body] of bodyRules) {
      expect(body, selector).toMatch(/font-family:\s*var\(--font-sans,/);
    }
  });

  it("routes app text through the font tokens instead of Apple-only stacks", () => {
    // The served rank badge SVG names its own stack; its preview mirrors it.
    const allowed = new Set(["features/leaderboard/rank-embeds.css"]);
    const offenders = cssFiles
      .filter(({ path }) => path !== "styles/tokens-base.css" && !allowed.has(path))
      .flatMap(({ path, css }) =>
        [...css.matchAll(/font-family:\s*([^;]+);/g)]
          .filter(([, value]) => /-apple-system|"SF (Pro|Mono)"/.test(value))
          .map(([declaration]) => `${path}: ${declaration}`),
      );
    expect(offenders).toEqual([]);
  });
});
