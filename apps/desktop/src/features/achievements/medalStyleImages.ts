import { useSyncExternalStore } from "react";
import type { AchievementDefinition } from "./achievementCatalog";
import { achievementBadgeUrl, type AchievementBadgeStage } from "./achievementBadge";
import { useAchievementReviewState, isAchievementDesignReview } from "./achievementDesignReview";
import { DEFAULT_MEDAL_STYLE, isShippedMedalStyle, medalStyleKey, type MedalStyle } from "./medalStyle";

/**
 * Dev review only: medal images in a design other than the shipped one,
 * rendered in the browser on first use and kept for the session. Everything
 * else reads the baked images; production never loads three.js for this.
 */
const cache = new Map<string, string>();
const queue = new Map<string, { readonly definition: AchievementDefinition; readonly stage: AchievementBadgeStage; readonly style: MedalStyle; readonly px: number }>();
const listeners = new Set<() => void>();
let version = 0;
let scheduled = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function drain() {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    void import("./render3d/bake").then(({ renderStyledBadge, STAGE_TIER }) => {
      for (const [key, job] of queue) {
        queue.delete(key);
        try {
          cache.set(key, renderStyledBadge({
            id: job.definition.id,
            group: job.definition.group,
            state: job.stage === "locked" ? "locked" : job.stage === "concealed" ? "concealed" : "earned",
            detail: true,
            tier: STAGE_TIER[job.stage],
          }, job.style, job.px));
        } catch {
          // WebGL unavailable: the baked image stays.
        }
      }
    }).finally(() => {
      scheduled = false;
      version += 1;
      for (const listener of listeners) listener();
    });
  }, 0);
}

/** The medal design the dev review has chosen; the shipped one elsewhere. */
export function useActiveMedalStyle(): MedalStyle {
  const { medal } = useAchievementReviewState();
  return isAchievementDesignReview() ? medal : DEFAULT_MEDAL_STYLE;
}

/** The image of a medal at a stage in the active design: baked when shipped, rendered on first use otherwise. */
export function useAchievementBadgeUrl(definition: AchievementDefinition, stage: AchievementBadgeStage, small = false): string | undefined {
  const style = useActiveMedalStyle();
  useSyncExternalStore(subscribe, () => version, () => version);
  const baked = achievementBadgeUrl(definition.id, stage, small);
  if (isShippedMedalStyle(style)) return baked;
  const key = medalStyleKey(style) + ":" + definition.id + ":" + stage + ":" + (small ? "s" : "l");
  const hit = cache.get(key);
  if (hit) return hit;
  if (!queue.has(key)) {
    queue.set(key, { definition, stage, style, px: small ? 128 : 384 });
    drain();
  }
  return baked;
}
