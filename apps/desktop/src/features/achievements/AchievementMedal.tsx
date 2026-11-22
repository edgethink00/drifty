import type { AchievementItem } from "./useAchievements";
import { AchievementGlyph } from "./AchievementGlyph";
import { ACHIEVEMENT_AWARD_IMAGES } from "./achievementAwardImages";
import { useAchievementBadgeVariant } from "./achievementDesignReview";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";
export type AchievementMedalState = "earned" | "locked" | "concealed";

export function achievementMedalState(item: AchievementItem): AchievementMedalState {
  if (item.earned) return "earned";
  return item.definition.hidden ? "concealed" : "locked";
}

/** The award picture for an achievement; a hidden one stays the sealed medal until earned. */
export function achievementAwardImage(item: AchievementItem): string {
  return ACHIEVEMENT_AWARD_IMAGES[achievementMedalState(item) === "concealed" ? "hidden" : item.definition.id];
}

/** One mark per achievement. Locked awards are the same object without its colour. */
export function AchievementMedal({ item, size = "md" }: { readonly item: AchievementItem; readonly size?: AchievementMedalSize }) {
  const variant = useAchievementBadgeVariant();
  const state = achievementMedalState(item);

  if (variant === "award") {
    return (
      <span className={"achievement-medal achievement-medal--" + size + " achievement-medal--award is-" + state}>
        <img className="achievement-medal__image" src={achievementAwardImage(item)} alt="" draggable={false} />
      </span>
    );
  }

  const tone = state !== "earned" ? "locked" : item.definition.group === "unexpected" || item.definition.weight >= 6 ? "gold" : "earned";
  return (
    <span className={"achievement-medal achievement-medal--" + size + " achievement-medal--" + tone}>
      <AchievementGlyph name={state === "concealed" ? "hidden" : item.definition.id} className="achievement-medal__glyph" />
      {state === "locked" ? (
        <span className="achievement-medal__lock"><AchievementGlyph name="lock" /></span>
      ) : null}
    </span>
  );
}
