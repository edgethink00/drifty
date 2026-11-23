import { achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import type { AchievementItem } from "../../useAchievements";
import "./c5-medal.css";

type C5MedalProps = {
  readonly item: AchievementItem;
  /** Draw this stage instead of the item's own (the rail's medal track). */
  readonly stage?: AchievementBadgeStage;
  /** Use the small image for marks under about 3rem. */
  readonly small?: boolean;
  readonly className?: string;
};

/** The medal image in a box sized by --c5-medal; nothing is painted over it. */
export function C5Medal({ item, stage, small = false, className }: C5MedalProps) {
  const shown = stage ?? achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, shown, small);
  return (
    <span className={"c5-medal" + (className ? " " + className : "")} data-stage={shown}>
      {src ? <img className="c5-medal__image" src={src} alt="" draggable={false} /> : null}
    </span>
  );
}
