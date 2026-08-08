// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");
const app = readFileSync("src/features/pet-mode/PetModeWindowApp.tsx", "utf8");

function ruleFor(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("pet mode hit target", () => {
  it("stops the full panel from acting as the grab area", () => {
    // The window is 144x99 but the cat only paints about a third of it. Left
    // as a full-panel button, empty corners dragged the pet.
    expect(ruleFor(".pet-mode-hit-target { pointer-events: none; }")).toContain("pointer-events: none");
  });

  it("clips the grab area to the cat silhouette", () => {
    const shape = ruleFor(".pet-mode-hit-shape {");
    expect(shape).toContain("pointer-events: auto");
    // `clip-path` is load-bearing here: a CSS mask hides pixels but still hit
    // tests its whole box, which would silently restore the original bug.
    expect(shape).toContain("clip-path: polygon(");
    expect(shape).not.toMatch(/^\s*mask:/m);
  });

  it("keeps the clip aligned with the rendered cat", () => {
    const shape = ruleFor(".pet-mode-hit-shape {");
    const cat = ruleFor(".pet-mode-cat {");
    for (const property of ["left", "top", "width", "height"]) {
      const inShape = new RegExp(`${property}: ([\\d.]+)px`).exec(shape);
      const inCat = new RegExp(`${property}: ([\\d.]+)px`).exec(cat);
      expect(inShape, `hit shape has no ${property}`).not.toBeNull();
      expect(inCat, `cat has no ${property}`).not.toBeNull();
      const shapeValue = Number(inShape![1]);
      const catValue = Number(inCat![1]);
      // The shape is inflated a few points so thin parts stay grabbable, but
      // it must stay anchored to the cat rather than drifting across the panel.
      expect(Math.abs(shapeValue - catValue)).toBeLessThanOrEqual(8);
    }
  });

  it("mirrors the clip when the cat faces left", () => {
    expect(app).toContain('facing === "left" ? " is-mirrored" : ""');
    expect(css).toContain(".pet-mode-hit-shape.is-mirrored { transform: scaleX(-1); }");
  });
});
