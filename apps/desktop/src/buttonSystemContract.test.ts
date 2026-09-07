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

  it("shares intent, typography, rounded-rectangle shape, and keyboard focus across app and modal actions", () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.app-btn\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/);
    expect(styles).toMatch(/\.app-btn\s*\{[^}]*font-family:\s*var\(--font-sans\);[^}]*font-size:\s*var\(--type-button-size\);/);
    expect(styles).toMatch(/\.app-btn--secondary\s*\{[\s\S]*background:\s*var\(--surface\);/);
    expect(styles).toMatch(/\.app-btn--primary\s*\{[\s\S]*background:\s*var\(--text\);/);
    expect(styles).toMatch(/\.app-btn--danger\s*\{[^}]*background:\s*var\(--button-danger-bg\);/);
    expect(styles).toMatch(/\.modal-btn--danger\s*\{[^}]*background:\s*var\(--button-danger-bg\);/);
    expect(styles).toMatch(/\.app-btn--header-action\s*\{[^}]*border-radius:\s*var\(--radius-pill\);/);
    expect(styles).toMatch(/\.app-btn:focus-visible\s*\{[\s\S]*outline:\s*2px solid/);
    expect(styles).toMatch(/\.modal-btn\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/);
    expect(styles).toMatch(/\.modal-btn\s*\{[^}]*font-size:\s*var\(--type-button-size\);/);
    expect(styles).toMatch(/\.modal-btn:focus-visible\s*\{[\s\S]*outline:\s*2px solid/);
    expect(styles).toMatch(/\.content--settings \.settings-btn\s*\{[^}]*cursor:\s*pointer;/);
    expect(styles).toMatch(/\.content--settings \.settings-btn\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/);
    expect(styles).toMatch(/\.content--settings \.settings-btn:disabled\s*\{[\s\S]*cursor:\s*not-allowed;/);
  });

  it("keeps compact date steps square while their labeled action stays content-sized", () => {
    const styles = readAppStyles();
    const dateNavigator = readFileSync(join(sourceRoot, "components/DateNavigator.tsx"), "utf8");

    expect(styles).toMatch(/\.app-btn--icon\s*\{[\s\S]*width:\s*var\(--btn-h\);[\s\S]*min-width:\s*var\(--btn-h\);[\s\S]*padding-inline:\s*0;/);
    expect(dateNavigator.match(/app-btn--icon day-nav__step/g)).toHaveLength(2);
    expect(dateNavigator).toContain("app-btn--compact day-nav__today");
  });

  it("keeps feature-owned text commands on the rounded-rectangle action shape", () => {
    const upgradeDecisionStyles = readFileSync(join(sourceRoot, "features/billing/UpgradeDecisionPanel.css"), "utf8");
    const sharedSurfaceStyles = readFileSync(join(sourceRoot, "styles/shared-surfaces.css"), "utf8");

    expect(upgradeDecisionStyles).toMatch(/\.upgrade-decision__primary\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/);
    expect(upgradeDecisionStyles).toMatch(/\.upgrade-decision__local-action\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/);
    expect(sharedSurfaceStyles).toMatch(/\.auth-modal__callback-dismiss\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/);
  });
});
