// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PetModeCat } from "./PetModeCat";
import { PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS } from "./petModeData";

const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");

afterEach(cleanup);

describe("pet anger motion", () => {
  it("uses a matched pair of short, low-set eyelids for the sleeping drift cue and moves the orange mark toward the forehead", () => {
    render(
      <PetModeCat
        phase="sleep"
        facing="right"
        pawFrame={0}
        driftCue="sleep-notice"
        sleepDriftExpression
        publishHitRegion={false}
        decorative
      />,
    );

    const squint = document.querySelector(".pet-mode-cat__sleep-eyes--squint");
    expect(squint?.querySelectorAll("path")).toHaveLength(2);
    expect(squint?.querySelector("path")?.getAttribute("d")).toBe("M84.8 91.7 Q88.2 94.1 91.4 93.4");
    expect(squint?.querySelectorAll("path")[1]?.getAttribute("d")).toBe("M114.6 93.4 Q117.8 94.1 121.2 91.7");
    expect([...squint?.querySelectorAll("path") ?? []].every((eye) => eye.getAttribute("stroke-linecap") === "round")).toBe(true);
    expect(document.querySelector(".pet-mode-cat__sleep-eye--peek")).toBeNull();
    expect(document.querySelector(".pet-mode-cat")?.classList.contains("has-sleep-drift-expression")).toBe(true);

    const cueRules = css.slice(
      css.indexOf(".pet-mode-cat.has-sleep-drift-cue.pet-mode-cat--sleep"),
      css.indexOf("/* Sitting is a long-held pose"),
    );
    // The shared body envelope owns the shadow; the sleep cue keeps its
    // unfiltered mark outside that group rather than filtering the small pose.
    const bodyEffects = css.slice(css.indexOf(".pet-mode-cat__body-effects {"), css.indexOf(".pet-mode-cat__body-register {"));
    expect(bodyEffects).toContain("filter: var(--pet-drop-shadow)");
    expect(cueRules).not.toContain("filter: var(--pet-drop-shadow)");
    expect(cueRules).toContain("fill: #ff9f0a");
    expect(cueRules).toContain("filter: none");
    expect(cueRules).toContain("transform: translate(-4px, 4px) scale(.92)");
    expect(cueRules).toContain(".pet-mode-cat.has-sleep-drift-expression .pet-mode-cat__sleep-eyes--squint");
    // The normal sleeping Z is suppressed; body, orange mark, and glyph stay static.
    expect(cueRules.match(/animation: none/g)).toHaveLength(4);
    expect(css).not.toContain("pet-mode-sleep-drift-shake");
    expect(css).not.toContain("pet-mode-sleep-drift-presence");
  });

  it("can render the sleeping squint independently from the orange mark", () => {
    render(
      <PetModeCat
        phase="sleep"
        facing="right"
        pawFrame={0}
        driftCue="none"
        sleepDriftExpression
        publishHitRegion={false}
        decorative
      />,
    );

    const cat = document.querySelector(".pet-mode-cat");
    const squint = cat?.querySelector(".pet-mode-cat__sleep-eyes--squint");
    expect(cat?.classList.contains("has-sleep-drift-expression")).toBe(true);
    expect(cat?.classList.contains("has-sleep-drift-cue")).toBe(false);
    expect(squint?.querySelectorAll("path")).toHaveLength(2);
  });

  it("keeps the one-shot mark timeline synchronized with the anger phase", () => {
    render(
      <PetModeCat
        phase="anger"
        facing="right"
        pawFrame={0}
        publishHitRegion={false}
        decorative
      />,
    );

    expect(document.querySelector(".pet-mode-cat__anger")).not.toBeNull();
    expect(document.querySelector(".pet-mode-cat__anger-glyph")).not.toBeNull();
    expect(document.querySelector<HTMLElement>(".pet-mode-cat")?.style.getPropertyValue("--pet-anger-duration"))
      .toBe(`${PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS}ms`);
    expect(PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS).toBe(1_350);
  });

  it("cracks outward from the temple anchor instead of orbiting around its center", () => {
    const motionRules = css.slice(
      css.indexOf(".pet-mode-cat--anger .pet-mode-cat__anger"),
      css.indexOf("@keyframes pet-mode-alert"),
    );

    expect(motionRules).toContain("animation: pet-mode-anger-presence var(--pet-anger-duration) linear both");
    expect(motionRules).toContain("animation: pet-mode-anger-crack var(--pet-anger-duration) linear both");
    expect(motionRules).toContain("transform-origin: 14% 88%");
    expect(motionRules).toContain("clip-path: circle(0% at 14% 88%)");
    expect(motionRules).toContain("clip-path: circle(160% at 14% 88%)");
    expect(motionRules).toContain("2.67%, 85.78%");
    expect(motionRules).toContain("8%");
    expect(motionRules).toContain("14.22%");
    expect(motionRules).toContain("25.78%, 100%");
    expect(motionRules).not.toContain("infinite");
    expect(motionRules).not.toContain("rotate(");
    expect(motionRules).not.toMatch(/translate(?:X|Y)?\(/);
  });
});
