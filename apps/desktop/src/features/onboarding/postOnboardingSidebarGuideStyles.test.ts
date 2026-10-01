import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const styles = readFileSync(new URL("./post-onboarding-sidebar-guide.css", import.meta.url), "utf8");
describe("centered app intro styles", () => {
  it("centers a stable frame without menu-dependent geometry or movement", () => {
    expect(styles).toContain("place-items: center");
    expect(styles).toContain("height: 346px");
    expect(styles).not.toContain("--sidebar-guide-anchor");
    expect(styles).toContain("border-radius: var(--modal-radius-standard)");
    expect(styles).toContain("border-radius: calc(var(--modal-radius-standard) - var(--guide-stage-gap))");
    expect(styles).not.toContain("data-moving");
    expect(styles).not.toContain("data-edge");
  });
  it("supports reduced motion, small windows, themes and the app button system", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("max-height: calc(100dvh - 40px)");
    expect(styles).toContain(":root[data-theme=\"dark\"] .post-onboarding-sidebar-guide__visual");
    expect(styles).toContain("__actions .app-btn { --btn-h: var(--modal-action-height); border-radius: var(--modal-action-radius);");
    expect(styles).not.toContain("transition: all");
  });
});
