import { memo, useEffect, type CSSProperties } from "react";
import { getPetModeCoatSpec, type PetModeCoat } from "./petModeCoats";
import { createPetModeImageHold } from "./petModeImageHold";
import { PET_MODE_SIAMESE_FRAMES } from "./petModeSiameseFrames";

/*
 * Pattern skins (Siamese) keep the coat contract: every frame still renders
 * its own unchanged bitmap or path through the coat filter, so a skin change
 * never swaps a frame source. A pattern adds two copies of that same frame on
 * top - recolored to the mid and dark point tones - masked with that frame's
 * generated point masks. The masks are tiny, decoded up front and held for the
 * window's lifetime, and keyed by the frame, so a frame change swaps the mask
 * with the frame.
 */

const MASK_ROOT = "/pet-mode/siamese/";
const FRAMES = new Set(PET_MODE_SIAMESE_FRAMES);

export function petModeHasPattern(coat: PetModeCoat): boolean {
  return Boolean(getPetModeCoatSpec(coat).pattern);
}

/** "/pet-mode/paw/f001.png?v=1" -> "paw/f001" when that frame has point masks. */
export function petModePatternMaskKey(src: string): string | null {
  const key = src.replace(/^\/pet-mode\//, "").replace(/[?#].*$/, "").replace(/\.png$/, "");
  return FRAMES.has(key) ? key : null;
}

export function petModePatternMaskSources(key: string): readonly [string, string] {
  return [`${MASK_ROOT}${key}-a.png`, `${MASK_ROOT}${key}-b.png`];
}

/** Vector frames draw their points through an SVG `<mask><image>`; raster frames through CSS `mask-image`. */
export function petModePatternMaskIsVector(key: string): boolean {
  return key.startsWith("walk/") || key.startsWith("vector/");
}

const heldMasks = createPetModeImageHold();
/**
 * Decode every point mask once per window while a pattern skin is shown, as
 * the frames themselves are, and keep them. Each mask is fetched the way its
 * layer fetches it: a raster layer's CSS mask-image cannot reuse a plain
 * no-cors preload, and would otherwise paint without its points until a fresh
 * fetch lands on every frame swap (see petModeImageHold).
 */
export function preloadPetModePatternMasks(): void {
  for (const key of PET_MODE_SIAMESE_FRAMES) {
    const mode = petModePatternMaskIsVector(key) ? "element" : "css-mask";
    for (const source of petModePatternMaskSources(key)) {
      void heldMasks.hold(source, mode).catch(() => undefined);
    }
  }
}

export function usePetModePatternPreload(active: boolean): void {
  useEffect(() => {
    if (active) preloadPetModePatternMasks();
  }, [active]);
}

const maskStyle = (source: string): CSSProperties => ({ WebkitMaskImage: `url("${source}")`, maskImage: `url("${source}")` });

/**
 * A pet raster. With a pattern skin the same bitmap is drawn twice more over
 * the fur copy, each recolored and masked; the copies share the frame's class
 * so placement, mirroring and animation stay identical.
 */
export function PetModeRaster({ className, src, style, pattern }: {
  readonly className: string;
  readonly src: string;
  readonly style?: CSSProperties;
  readonly pattern: boolean;
}) {
  const key = pattern ? petModePatternMaskKey(src) : null;
  const base = <img className={className} src={src} alt="" draggable={false} style={style} />;
  if (!key) return base;
  const [mid, dark] = petModePatternMaskSources(key);
  return (
    <>
      {base}
      <img className={`${className} pet-mode-cat__pattern pet-mode-cat__pattern--mid`} src={src} alt="" draggable={false} style={{ ...style, ...maskStyle(mid) }} aria-hidden="true" />
      <img className={`${className} pet-mode-cat__pattern pet-mode-cat__pattern--dark`} src={src} alt="" draggable={false} style={{ ...style, ...maskStyle(dark) }} aria-hidden="true" />
    </>
  );
}

const maskId = (prefix: string, key: string, layer: "a" | "b") => `${prefix}-${key.replace(/\W/g, "-")}-${layer}`;

/** SVG masks for vector frames (150 x 120 viewBox), rendered once so frame changes only swap a reference. */
export const PetModeVectorPatternMasks = memo(function PetModeVectorPatternMasks({ prefix, keys }: {
  readonly prefix: string;
  readonly keys: readonly string[];
}) {
  return (
    <>
      {keys.flatMap(key => (["a", "b"] as const).map((layer, index) => (
        <mask key={`${key}-${layer}`} id={maskId(prefix, key, layer)} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="150" height="120">
          <image href={petModePatternMaskSources(key)[index]} x="0" y="0" width="150" height="120" preserveAspectRatio="none" />
        </mask>
      )))}
    </>
  );
});

/** A vector fur path; with a pattern skin, the mid and dark point copies follow it in the same coordinates. */
export function PetModeVectorFur({ d, pattern, prefix, maskKey }: {
  readonly d: string | undefined;
  readonly pattern: boolean;
  readonly prefix: string;
  readonly maskKey: string | null;
}) {
  const base = <path d={d} fill="currentColor" />;
  if (!pattern || !maskKey || !FRAMES.has(maskKey)) return base;
  // One group, composited before any clip: the walk head copy is clipped at the
  // neck, and clipping each layer separately would leave an antialiased seam
  // where the cream base shows through the dark point. Opacity just under 1
  // makes every renderer composite the group first; it rounds to opaque.
  return (
    <g opacity={0.9999}>
      {base}
      <path d={d} fill="var(--pet-pattern-mid)" mask={`url(#${maskId(prefix, maskKey, "a")})`} />
      <path d={d} fill="var(--pet-pattern-dark)" mask={`url(#${maskId(prefix, maskKey, "b")})`} />
    </g>
  );
}

export const PET_MODE_WALK_PATTERN_KEYS = PET_MODE_SIAMESE_FRAMES.filter(key => key.startsWith("walk/"));
export function petModeWalkPatternKey(frame: number): string {
  return `walk/f${String(frame + 1).padStart(3, "0")}`;
}

