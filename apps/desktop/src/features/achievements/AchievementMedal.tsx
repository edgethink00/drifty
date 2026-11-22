import type { AchievementItem } from "./useAchievements";
import { AchievementGlyph } from "./AchievementGlyph";
import { AchievementDial } from "./AchievementDial";
import { AchievementNumeral } from "./AchievementNumeral";
import { AchievementPoster } from "./AchievementPoster";
import { AchievementStamp } from "./AchievementStamp";
import { CONCEALED_MARK, achievementMark, type AchievementArtProps, type AchievementArtState } from "./achievementArt";
import { useAchievementBadgeVariant, type AchievementBadgeVariant } from "./achievementDesignReview";
import { useLocalization } from "../localization/LocalizationContext";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";

export function achievementMedalState(item: AchievementItem): AchievementArtState {
  if (item.earned) return "earned";
  return item.definition.hidden ? "concealed" : "locked";
}

type DrawnVariant = Exclude<AchievementBadgeVariant, "line">;

/** The drawn badge for one achievement, filling whatever box holds it. */
export function AchievementArt({ item, variant, detail = true }: { readonly item: AchievementItem; readonly variant: DrawnVariant; readonly detail?: boolean }) {
  const { effectiveLanguage } = useLocalization();
  const state = achievementMedalState(item);
  const earnedDay = item.earned ? (item.definition.repeatable ? item.earned.lastDay : item.earned.firstDay) : null;
  const props: AchievementArtProps = {
    id: item.definition.id,
    group: item.definition.group,
    state,
    detail,
    mark: state === "concealed" ? CONCEALED_MARK : achievementMark(item.definition.id, effectiveLanguage),
    day: earnedDay ? earnedDay.slice(5).replace("-", ".") : null,
  };
  if (variant === "dial") return <AchievementDial {...props} />;
  if (variant === "stamp") return <AchievementStamp {...props} />;
  if (variant === "numeral") return <AchievementNumeral {...props} />;
  return <AchievementPoster {...props} />;
}

/** One mark per achievement, in the badge art under review. */
export function AchievementMedal({ item, size = "md" }: { readonly item: AchievementItem; readonly size?: AchievementMedalSize }) {
  const variant = useAchievementBadgeVariant();
  const state = achievementMedalState(item);

  if (variant !== "line") {
    return (
      <span className={"achievement-medal achievement-medal--" + size + " achievement-medal--art"}>
        <AchievementArt item={item} variant={variant} detail={size !== "sm"} />
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
