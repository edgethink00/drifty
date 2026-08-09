import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tauriConfig = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../src-tauri/tauri.conf.json", import.meta.url)),
  "utf8",
)) as { app?: { security?: { csp?: string; devCsp?: string } } };

/**
 * Reads one directive's source list out of a CSP string.
 *
 * The directives are compared as parsed token lists rather than with
 * `toContain` on the raw policy: a substring check passes when the token
 * merely appears somewhere else in the policy (`'self'` is present in
 * `default-src`, `script-src`, `base-uri` and `form-action` regardless of
 * whether `connect-src` allows it), which is exactly the mistake that let the
 * pet gait regression ship.
 *
 * Directive names are matched case-insensitively and split on any run of
 * whitespace, because CSP treats both that way and a hand-edited policy in
 * JSON can legitimately contain either.
 */
function directiveSources(policy: string, directive: string): readonly string[] {
  const entries = policy
    .split(";")
    .map((entry) => entry.trim().split(/\s+/).filter((token) => token.length > 0))
    .filter((tokens) => tokens.length > 0);
  const found = entries.find((tokens) => tokens[0].toLowerCase() === directive.toLowerCase());
  return found === undefined ? [] : found.slice(1);
}

const SRC_ROOT = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = `${directory}/${entry}`;
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

/**
 * Every root-relative `fetch(...)` target in the webview sources.
 *
 * Covers `"…"`, `'…'` and `` `…` `` because the directive they depend on is the
 * same regardless of quoting, and a scanner that only understood double
 * quotes would quietly stop guarding the moment someone reformatted the call.
 */
function rootRelativeFetchTargets(): readonly string[] {
  const pattern = /fetch\(\s*(["'`])(\/[^"'`]*)\1/g;
  return sourceFiles(SRC_ROOT.replace(/\/$/, ""))
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(pattern)].map((match) => match[2]));
}

describe("Tauri image content security policy", () => {
  it("allows the approved leaderboard image host in development and packaged builds", () => {
    expect(tauriConfig.app?.security?.csp).toContain("https://images.unsplash.com");
    expect(tauriConfig.app?.security?.devCsp).toContain("https://images.unsplash.com");
  });
});

describe("Tauri connect content security policy", () => {
  // `connect-src` overrides `default-src` rather than inheriting from it, so a
  // policy that declares `connect-src` without `'self'` blocks the app from
  // fetching its own bundled assets. In a packaged build that silently broke
  // the pet's walk/run gait: `/pet-mode/walk-frames-v2.json` was refused, the
  // frame list stayed empty, and the cat rendered as one standing frame.
  // `devCsp` hid it because `http://127.0.0.1:1420` covers the dev server.
  it.each(["csp", "devCsp"] as const)("lets %s reach same-origin bundled assets", (key) => {
    const policy = tauriConfig.app?.security?.[key];
    expect(policy).toBeTypeOf("string");
    expect(directiveSources(policy as string, "connect-src")).toContain("'self'");
  });

  it("keeps ipc reachable so native commands still work", () => {
    for (const key of ["csp", "devCsp"] as const) {
      const sources = directiveSources(tauriConfig.app?.security?.[key] as string, "connect-src");
      expect(sources).toContain("ipc:");
      expect(sources).toContain("http://ipc.localhost");
    }
  });

  it("covers every same-origin fetch the app performs", () => {
    // Guards the general shape of the regression rather than the one asset:
    // any root-relative fetch added later is also same-origin and would be
    // refused by a `connect-src` that omits `'self'`.
    const rootRelativeFetches = rootRelativeFetchTargets();

    // Asserted so this test fails loudly if the scanner stops matching the
    // gait fetch (moved, renamed, or reformatted) instead of silently
    // degrading into a test that scans nothing and always passes.
    expect(rootRelativeFetches).toContain("/pet-mode/walk-frames-v2.json");

    for (const key of ["csp", "devCsp"] as const) {
      const sources = directiveSources(tauriConfig.app?.security?.[key] as string, "connect-src");
      expect(sources, `${key} must allow ${rootRelativeFetches.join(", ")}`).toContain("'self'");
    }
  });
});
