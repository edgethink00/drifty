import type { AchievementId } from "../achievementCatalog";

/** One colour per achievement for the rendered badges; the same in both themes, as a real object would be. */
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

/** A small seeded random source, so every badge renders the same each time. */
export function seeded(text: string): () => number {
  let state = 2166136261;
  for (const letter of text) state = Math.imul(state ^ letter.charCodeAt(0), 16777619);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

export const METALS = {
  silver: { color: 0xdfe3e8, roughness: 0.16 },
  gold: { color: 0xeac46e, roughness: 0.18 },
  rose: { color: 0xe7b39a, roughness: 0.2 },
  pewter: { color: 0xa7abb2, roughness: 0.55 },
} as const;
