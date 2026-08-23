import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppStyles } from "./test/readStyles";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

function productionTsxFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

function sourceRelativePath(path: string): string {
  return relative(sourceRoot, path).split("\\").join("/");
}

const RETIRED_APP_BUTTON_ALIASES = new Set(["secondary-button", "ghost-button"]);

function retiredAppButtonAliases(source: string): string[] {
  return [...source.matchAll(/["'`]([^"'`]*(?:secondary-button|ghost-button)[^"'`]*)["'`]/g)]
    .flatMap((match) => match[1].split(/\s+/))
    .filter((token) => RETIRED_APP_BUTTON_ALIASES.has(token));
}

describe("app button system contract", () => {
  it("recognizes a retired alias even when it is the first class token", () => {
    expect(retiredAppButtonAliases('className="ghost-button day-nav__step"')).toEqual(["ghost-button"]);
    expect(retiredAppButtonAliases('className="day-nav__step secondary-button"')).toEqual(["secondary-button"]);
  });

  it("keeps retired app-wide button aliases out of production markup", () => {
    const violations = productionTsxFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return retiredAppButtonAliases(source).map((alias) => `${sourceRelativePath(path)}: ${alias}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps Settings button classes inside Settings-owned surfaces", () => {
    const allowedPrefixes = [
      "features/settings/",
    ];
    // These extracted components mount only inside Settings-owned panels.
    const allowedFiles = [
      "features/cloud-devices/CloudDeviceManagementPanel.tsx",
      "features/companion/CompanionPanel.tsx",
      "features/companion/DriftAlarmCopySettings.tsx",
    ];
    const violations = productionTsxFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const localPath = sourceRelativePath(path);
      const usesSettingsButton = /settings-btn/.test(source);
      return usesSettingsButton
        && !allowedPrefixes.some((prefix) => localPath.startsWith(prefix))
        && !allowedFiles.includes(localPath)
        ? [localPath]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("gives every app action an explicit intent", () => {
    const violations = productionTsxFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const localPath = sourceRelativePath(path);
      const classValues = [...source.matchAll(/["'`]([^"'`]*app-btn[^"'`]*)["'`]/g)]
        .map((match) => match[1])
        .filter((value) => value.split(/\s+/).some((token) => token === "app-btn" || token.startsWith("app-btn--")));
      return classValues.flatMap((value) => {
        const tokens = value.split(/\s+/);
        const intents = tokens.filter((token) => /^app-btn--(?:primary|secondary|danger|quiet)$/.test(token));
        return tokens.includes("app-btn") && intents.length === 1 ? [] : [`${localPath}: ${value}`];
      });
    });

    expect(violations).toEqual([]);
  });

  it("loads the shared contract after feature styles so legacy typography cannot win by order", () => {
    const entryStyles = readFileSync(join(sourceRoot, "styles.css"), "utf8").trim();

    expect(entryStyles).toMatch(/@import "\.\/styles\/app-buttons\.css";$/);
  });

  it("keeps modal component actions on the modal button contract", () => {
    const violations = productionTsxFiles().flatMap((path) => {
      if (!path.endsWith("Modal.tsx")) return [];
      const source = readFileSync(path, "utf8");
      return /\bapp-btn\b/.test(source) ? [sourceRelativePath(path)] : [];
    });

    expect(violations).toEqual([]);
  });

  it("shares intent, typography, shape, and keyboard focus across app and modal actions", () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.app-btn\s*\{[\s\S]*font-family:\s*var\(--font-sans\);[\s\S]*font-size:\s*var\(--type-button-size\);[\s\S]*border-radius:\s*var\(--radius-pill\);/);
    expect(styles).toMatch(/\.app-btn--secondary\s*\{[\s\S]*background:\s*var\(--surface\);/);
    expect(styles).toMatch(/\.app-btn--primary\s*\{[\s\S]*background:\s*var\(--text\);/);
    expect(styles).toMatch(/\.app-btn--danger\s*\{[\s\S]*background:\s*var\(--warn\);/);
    expect(styles).toMatch(/\.app-btn:focus-visible\s*\{[\s\S]*outline:\s*2px solid/);
    expect(styles).toMatch(/\.modal-btn\s*\{[\s\S]*font-size:\s*var\(--type-button-size\);[\s\S]*border-radius:\s*var\(--radius-pill\);/);
    expect(styles).toMatch(/\.modal-btn:focus-visible\s*\{[\s\S]*outline:\s*2px solid/);
    expect(styles).toMatch(/\.content--settings \.settings-btn\s*\{[\s\S]*cursor:\s*pointer;/);
    expect(styles).toMatch(/\.content--settings \.settings-btn:disabled\s*\{[\s\S]*cursor:\s*not-allowed;/);
  });
});
