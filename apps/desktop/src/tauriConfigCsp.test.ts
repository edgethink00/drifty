import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tauriConfig = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../src-tauri/tauri.conf.json", import.meta.url)),
  "utf8",
)) as { app?: { security?: { csp?: string; devCsp?: string } } };

describe("Tauri image content security policy", () => {
  it("allows the approved leaderboard image host in development and packaged builds", () => {
    expect(tauriConfig.app?.security?.csp).toContain("https://images.unsplash.com");
    expect(tauriConfig.app?.security?.devCsp).toContain("https://images.unsplash.com");
  });
});
