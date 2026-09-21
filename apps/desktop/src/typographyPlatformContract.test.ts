import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

/** The app ships no font assets, so every face is a system face and each stack
 * has to name its own platform group. The original stacks named only Apple
 * faces, so the entire Windows build resolved past every one of them into a
 * browser default: measured on a real Windows host, body text and mono both
 * landed on faces that match no Windows UI font. These assertions pin the
 * platform coverage that fix restored. */
const tokens = read("./styles/tokens-base.css");

function stack(name: string): string {
  const match = tokens.match(new RegExp(`--${name}:([^;]+);`));
  if (!match) throw new Error(`${name} is not declared in tokens-base.css`);
  return match[1];
}

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
