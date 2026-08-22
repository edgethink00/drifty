// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PetModeCat } from "./PetModeCat";

vi.mock("./petModeHitRegions", () => ({
  preloadPetModeHitRegions: vi.fn().mockResolvedValue(undefined),
  publishPetModeHitRegion: vi.fn().mockResolvedValue(undefined),
  stagePetModeHitRegionTransition: vi.fn().mockResolvedValue(undefined),
}));

const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");
const cat = readFileSync("src/features/pet-mode/PetModeCat.tsx", "utf8");

describe("idle gaze pupils", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the idle pupil layers mounted at rest so sockets never flash empty", () => {
    const { container } = render(<PetModeCat phase="idle" facing="right" pawFrame={0} />);
    expect(container.querySelector('img[src="/pet-mode/gaze/idle-no-pupils.png"]')).not.toBeNull();
    expect(container.querySelectorAll(".pet-mode-cat__pupil")).toHaveLength(2);
    expect(container.querySelector(".pet-mode-cat__idle-pupils")).not.toBeNull();
    expect(container.querySelector('img[src="/pet-mode/paw/f001.png"]')).toBeNull();
  });

  it("reuses the same idle pupil layers when looking nearby", () => {
    const { container } = render(
      <PetModeCat phase="idle" facing="right" pawFrame={0} gazeOffset={{ x: 1.2, y: -0.4 }} />,
    );
    expect(container.querySelector(".pet-mode-cat__idle-pupils")).not.toBeNull();
    expect(container.querySelectorAll(".pet-mode-cat__pupil")).toHaveLength(2);
    const catNode = container.querySelector(".pet-mode-cat") as HTMLElement;
    expect(catNode.style.getPropertyValue("--pet-gaze-x")).toBe("1.20px");
    expect(catNode.style.getPropertyValue("--pet-gaze-y")).toBe("-0.40px");
  });

  it("does not gate the idle pupil sprite on a non-zero offset", () => {
    expect(cat).toContain('const usesIdleGaze = (phase === "idle" || phase === "blink" || phase === "happy")');
    expect(cat).toContain("&& !holdsRenderedEntryVector;");
    expect(cat).not.toMatch(/usesIdleGaze = phase === "idle"\s*&& !holdsRenderedEntryVector\s*&& \(gazeOffset\.x !== 0 \|\| gazeOffset\.y !== 0\)/);
  });

  it("places pupils on the contained 797×581 rect instead of resetting inset", () => {
    expect(css).toContain(".pet-mode-cat__idle-pupils");
    expect(css).toContain("121.2px * 581 / 797");
    const left = css.slice(css.indexOf(".pet-mode-cat__pupil--left {"), css.indexOf(".pet-mode-cat__pupil--right {"));
    const right = css.slice(css.indexOf(".pet-mode-cat__pupil--right {"), css.indexOf(".pet-mode-cat--blink .pet-mode-cat__idle-pupils"));
    expect(left).not.toContain("inset:");
    expect(right).not.toContain("inset:");
  });
});
