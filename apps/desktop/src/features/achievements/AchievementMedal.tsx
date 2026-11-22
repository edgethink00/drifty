import type { AchievementItem } from "./useAchievements";
import { AchievementGlyph } from "./AchievementGlyph";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";

/** A round mark per achievement: earned in olive, the notable ones in gold, the rest greyed with a lock. */
export function AchievementMedal({ item, size = "md" }: { readonly item: AchievementItem; readonly size?: AchievementMedalSize }) {
  const earned = item.earned !== null;
  const concealed = item.definition.hidden && !earned;
  const tone = !earned ? "locked" : item.definition.group === "unexpected" || item.definition.weight >= 6 ? "gold" : "earned";
  return (
    <span className={"achievement-medal achievement-medal--" + size + " achievement-medal--" + tone}>
      <AchievementGlyph name={concealed ? "hidden" : item.definition.id} className="achievement-medal__glyph" />
      {!earned && !concealed ? (
        <span className="achievement-medal__lock"><AchievementGlyph name="lock" /></span>
      ) : null}
    </span>
  );
}

