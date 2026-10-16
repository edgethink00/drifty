/**
 * Accent tone per theme.
 *
 * The built-in moss accent ships a lighter dark-theme value (#5f7f31 in light,
 * #9bbf5a in dark). A user-picked accent used to keep its light value in dark
 * mode, so deep picks such as charcoal or wine all but disappeared on the dark
 * surface. darkAccentTone applies the same step moss takes: raise OKLCH
 * lightness to at least 0.76 and its chroma by a fifth, keeping the hue.
 */

const DARK_MIN_LIGHTNESS = 0.76;
const DARK_CHROMA_SCALE = 1.2;

type Oklab = readonly [number, number, number];

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055);
}

function linearChannels(hex: string): readonly [number, number, number] {
  const value = hex.trim().replace("#", "");
  return [toLinear(Number.parseInt(value.slice(0, 2), 16)), toLinear(Number.parseInt(value.slice(2, 4), 16)), toLinear(Number.parseInt(value.slice(4, 6), 16))];
}

function hexToOklab(hex: string): Oklab {
  const [r, g, b] = linearChannels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([lightness, a, b]: Oklab): readonly [number, number, number] {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function toHex(channels: readonly number[]): string {
  return "#" + channels.map((channel) => Math.round(fromLinear(channel)).toString(16).padStart(2, "0")).join("");
}

/** The accent shown on the dark surface for an accent picked in light terms. */
export function darkAccentTone(hex: string): string {
  const [lightness, a, b] = hexToOklab(hex);
  const hue = Math.atan2(b, a);
  const targetLightness = Math.max(lightness, DARK_MIN_LIGHTNESS);
  // Lower chroma until the color fits in sRGB, so the hue never shifts.
  for (let chroma = Math.hypot(a, b) * DARK_CHROMA_SCALE; chroma > 0; chroma -= 0.002) {
    const linear = oklabToLinear([targetLightness, chroma * Math.cos(hue), chroma * Math.sin(hue)]);
    if (linear.every((channel) => channel >= -0.0005 && channel <= 1.0005)) return toHex(linear);
  }
  return toHex(oklabToLinear([targetLightness, 0, 0]));
}

/** WCAG contrast ratio between two #rrggbb colors. */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = linearChannels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
