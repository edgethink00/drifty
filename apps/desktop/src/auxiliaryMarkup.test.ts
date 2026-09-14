import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("auxiliary window entry", () => {
  const auxiliarySource = readFileSync("auxiliary.html", "utf8");
  const auxiliaryRendererSource = readFileSync("src/auxiliary.tsx", "utf8");

  it("loads only the dedicated auxiliary renderer entry", () => {
    expect(auxiliarySource).toContain('src="/src/auxiliary.tsx"');
    expect(auxiliarySource).not.toContain('src="/src/main.tsx"');
    expect(auxiliarySource).not.toContain('id="boot-shell"');
  });

  it("installs the shared dark-palette and Dev-mode storage sync", () => {
    expect(auxiliaryRendererSource).toContain(
      'import { installDarkPalettePreviewStorageSync } from "./features/settings/darkPalettePreview";',
    );
    expect(auxiliaryRendererSource).toMatch(
      /installDarkPalettePreviewStorageSync\(\s*window,\s*document\.documentElement,\s*DEV_SETTINGS_ENABLED,\s*DEV_MODE_STORAGE_KEY,\s*\);/,
    );
  });
});
