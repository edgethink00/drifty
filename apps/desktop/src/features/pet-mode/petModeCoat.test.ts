// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_MODE_COATS,
  PET_MODE_COAT_STORAGE_KEY,
  PET_MODE_COAT_SPECS,
  PET_MODE_DEFAULT_COAT,
  getPetModeCoatSpec,
  isPetModeCoat,
  resolveInitialPetModeCoat,
} from "./petModeData";

const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");
const cat = readFileSync("src/features/pet-mode/PetModeCat.tsx", "utf8");

describe("pet mode coat selection", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to the shipped ivory coat", () => {
    expect(PET_MODE_DEFAULT_COAT).toBe("ivory");
    expect(resolveInitialPetModeCoat()).toBe("ivory");
  });

  it("restores a stored coat and rejects unknown values", () => {
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "charcoal");
    expect(resolveInitialPetModeCoat()).toBe("charcoal");
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "tabby");
    expect(resolveInitialPetModeCoat()).toBe("ivory");
    expect(isPetModeCoat("charcoal")).toBe(true);
    expect(isPetModeCoat("tabby")).toBe(false);
  });

  it("offers the six shipped coats with ivory first", () => {
    expect([...PET_MODE_COATS]).toEqual(["ivory", "charcoal", "grey", "apricot", "sage", "plum"]);
    expect(PET_MODE_COATS[0]).toBe(PET_MODE_DEFAULT_COAT);
  });

  it("keeps the picker to a single row", () => {
    // The row-based layout is sized for six chips. Adding a seventh needs a
    // deliberate layout decision rather than silently shrinking every chip.
    expect(PET_MODE_COATS.length).toBeLessThanOrEqual(6);
  });

  it("specifies every coat exactly once, in the same order", () => {
    expect(PET_MODE_COAT_SPECS.map((spec) => spec.value)).toEqual([...PET_MODE_COATS]);
    for (const spec of PET_MODE_COAT_SPECS) {
      expect(getPetModeCoatSpec(spec.value)).toBe(spec);
    }
  });

  it("keeps every Settings swatch color identical to that coat's CSS tokens", () => {
    // The picker paints its preview from these values while the pet paints
    // from the CSS custom properties. If the two drift, Settings advertises a
    // color the pet will not actually wear.
    for (const spec of PET_MODE_COAT_SPECS) {
      const selector = spec.value === PET_MODE_DEFAULT_COAT
        ? ':root[data-surface="pet-mode"] {'
        : `[data-pet-coat="${spec.value}"]`;
      const start = css.indexOf(selector);
      expect(start, `${spec.value} has no CSS block`).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      expect(block, `${spec.value} fur drifted`).toContain(`--pet-fur: ${spec.fur};`);
      expect(block, `${spec.value} ink drifted`).toContain(`--pet-ink: ${spec.ink};`);
    }
  });
});

