import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./post-onboarding-sidebar-guide.css", import.meta.url), "utf8");

describe("post-onboarding sidebar guide styles", () => {
  it("keeps the current section crisp while gently blurring the four surrounding regions", () => {
    expect(styles).toContain('data-edge="top"');
    expect(styles).toContain('data-edge="bottom"');
    expect(styles).toContain("backdrop-filter: blur(2px) saturate(0.76)");
    expect(styles).not.toMatch(/\.post-onboarding-sidebar-guide__highlight\s*\{[^}]*backdrop-filter/s);
  });

  it("respects reduced motion and uses the existing app button system", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("background: var(--shell-floating-surface-strong)");
    expect(styles).toContain("border-top: 1px solid var(--line)");
    expect(styles).not.toContain("transition: all");
  });
});
