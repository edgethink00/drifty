import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import type { AchievementItem } from "../../useAchievements";

type MedalProps = {
  readonly item: AchievementItem;
  /** The small image, for marks under about 3rem. */
  readonly small?: boolean;
  readonly className?: string;
};

/** The medal image as baked; its box is sized by the layout's CSS. */
export function C1Medal({ item, small = false, className = "c1-medal" }: MedalProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    <span className={className} data-stage={stage} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

/**
 * A slot that held the locked medal and now holds the earned one: the two
 * fixed images cross-fade, nothing is drawn over either.
 */
export function C1SwapMedal({ item, small = false, delay = 0 }: MedalProps & { readonly delay?: number }) {
  const earnedStage = achievementBadgeStage(item);
  const lockedStage = item.definition.hidden ? "concealed" : "locked";
  const before = achievementBadgeUrl(item.definition.id, lockedStage, small);
  const after = achievementBadgeUrl(item.definition.id, earnedStage, small);
  return (
    <span className="c1-medal c1-swap" data-stage={earnedStage} aria-hidden="true">
      {before ? <img className="c1-swap__before" src={before} alt="" draggable={false} style={{ animationDelay: delay + "ms" }} /> : null}
      {after ? <img className="c1-swap__after" src={after} alt="" draggable={false} style={{ animationDelay: delay + "ms" }} /> : null}
    </span>
  );
}
