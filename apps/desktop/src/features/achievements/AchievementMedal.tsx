import type { AchievementItem } from "./useAchievements";
import { achievementBadgeStage, achievementBadgeUrl } from "./achievementBadge";
import "./achievement-medal.css";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";

/** One achievement's medal, filling a box of the given size. */
export function AchievementMedal({ item, size = "md" }: { readonly item: AchievementItem; readonly size?: AchievementMedalSize }) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, size === "sm");
  return (
    <span className={"achievement-medal achievement-medal--" + size} data-stage={stage}>
      {src ? <img className="achievement-medal__image" src={src} alt="" draggable={false} /> : null}
    </span>
  );
}
