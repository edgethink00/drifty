import type { AchievementItem } from "./useAchievements";
import { AchievementGlyph } from "./AchievementGlyph";
import { AchievementArt } from "./AchievementArt";
import { useAchievementBadgeVariant } from "./achievementDesignReview";
import { achievementTier } from "./achievementRarity";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";

function progressShare(item: AchievementItem): number {
  const progress = item.progress;
  if (!progress || progress.target <= 0) return 0;
  return Math.max(0, Math.min(1, progress.current / progress.target));
}

/** One mark per achievement, drawn in the badge style under review; locked ones carry a lock. */
export function AchievementMedal({ item, size = "md" }: { readonly item: AchievementItem; readonly size?: AchievementMedalSize }) {
  const variant = useAchievementBadgeVariant();
  const earned = item.earned !== null;
  const concealed = item.definition.hidden && !earned;
  const lock = !earned && !concealed ? (
    <span className="achievement-medal__lock"><AchievementGlyph name="lock" /></span>
  ) : null;

  if (variant !== "line") {
    return (
      <span className={"achievement-medal achievement-medal--" + size + " achievement-medal--art"}>
        <AchievementArt
          variant={variant}
          group={item.definition.group}
          tier={achievementTier(item.definition, item.rarity)}
          state={earned ? "earned" : concealed ? "concealed" : "locked"}
          glyph={concealed ? "hidden" : item.definition.id}
          progress={progressShare(item)}
          seed={item.definition.id}
        />
        {lock}
      </span>
    );
  }

  const tone = !earned ? "locked" : item.definition.group === "unexpected" || item.definition.weight >= 6 ? "gold" : "earned";
  return (
    <span className={"achievement-medal achievement-medal--" + size + " achievement-medal--" + tone}>
      <AchievementGlyph name={concealed ? "hidden" : item.definition.id} className="achievement-medal__glyph" />
      {lock}
    </span>
  );
}

