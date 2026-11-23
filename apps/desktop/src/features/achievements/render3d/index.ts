import type { AchievementArtProps } from "../achievementArt";
import { buildAnodized } from "./anodized";
import { buildAward } from "./award";
import { buildClay } from "./clay";
import { buildCrystal } from "./crystal";
import { buildDrop } from "./drop";
import { buildElixir } from "./elixir";
import { buildEmblem } from "./emblem";
import { buildMedal } from "./medal";
import { imageDataToUrl, renderStage, type BadgeStage } from "./studio";

export type BadgeImages = { readonly transmit: string; readonly light: string };

export type Render3dKind = "medal" | "elixir" | "drop" | "glass" | "award" | "anodized" | "crystal" | "clay";

const BUILDERS: Record<Render3dKind, (props: AchievementArtProps) => BadgeStage> = {
  medal: buildMedal,
  elixir: buildElixir,
  drop: buildDrop,
  glass: buildEmblem,
  award: buildAward,
  anodized: buildAnodized,
  crystal: buildCrystal,
  clay: buildClay,
};

let queue: Promise<unknown> = Promise.resolve();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Renders one badge to its two layer images. Renders run one at a time, a frame apart, so the page stays responsive. */
export function renderBadge(kind: Render3dKind, props: AchievementArtProps, px: number, turn = 0): Promise<BadgeImages> {
  const job = queue.then(async () => {
    await nextFrame();
    const layers = renderStage(BUILDERS[kind](props), { px, turn });
    const [transmit, light] = await Promise.all([imageDataToUrl(layers.transmit), imageDataToUrl(layers.light)]);
    return { transmit, light };
  });
  queue = job.catch(() => undefined);
  return job;
}
