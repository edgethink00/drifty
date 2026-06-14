import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("AuthModal styles", () => {
  it("keeps the Google sign-in label readable on the light button surface", () => {
    const googleButtonRule = cssRule(".auth-modal__google");

    expect(googleButtonRule).toContain("background: var(--surface-strong);");
    expect(googleButtonRule).toContain("color: var(--text);");
    expect(googleButtonRule).not.toContain("color: var(--canvas);");
  });
});
