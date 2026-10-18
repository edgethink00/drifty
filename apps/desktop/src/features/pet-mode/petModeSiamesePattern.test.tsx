// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PetModeCat, type PetModeCatPhase } from "./PetModeCat";
import { PetModeCoatFilter } from "./PetModeCoatFilter";
import {
  PET_MODE_COATS,
  PET_MODE_COAT_STYLE_KEYS,
  createPetModeCustomCoat,
  getPetModeCoatSpec,
  getPetModeCoatStyle,
  type PetModeCoat,
} from "./petModeCoats";
import { PetModeVectorFur, petModePatternMaskKey, petModeWalkPatternKey } from "./PetModePattern";
import { PET_MODE_SIAMESE_FRAMES } from "./petModeSiameseFrames";
import { PET_MODE_RUN_FRAME_SOURCES } from "./petModeRunFrames";
import { PET_MODE_DANCE_FRAME_COUNT, PET_MODE_LIFE_MOTION_FRAME_COUNT } from "./petModeData";
import { PetCoatSwatchCat } from "../settings/PetCoatSwatchCat";
import { isProLook } from "../pro-looks/proLooks";

vi.mock("./petModeHitRegions", () => ({
  publishPetModeHitRegion: vi.fn().mockResolvedValue(undefined),
  stagePetModeHitRegionTransition: vi.fn().mockResolvedValue(undefined),
}));

const manifest = JSON.parse(readFileSync("public/pet-mode/siamese/manifest.json", "utf8"));
const walk = JSON.parse(readFileSync("public/pet-mode/walk-frames-v2.json", "utf8"));
const cat = readFileSync("src/features/pet-mode/PetModeCat.tsx", "utf8");
const frame = (dir: string, n: number) => `/pet-mode/${dir}/f${String(n).padStart(3, "0")}.png`;
const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
const markup = (coat: PetModeCoat, phase: PetModeCatPhase, pawFrame = 0) =>
  renderToStaticMarkup(createElement(PetModeCat, { coat, phase, facing: "right", pawFrame, publishHitRegion: false, decorative: true }));
const channelEnds = (block: string) => [...block.matchAll(/tableValues="([^"]+)"/g)].map(match => match[1].trim().split(/\s+/).map(Number));
const hex = (color: string) => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);

// Read the shipped grey+alpha PNGs, independently of the generator's face summary.
// Its PNG writer uses Up rows; checking actual alpha catches holes below the eyes.
function pointMask(key: string) {
  const png = readFileSync(`public/pet-mode/siamese/${key}-b.png`);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  expect([png[24], png[25]]).toEqual([8, 4]);
  const blocks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") blocks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(blocks)), pixels = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 2 + 1);
    expect(rows[row]).toBe(2);
    for (let x = 0; x < width * 2; x++) {
      const i = y * width * 2 + x;
      pixels[i] = (rows[row + 1 + x] + (y ? pixels[i - width * 2] : 0)) & 255;
    }
  }
  return (x: number, y: number) => pixels[(y * width + x) * 2 + 1] / 255;
}

