import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import type { AchievementItem } from "../../useAchievements";

type MedalProps = {
  readonly item: AchievementItem;
  /** The small image, for marks under about 3rem. */
  readonly small?: boolean;
  readonly className?: string;
};

/** The medal image as baked; its box is sized by the layout's CSS. */
export function C7Medal({ item, small = false, className = "c7-medal" }: MedalProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    <span className={className} data-stage={stage} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

/** A slot that held the locked medal and now holds the earned one: the two fixed images cross-fade. */
export function C7SwapMedal({ item, small = false, delay = 0, className = "c7-medal" }: MedalProps & { readonly delay?: number }) {
  const earnedStage = achievementBadgeStage(item);
  const before = achievementBadgeUrl(item.definition.id, item.definition.hidden ? "concealed" : "locked", small);
  const after = achievementBadgeUrl(item.definition.id, earnedStage, small);
  return (
    <span className={className + " c7-swap"} data-stage={earnedStage} aria-hidden="true">
      {before ? <img className="c7-swap__before" src={before} alt="" draggable={false} style={{ animationDelay: delay + "ms" }} /> : null}
      {after ? <img className="c7-swap__after" src={after} alt="" draggable={false} style={{ animationDelay: delay + "ms" }} /> : null}
    </span>
  );
}
