// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");

type OpacityStop = { readonly at: number; readonly opacity: number };

function keyframeOpacityStops(name: string): OpacityStop[] {
  const block = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`missing @keyframes ${name}`);
  const stops: OpacityStop[] = [];
  for (const entry of block[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const opacity = entry[2].match(/opacity:\s*([\d.]+)/);
    if (!opacity) throw new Error(`keyframe entry in ${name} is missing opacity`);
    for (const selector of entry[1].split(",")) {
      stops.push({ at: Number(selector.trim().replace("%", "")), opacity: Number(opacity[1]) });
    }
  }
  return stops.sort((a, b) => a.at - b.at);
}

// Both handoffs animate with steps(1, end): between two stops the value holds
// the earlier stop until the boundary, then jumps. Model that hold-then-jump
// behavior when auditing the discrete swaps.
function steppedOpacityAt(stops: readonly OpacityStop[], at: number): number {
  let current = stops[0].opacity;
  for (const stop of stops) {
    if (stop.at <= at) current = stop.opacity;
  }
  return current;
}

describe("pet mode release crossfade", () => {
  // The release renders two stacked layers (held sprite above the rest pose)
  // inside a transparent native window. If both layers are translucent at the
  // same moment, the desktop shows through the cat's body and the drop reads
  // as a dark flicker. Guard the shipped CSS, since the keyframes are authored
  // by hand rather than generated from PET_MODE_DRAG_RELEASE_TIMELINE.
  it("keeps one release layer fully opaque at every moment of the drop", () => {
    const held = keyframeOpacityStops("pet-mode-release-held");
    const rest = keyframeOpacityStops("pet-mode-release-rest");
    const boundaries = [...held, ...rest].map((stop) => stop.at).sort((a, b) => a - b);
    for (const at of [...boundaries, ...boundaries.map((b) => Math.min(100, b + 0.005)), 25, 50, 75, 100]) {
      const composite = Math.max(steppedOpacityAt(held, at), steppedOpacityAt(rest, at));
      expect(composite, `composite silhouette floor at ${at}%`).toBe(1);
    }
  });

  // A partially transparent held frame is never safe even when the rest layer
  // is already opaque underneath it: the held contour is wider than the rest
  // pose, so its translucent overhang composites straight onto the desktop.
  // The swap must therefore be a discrete cut, not a linear crossfade.
  it("swaps layers with a discrete cut instead of a translucent crossfade", () => {
    expect(css).toContain("animation: pet-mode-release-held var(--pet-drag-release-duration) steps(1, end) both;");
    expect(css).toContain("animation: pet-mode-release-rest var(--pet-drag-release-duration) steps(1, end) both;");
    for (const name of ["pet-mode-release-held", "pet-mode-release-rest", "pet-mode-drag-rest-handoff", "pet-mode-drag-held-handoff"]) {
      for (const stop of keyframeOpacityStops(name)) {
        expect([0, 1], `${name} opacity stop at ${stop.at}%`).toContain(stop.opacity);
      }
    }
  });

  it("keeps one pickup layer fully opaque at every moment of the lift", () => {
    const rest = keyframeOpacityStops("pet-mode-drag-rest-handoff");
    const held = keyframeOpacityStops("pet-mode-drag-held-handoff");
    const boundaries = [...rest, ...held].map((stop) => stop.at).sort((a, b) => a - b);
    for (const at of [...boundaries, ...boundaries.map((b) => Math.min(100, b + 0.005)), 50, 75, 100]) {
      const composite = Math.max(steppedOpacityAt(held, at), steppedOpacityAt(rest, at));
      expect(composite, `composite silhouette floor at ${at}%`).toBe(1);
    }
  });

  it("still ends the crossfade on the rest pose alone", () => {
    const held = keyframeOpacityStops("pet-mode-release-held");
    const rest = keyframeOpacityStops("pet-mode-release-rest");
    expect(steppedOpacityAt(held, 100)).toBe(0);
    expect(steppedOpacityAt(rest, 100)).toBe(1);
    expect(steppedOpacityAt(rest, 0)).toBe(0);
  });
});
