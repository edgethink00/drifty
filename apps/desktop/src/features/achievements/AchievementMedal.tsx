import type { AchievementItem } from "./useAchievements";
import { AchievementGlyph } from "./AchievementGlyph";
import { AchievementPlate } from "./AchievementPlate";
import { useAchievementBadgeVariant } from "./achievementDesignReview";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";
export type AchievementMedalState = "earned" | "locked" | "concealed";

export function achievementMedalState(item: AchievementItem): AchievementMedalState {
  if (item.earned) return "earned";
  return item.definition.hidden ? "concealed" : "locked";
}

/** Times earned, as shown across a plate's lower edge; a hidden achievement shows none until earned. */
export function achievementPlateCount(item: AchievementItem): number | null {
  if (item.earned) return item.earned.count;
  return item.definition.hidden ? null : 0;
}

/** One mark per achievement, in the badge art under review. */
export function AchievementMedal({ item, size = "md" }: { readonly item: AchievementItem; readonly size?: AchievementMedalSize }) {
  const variant = useAchievementBadgeVariant();
  const state = achievementMedalState(item);

  if (variant === "plate") {
    const count = achievementPlateCount(item);
    return (
      <span className={"achievement-medal achievement-medal--" + size + " achievement-medal--plate is-" + state}>
        <AchievementPlate group={item.definition.group} state={state} glyph={state === "earned" ? item.definition.id : state === "locked" ? "lock" : "hidden"} seed={item.definition.id} />
        {count === null ? null : <span className="achievement-medal__count">{count}</span>}
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