describe("Siamese pattern skin", () => {
  it("is the reviewed Z16 Pro skin in its own Pattern family", () => {
    const spec = getPetModeCoatSpec("siamese");
    expect(PET_MODE_COATS[PET_MODE_COATS.length - 1]).toBe("siamese");
    expect(spec).toMatchObject({ fur: "#f2eadf", ink: "#eadfce", family: "pattern", pattern: { kind: "siamese", dark: "#503a31" } });
    expect(manifest.z16).toMatchObject({ dark: "#503a31", base: "#f2eadf", soft: 30, lo: 0.04, hi: 0.8 });
    expect(spec.pattern?.mid).toBe(manifest.mid);
    expect(isProLook({ kind: "coat", id: "siamese" })).toBe(true);
  });

  it("ships both point masks for every listed frame and keeps every face inside the dark point", () => {
    expect(Object.keys(manifest.frames).sort()).toEqual([...PET_MODE_SIAMESE_FRAMES]);
    for (const key of PET_MODE_SIAMESE_FRAMES) {
      expect(existsSync(`public/pet-mode/siamese/${key}-a.png`), key).toBe(true);
      expect(existsSync(`public/pet-mode/siamese/${key}-b.png`), key).toBe(true);
      // The generator measures the eyes and mouth; a face on cream would read as a missing face.
      expect(manifest.frames[key].faceDark, key).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("finds each pose's own legs, so running and reaching paws get their points too", () => {
    // Paws are coloured from each leg's tip, not from the ground line: a run frame with legs in
    // the air still has every visible leg, and a seated cat shows only its two front paws.
    for (const key of PET_MODE_SIAMESE_FRAMES.filter(name => name.startsWith("run/"))) expect(manifest.frames[key].limbs, key).toBe(4);
    for (const key of PET_MODE_SIAMESE_FRAMES.filter(name => name.startsWith("paw/") || name.startsWith("life-motion/"))) expect(manifest.frames[key].limbs, key).toBeGreaterThanOrEqual(3);
    expect(manifest.frames["sit-reference/d-lifted-tail-live"].limbs).toBe(2);
    expect(manifest.frames["vector/sleep"].limbs).toBe(0);
  });


  it("keeps the lower jaw dark when a running foreleg reaches underneath it", () => {
    // Interior chin landmarks read from each source pose, below the eye/mouth checks.
    // The old paw-lobe subtraction left holes here in frames 9–16.
    const chins = [[31,69],[31,69],[32,68],[31,69],[30,64],[29,64],[27,59],[27,59],
      [25,61],[25,61],[26,68],[26,68],[27,68],[28,68],[29,67],[29,67],[32,70]];
    chins.forEach(([x, y], index) => {
      const key = `run/f${String(index + 1).padStart(3, "0")}`, alpha = pointMask(key);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
        expect(alpha(x + dx, y + dy), `${key} chin at ${x + dx},${y + dy}`).toBeGreaterThanOrEqual(0.85);
      }
    });
  });

  it("keeps reaching and stretching chins covered without filling the gap to the raised paw", () => {
    const paw = pointMask("paw/f013"), stretch = pointMask("life-motion/stretch/f019");
    expect(paw(128, 51)).toBeGreaterThanOrEqual(0.85);
    expect(paw(140, 57)).toBeLessThanOrEqual(0.05);
    expect(paw(150, 54)).toBeGreaterThanOrEqual(0.85);
    expect(stretch(126, 87)).toBeGreaterThanOrEqual(0.85);
    expect(stretch(151, 106)).toBeGreaterThanOrEqual(0.85);
  });

  it("has masks for every frame the pet can show", () => {
    const sources = [
      ...range(17).map(n => frame("paw", n)),
      ...PET_MODE_RUN_FRAME_SOURCES,
      ...range(PET_MODE_LIFE_MOTION_FRAME_COUNT).flatMap(n => [frame("life-motion/stretch", n), frame("life-motion/tail", n)]),
      ...range(PET_MODE_DANCE_FRAME_COUNT).map(n => frame("dance", n)),
      "/pet-mode/gaze/idle-no-pupils.png",
      "/pet-mode/sit-reference/d-lifted-tail-live.png",
      "/pet-mode/sit-reference/d-lifted-tail-live-no-eyes.png",
    ];
    const drag = /DRAG_SCRUFF_ASSET = "([^"]+)"/.exec(cat)?.[1];
    expect(drag).toBeTruthy();
    for (const source of [...sources, drag!]) expect(petModePatternMaskKey(source), source).not.toBeNull();
    for (let index = 0; index < walk.frames.length; index++) expect(PET_MODE_SIAMESE_FRAMES).toContain(petModeWalkPatternKey(index));
    expect(PET_MODE_SIAMESE_FRAMES).toEqual(expect.arrayContaining(["vector/sit", "vector/sleep"]));
  });

  it("recolors fur, mid and dark layers from one luminance ramp each", () => {
    const filters = renderToStaticMarkup(createElement(PetModeCoatFilter, { coat: "siamese" }));
    const spec = getPetModeCoatSpec("siamese");
    for (const id of ["pet-mode-coat-siamese", "pet-mode-coat-siamese-mid", "pet-mode-coat-siamese-dark"]) expect(filters).toContain(`id="${id}"`);
    const [fur, mid, dark] = [0, 3, 6].map(start => channelEnds(filters).slice(start, start + 3));
    const ends = (tables: number[][], first: string, last: string) => tables.forEach((values, channel) => {
      expect(values[0]).toBeCloseTo(hex(first)[channel], 4);
      expect(values[values.length - 1]).toBeCloseTo(hex(last)[channel], 4);
    });
    ends(fur, spec.pattern!.furInk, spec.fur);
    ends(mid, spec.ink, spec.pattern!.mid);
    ends(dark, spec.ink, spec.pattern!.dark);
    expect(filters.match(/<feFuncA type="identity">/g)).toHaveLength(3);
  });

  it("stacks the masked point layers over the unchanged frame, and only for the pattern skin", () => {
    const siamese = markup("siamese", "paw", 4);
    const source = 'src="/pet-mode/paw/f005.png"';
    expect(siamese.split(source)).toHaveLength(4);
    expect(siamese).toContain('pet-mode-cat__raster pet-mode-cat__raster--paw pet-mode-cat__pattern pet-mode-cat__pattern--mid');
    expect(siamese).toContain('url(&quot;/pet-mode/siamese/paw/f005-a.png&quot;)');
    expect(siamese).toContain('url(&quot;/pet-mode/siamese/paw/f005-b.png&quot;)');
    const ivory = markup("ivory", "paw", 4);
    expect(ivory.split(source)).toHaveLength(2);
    expect(ivory).not.toContain("pet-mode-cat__pattern");
    expect(ivory).not.toContain("/pet-mode/siamese/");
  });

  it("masks the vector sleep pose with its own points", () => {
    const sleep = markup("siamese", "sleep");
    expect(sleep).toContain('href="/pet-mode/siamese/vector/sleep-b.png"');
    expect(sleep).toContain('fill="var(--pet-pattern-dark)"');
    expect(markup("ivory", "sleep")).not.toContain("--pet-pattern-dark");
  });

  it("draws vector point layers in the frame's coordinates", () => {
    const fur = renderToStaticMarkup(createElement("svg", null, createElement(PetModeVectorFur, { d: "M0 0H1V1Z", pattern: true, prefix: "p", maskKey: "walk/f010" })));
    expect(fur).toContain('mask="url(#p-walk-f010-a)"');
    expect(fur).toContain('mask="url(#p-walk-f010-b)"');
    const unknown = renderToStaticMarkup(createElement("svg", null, createElement(PetModeVectorFur, { d: "M0 0H1V1Z", pattern: true, prefix: "p", maskKey: "walk/f999" })));
    expect(unknown).not.toContain("mask=");
  });

  it("paints the face layers and the separated-expression erase with the point colours", () => {
    const style = getPetModeCoatStyle("siamese");
    expect(style["--pet-face-fill"]).toBe("#503a31");
    expect(style["--pet-eye-filter"]).toBe('url("#pet-mode-coat-siamese-dark")');
    expect(style["--pet-pattern-mid-filter"]).toBe('url("#pet-mode-coat-siamese-mid")');
    const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");
    expect(css).toContain("background: var(--pet-face-fill, var(--pet-fur));");
    expect(css.match(/filter: var\(--pet-eye-filter, var\(--pet-raster-filter\)\);/g)).toHaveLength(2);
  });

  it("lists every coat style key, so switching away clears the pattern", () => {
    for (const coat of [...PET_MODE_COATS, createPetModeCustomCoat(200, 60)]) {
      for (const key of Object.keys(getPetModeCoatStyle(coat))) expect(PET_MODE_COAT_STYLE_KEYS, key).toContain(key);
    }
  });

  it("shows the points on the skin swatch", () => {
    const swatch = renderToStaticMarkup(createElement(PetCoatSwatchCat, { coat: "siamese" }));
    expect(swatch.match(/pet-coat-swatch__pattern/g)).toHaveLength(2);
    expect(swatch).toContain("/pet-mode/siamese/paw/f001-b.png");
    expect(renderToStaticMarkup(createElement(PetCoatSwatchCat, { coat: "ivory" }))).not.toContain("pet-coat-swatch__pattern");
  });
});

