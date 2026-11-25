import { ACHIEVEMENT_DEFINITIONS } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { ACHIEVEMENT_BADGE_STAGES, achievementBadgeFile, type AchievementBadgeStage } from "../achievementBadge";
import { buildMedal } from "./medal";
import { renderStage } from "./studio";

/** The milestone count each medal stage is drawn at. */
const STAGE_TIER: Record<AchievementBadgeStage, number> = { locked: 0, concealed: 0, silver: 1, gold: 3, ring: 5 };

export type BakedBadge = { readonly file: string; readonly dataUrl: string };

function shrink(source: HTMLCanvasElement, px: number): HTMLCanvasElement {
  let current = source;
  while (current.width / 2 >= px) {
    const half = document.createElement("canvas");
    half.width = Math.round(current.width / 2);
    half.height = Math.round(current.height / 2);
    const ctx = half.getContext("2d");
    if (ctx) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(current, 0, 0, half.width, half.height); }
    current = half;
  }
  if (current.width === px) return current;
  const out = document.createElement("canvas");
  out.width = px;
  out.height = px;
  const ctx = out.getContext("2d");
  if (ctx) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(current, 0, 0, px, px); }
  return out;
}

/**
 * Every medal image the app uses: each achievement locked and at each metal
 * stage, plus the one shown for a hidden achievement, at a large and a small
 * size. Called by scripts/bake-achievement-badges.mjs in a browser.
 */
export function bakeAchievementBadges(large = 384, small = 128): BakedBadge[] {
  const baked: BakedBadge[] = [];
  const render = (file: string, props: AchievementArtProps) => {
    const canvas = renderStage(buildMedal(props), large * 2);
    baked.push({ file: file + ".webp", dataUrl: shrink(canvas, large).toDataURL("image/webp", 0.9) });
    baked.push({ file: file + "-sm.webp", dataUrl: shrink(canvas, small).toDataURL("image/webp", 0.92) });
  };
  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    for (const stage of ACHIEVEMENT_BADGE_STAGES) {
      if (stage === "concealed") continue;
      render(achievementBadgeFile(definition.id, stage), {
        id: definition.id,
        group: definition.group,
        state: stage === "locked" ? "locked" : "earned",
        detail: true,
        tier: STAGE_TIER[stage],
      });
    }
  }
  const hidden = ACHIEVEMENT_DEFINITIONS.find((definition) => definition.hidden) ?? ACHIEVEMENT_DEFINITIONS[0]!;
  render(achievementBadgeFile(hidden.id, "concealed"), { id: hidden.id, group: hidden.group, state: "concealed", detail: true, tier: 0 });
  return baked;
}

