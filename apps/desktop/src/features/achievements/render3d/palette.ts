import type { AchievementId } from "../achievementCatalog";

/** The enamel colour of each achievement's medal. */
export const BADGE_COLORS: Record<AchievementId, number> = {
  firstFlow: 0x74ad4c,
  flow90: 0x2fa39a,
  flow180: 0x3d7cc4,
  focusDay8h: 0xf0b13a,
  earlyStart: 0xf08a5d,
  nightOwl: 0x6b5bd6,
  weekendShift: 0xd8873a,
  streak7: 0xc65f9e,
  streak30: 0x9a5fd0,
  focus100h: 0xd9b36a,
  driftDay: 0xd2554a,
  noDriftDay: 0x8fd3e6,
  comeback: 0x3fae78,
};

/** The coin's metals: silver at first, rose gold from ten times. */
export const SILVER = 0xc4c8ce;
export const ROSE_GOLD = 0xe4a58e;

/**
 * The muted palette's enamel colour as a CSS hex, for things drawn in the
 * medal's colour outside three.js (progress bars). Matches medal.ts, which
 * works in three.js's linear colour space.
 */
export function mutedBadgeHex(id: AchievementId): string {
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const hex = BADGE_COLORS[id];
  const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => toLinear(v / 255)) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const delta = max - min;
    s = l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
    h = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h /= 6;
  }
  const s2 = s * 0.5;
  const l2 = Math.min(0.62, l * 0.88 + 0.05);
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * 6 * (2 / 3 - u);
    return p;
  };
  const q = l2 <= 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p = 2 * l2 - q;
  const rgb = s2 === 0 ? [l2, l2, l2] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, "0")).join("");
}
