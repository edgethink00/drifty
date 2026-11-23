import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import type { AchievementItem } from "../../useAchievements";

type C6MedalProps = {
  readonly item: AchievementItem;
  /** The small file, for marks under about 3rem. */
  readonly small?: boolean;
  /** A soft shadow on the surface under an earned medal, so it stands rather than lies flat. */
  readonly floor?: boolean;
  readonly className?: string;
};

/** The medal image, untouched; c6 only sizes it, places it and moves it. */
export function C6Medal({ item, small = false, floor = false, className }: C6MedalProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    <span className={"c6-medal" + (className ? " " + className : "")} data-stage={stage}>
      {floor ? <span className="c6-medal__floor" aria-hidden="true" /> : null}
      {src ? <img className="c6-medal__image" src={src} alt="" draggable={false} /> : null}
    </span>
  );
}
