import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./post-onboarding-sidebar-guide.css", import.meta.url), "utf8");

describe("post-onboarding sidebar guide styles", () => {
  it("dims the four surrounding regions without blurring the user's day", () => {
    expect(styles).toContain('data-edge="top"');
    expect(styles).toContain('data-edge="bottom"');
    expect(styles).not.toMatch(/\.post-onboarding-sidebar-guide__scrim\s*\{[^}]*backdrop-filter/s);
    expect(styles).toMatch(/\.post-onboarding-sidebar-guide__scrim\s*\{[^}]*pointer-events: auto/s);
    expect(styles).not.toMatch(/\.post-onboarding-sidebar-guide__highlight\s*\{[^}]*backdrop-filter/s);
  });

  it("respects reduced motion and uses the existing app button system", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("background: var(--shell-floating-surface-strong)");
    expect(styles).toContain("border-top: 1px solid var(--line)");
    expect(styles).not.toContain("transition: all");
  });
});
