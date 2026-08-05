import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("auxiliary window entry", () => {
  const auxiliarySource = readFileSync("auxiliary.html", "utf8");

  it("loads only the dedicated auxiliary renderer entry", () => {
    expect(auxiliarySource).toContain('src="/src/auxiliary.tsx"');
    expect(auxiliarySource).not.toContain('src="/src/main.tsx"');
    expect(auxiliarySource).not.toContain('id="boot-shell"');
  });
});