describe("pet mode coat rendering contract", () => {
  it("puts the default coat through the same ramp as the rest", () => {
    // Ivory used to pass the bitmaps through untouched, which let the source
    // frames' slightly different creams show as four tones across the poses.
    expect(css).toContain('--pet-raster-filter: url("#pet-mode-coat-ivory");');
    expect(css).toContain('--pet-drag-raster-filter: url("#pet-mode-coat-ivory");');
    // The scruff-b clamp only existed to reconcile that one frame by hand; the
    // ramp now does it for every frame, so the clamp must not linger.
    expect(cat).not.toContain("pet-mode-scruff-b-color-match");
  });

  it("inverts fur and ink to the prototype's charcoal pair", () => {
    const charcoal = css.slice(css.indexOf('[data-pet-coat="charcoal"]'));
    expect(charcoal).toContain("--pet-fur: #33332f;");
    expect(charcoal).toContain("--pet-ink: #f2f1ed;");
  });

  it("gives every non-default coat its own filter and grounding cues", () => {
    // Each coat must override all four, otherwise it inherits ivory's tone or
    // ivory's shadow treatment and reads as a half-applied theme.
    for (const coat of PET_MODE_COATS.filter((value) => value !== PET_MODE_DEFAULT_COAT)) {
      const start = css.indexOf(`[data-pet-coat="${coat}"]`);
      expect(start, `${coat} has no CSS block`).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      for (const token of ["--pet-fur", "--pet-ink", "--pet-raster-filter", "--pet-drag-raster-filter", "--pet-contact-shadow", "--pet-drop-shadow"]) {
        expect(block, `${coat} is missing ${token}`).toContain(token);
      }
      expect(cat, `${coat} has no filter definition`).toContain(`id="pet-mode-coat-${coat}"`);
    }
  });

  it("routes every raster through the coat filter variable", () => {
    // A frame that renders its bitmap without this filter would show the ivory
    // source mid-animation, which is the exact flash this feature must avoid.
    expect(css).toContain(".pet-mode-cat__raster { filter: var(--pet-raster-filter); }");
    expect(css).toContain("filter: var(--pet-drag-raster-filter);");
  });

  it("keeps live D on the same coat and grounding pipeline as standing", () => {
    // The exact-reference Dev option may stay source-locked, but the live D
    // must not special-case ivory: doing so made sit lose the shared ink ramp,
    // drop shadow, and breathing only in the default coat.
    expect(css).not.toContain('[data-pet-coat="ivory"] .pet-mode-cat.is-d-live-neutral');
    expect(css).not.toContain(".pet-mode-cat.is-d-live-neutral {");
    expect(css).toContain(".pet-mode-cat__raster.pet-mode-cat__sit-live {");
    expect(css).toContain(".pet-mode-cat__d-live-eyes-art {");
  });

  it("saturates every coat ramp so rasters match that coat's vector fur exactly", () => {
    // A ramp's final table entries must equal its own `--pet-fur`. If they
    // drift, baked frames and the walk/sleep vectors render as two different
    // colors, which reads as the cat changing color mid-animation.
    for (const coat of PET_MODE_COATS) {
      // Ivory declares its tokens on the base surface rule; the others each
      // add a `[data-pet-coat]` override.
      const cssStart = coat === PET_MODE_DEFAULT_COAT
        ? css.indexOf(':root[data-surface="pet-mode"] {')
        : css.indexOf(`[data-pet-coat="${coat}"]`);
      const fur = /--pet-fur:\s*#([0-9a-f]{6})/i.exec(css.slice(cssStart, css.indexOf("}", cssStart)));
      expect(fur, `${coat} declares no --pet-fur`).not.toBeNull();
      const furChannels = [0, 2, 4].map((offset) => parseInt(fur![1].slice(offset, offset + 2), 16) / 255);

      const start = cat.indexOf(`id="pet-mode-coat-${coat}"`);
      const block = cat.slice(start, cat.indexOf("</filter>", start));
      const channels = [...block.matchAll(/tableValues="([^"]+)"/g)]
        .map((match) => match[1].trim().split(/\s+/).map(Number));
      expect(channels, `${coat} needs one table per channel`).toHaveLength(3);
      channels.forEach((values, index) => {
        expect(values[values.length - 1]).toBeCloseTo(furChannels[index], 4);
        // A flat tail guarantees the whole body luminance range collapses onto
        // the fur color rather than continuing past it.
        expect(values[values.length - 2]).toBeCloseTo(furChannels[index], 4);
      });
    }
  });

  it("flattens luminance before every coat ramp", () => {
    // Without this, per-channel drift in the generated frames survives the
    // recolor and the pet visibly changes tone between phases.
    for (const coat of PET_MODE_COATS) {
      const start = cat.indexOf(`id="pet-mode-coat-${coat}"`);
      const block = cat.slice(start, cat.indexOf("</filter>", start));
      expect(block, `${coat} does not flatten luminance`).toContain("feColorMatrix");
      expect(block.indexOf("feColorMatrix")).toBeLessThan(block.indexOf("feComponentTransfer"));
    }
  });

  it("binds the walk and run eyes to the ink token", () => {
    // These eyes previously relied on SVG's default black fill, which left
    // black eyes on a charcoal coat.
    const walkFace = cat.slice(cat.indexOf('cx="120.4"'), cat.indexOf('cx="140.3"') + 200);
    expect(walkFace).toContain('cx="120.4" cy="46.2" r="2.2" fill="currentColor"');
    expect(walkFace).toContain('cx="140.3" cy="46.2" r="2.2" fill="currentColor"');
  });

  it("keeps alpha untouched so silhouettes and edges survive the recolor", () => {
    for (const coat of PET_MODE_COATS) {
      const start = cat.indexOf(`id="pet-mode-coat-${coat}"`);
      const block = cat.slice(start, cat.indexOf("</filter>", start));
      expect(block, `${coat} alters alpha`).toContain('<feFuncA type="identity" />');
    }
  });

  it("never swaps asset paths per coat", () => {
    // Coat state must not reach any `src`. Recoloring in the compositor is what
    // lets a coat change mid-walk avoid a decode flash.
    const assetReferences = cat.match(/\/pet-mode\/[^"`]+/g) ?? [];
    expect(assetReferences.length).toBeGreaterThan(0);
    for (const reference of assetReferences) {
      expect(reference).not.toMatch(/charcoal|ivory|coat/);
    }
  });
});
