import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("boot shell markup", () => {
  const indexSource = readFileSync("index.html", "utf8");

  it("renders the Drifty symbol above the branded loading copy", () => {
    const shellStart = indexSource.indexOf('<div id="boot-shell"');
    const shellEnd = indexSource.indexOf('<div id="boot-error"');
    const bootShell = indexSource.slice(shellStart, shellEnd);

    expect(bootShell).toContain('class="boot-loading__content"');
    expect(bootShell).toContain('class="boot-window-drag-strip" data-tauri-drag-region');
    expect(bootShell).toContain('src="/src/assets/drifty-mark.svg"');
    expect(bootShell).toContain('class="boot-loading__mark"');
    expect(bootShell).toContain('id="boot-status"');
    expect(bootShell).toContain("drifty loading&hellip;");
    expect(indexSource).not.toContain("drifty still loading");
    expect(bootShell.indexOf("boot-loading__mark")).toBeLessThan(bootShell.indexOf("boot-status"));
  });

  it("shows the native window behind the loading canvas without exposing the mounted app", () => {
    expect(indexSource).toMatch(/html, body\s*{[^}]*background:\s*transparent;/s);
    expect(indexSource).toMatch(/--boot-scrim:\s*rgba\(15, 15, 13, 0\.6\);/);
    expect(indexSource).toMatch(/#boot-shell\s*{[^}]*background:\s*var\(--boot-scrim\);/s);
    expect(indexSource).toMatch(/#boot-shell\s*{[^}]*backdrop-filter:\s*blur\(50px\) saturate\(0\.88\);/s);
    expect(indexSource).toMatch(/html\[data-boot-active="true"\] #root\s*{[^}]*visibility:\s*hidden;/s);
    expect(indexSource).toMatch(/\.boot-window-drag-strip\s*{[^}]*left:\s*96px;[^}]*right:\s*0;[^}]*height:\s*32px;[^}]*pointer-events:\s*auto;/s);
    expect(indexSource).toMatch(/#boot-shell\[hidden\]\s*{[^}]*display:\s*none;/s);
    expect(indexSource).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*\.boot-loading__content\s*{[^}]*animation:\s*none;/s);
  });

  it("uses the requested boot spacing, mark size, and loading-copy size", () => {
    expect(indexSource).toMatch(/\.boot-loading__content\s*{[^}]*gap:\s*11\.4px;/s);
    expect(indexSource).toMatch(/\.boot-loading__mark\s*{[^}]*width:\s*51\.681px;[^}]*height:\s*51\.681px;/s);
    expect(indexSource).toMatch(/\.boot-loading\s*{[^}]*font-size:\s*17\.325px;/s);
  });

  it("keeps the boot shell out of companion windows", () => {
    const ruleStart = indexSource.indexOf('html[data-surface="watcher"] #boot-shell,');
    const declarationStart = indexSource.indexOf("{", ruleStart);
    const ruleEnd = indexSource.indexOf("}", declarationStart);
    const bootShellRule = ruleStart < 0 || declarationStart < 0 || ruleEnd < 0
      ? ""
      : indexSource.slice(ruleStart, ruleEnd + 1);

    expect(bootShellRule).toContain('html[data-surface="watcher"] #boot-shell');
    expect(bootShellRule).toContain('html[data-surface="companion"] #boot-shell');
    expect(bootShellRule).toContain('html[data-surface="drift-alarm"] #boot-shell');
    expect(bootShellRule).toContain('html[data-surface="pet-mode"] #boot-shell');
    expect(bootShellRule).toMatch(/\{\s*display:\s*none;/);
  });
});
