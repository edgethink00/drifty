import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("boot shell markup", () => {
  const indexSource = readFileSync("index.html", "utf8");

  it("renders the Drifty symbol with accessible and delayed visible loading copy", () => {
    const shellStart = indexSource.indexOf('<div id="boot-shell"');
    const shellEnd = indexSource.indexOf('<div id="boot-error"');
    const bootShell = indexSource.slice(shellStart, shellEnd);

    expect(bootShell).toContain('class="boot-loading__content"');
    expect(bootShell).toContain('class="boot-window-drag-strip" data-tauri-drag-region');
    expect(bootShell).toContain('src="/src/assets/drifty-mark.svg"');
    expect(bootShell).toContain('class="boot-loading__mark"');
    expect(bootShell).toContain('id="boot-status" class="boot-sr-only" role="status" aria-live="polite"');
    expect(bootShell).toContain("Loading Drifty&hellip;");
    expect(bootShell).toContain('id="boot-status-visible" class="boot-loading" aria-hidden="true"');
    expect(bootShell).toContain("drifty loading&hellip;");
    expect(indexSource).not.toContain("drifty still loading");
    expect(bootShell.indexOf("boot-loading__mark")).toBeLessThan(bootShell.indexOf("boot-status"));
    expect(indexSource).toContain('<div id="boot-error" class="boot-error" role="alert" aria-live="assertive"></div>');
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

  it("keeps every Windows startup and startup-error frame opaque", () => {
    expect(indexSource).toMatch(
      /html\[data-platform="windows"\]\[data-boot-active="true"\],\s*html\[data-platform="windows"\]\[data-boot-active="true"\] body\s*\{[^}]*background:\s*var\(--boot-canvas\);/s,
    );
    expect(indexSource).toMatch(
      /html\[data-platform="windows"\]\[data-boot-active="true"\] #boot-shell\s*\{[^}]*background:\s*var\(--boot-canvas\);[^}]*backdrop-filter:\s*none;/s,
    );
  });

  it("centers the enlarged mark and reveals smaller loading copy after 3.5 seconds", () => {
    expect(indexSource).toMatch(/\.boot-loading__content\s*\{[^}]*position:\s*relative;/s);
    expect(indexSource).toMatch(/\.boot-loading__mark\s*\{[^}]*width:\s*56\.8491px;[^}]*height:\s*56\.8491px;/s);
    expect(indexSource).toMatch(/\.boot-loading\s*\{[^}]*position:\s*absolute;[^}]*top:\s*calc\(100% \+ 11\.4px\);[^}]*font-size:\s*15\.5925px;[^}]*animation:\s*boot-status-reveal 220ms ease-out 3\.5s both;/s);
    expect(indexSource).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.boot-loading__content\s*\{[^}]*animation:\s*none;[^}]*\}[^}]*\.boot-loading\s*\{[^}]*animation-duration:\s*1ms;/s);
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
    expect(bootShellRule).toContain('html[data-surface="pet-mode"] #boot-shell');
    expect(bootShellRule).toMatch(/\{\s*display:\s*none;/);
  });
});
