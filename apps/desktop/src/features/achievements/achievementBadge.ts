import type { AchievementId } from "./achievementCatalog";
import type { AchievementItem } from "./useAchievements";

/**
 * Drifty's achievement medal: a thick coin in the achievement's muted colour
 * with its pictogram raised in metal, rendered in 3D ahead of time
 * (scripts/bake-achievement-badges.mjs) and shipped as images. Its metal tells
 * how often it has been earned without naming it: silver at first, rose gold
 * from ten times (the "gold" stage), an inner band from fifty ("ring").
 */
export const ACHIEVEMENT_BADGE_STAGES = ["locked", "concealed", "silver", "gold", "ring"] as const;
export type AchievementBadgeStage = typeof ACHIEVEMENT_BADGE_STAGES[number];

/** Earned this many times or more, a repeatable medal turns gold, then gains a second rim. */
export const GOLD_FROM_COUNT = 10;
export const RING_FROM_COUNT = 50;

/** One-off achievements this weighty are struck in gold from the start. */
const GOLD_WEIGHT = 5;

export function achievementBadgeStage(item: AchievementItem): AchievementBadgeStage {
  const { definition, earned } = item;
  if (!earned) return definition.hidden ? "concealed" : "locked";
  if (!definition.repeatable) return definition.weight >= GOLD_WEIGHT ? "gold" : "silver";
  if (earned.count >= RING_FROM_COUNT) return "ring";
  return earned.count >= GOLD_FROM_COUNT ? "gold" : "silver";
}

/** File name, without extension, of a medal image; every hidden achievement shares one. */
export function achievementBadgeFile(id: AchievementId, stage: AchievementBadgeStage): string {
  return stage === "concealed" ? "concealed" : id + "-" + stage;
}

// Kept as files rather than inlined into the script, so the small marks do not grow the bundle.
const IMAGES = import.meta.glob<string>("../../assets/achievement-badges/*.webp", { eager: true, import: "default", query: "?no-inline" });

/** URL of the medal image, the small one for marks under about 3rem. */
export function achievementBadgeUrl(id: AchievementId, stage: AchievementBadgeStage, small = false): string | undefined {
  return IMAGES["../../assets/achievement-badges/" + achievementBadgeFile(id, stage) + (small ? "-sm" : "") + ".webp"];
}
