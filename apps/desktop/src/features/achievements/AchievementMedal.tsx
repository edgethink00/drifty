import type { AchievementItem, AchievementRecord } from "./useAchievements";
import { AchievementGlyph } from "./AchievementGlyph";
import { AchievementCat } from "./AchievementCat";
import { AchievementDayRing } from "./AchievementDayRing";
import { AchievementHourglass } from "./AchievementHourglass";
import { AchievementRecordCard } from "./AchievementRecordCard";
import {
  ACHIEVEMENT_GOALS,
  CONCEALED_FIGURE,
  durationFigure,
  type AchievementArtProps,
  type AchievementArtState,
  type AchievementFigure,
} from "./achievementArt";
import { ACHIEVEMENT_MILESTONES, achievementMilestoneProgress } from "./achievementMilestones";
import { useAchievementBadgeVariant, type AchievementBadgeVariant } from "./achievementDesignReview";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";

export function achievementMedalState(item: AchievementItem): AchievementArtState {
  if (item.earned) return "earned";
  return item.definition.hidden ? "concealed" : "locked";
}

function recordFigure(record: AchievementRecord | null): AchievementFigure | null {
  if (!record) return null;
  if (record.kind === "duration") return durationFigure(record.seconds);
  if (record.kind === "days") return { text: String(record.days) };
  return { text: String(Math.round(record.percent)), unit: "%" };
}

export function achievementArtProps(item: AchievementItem, detail: boolean): AchievementArtProps {
  const state = achievementMedalState(item);
  const { id, group, repeatable } = item.definition;
  const count = item.earned?.count ?? 0;
  const tier = item.earned && repeatable ? ACHIEVEMENT_MILESTONES.filter((milestone) => milestone <= count).length : 0;
  let progress = 0;
  if (item.earned) progress = repeatable ? achievementMilestoneProgress(count)?.share ?? 1 : 1;
  else if (state === "locked" && item.progress && item.progress.target > 0) progress = Math.min(1, Math.max(0, item.progress.current / item.progress.target));
  return {
    id,
    group,
    state,
    detail,
    goal: state === "concealed" ? CONCEALED_FIGURE : ACHIEVEMENT_GOALS[id],
    record: recordFigure(item.record),
    shape: item.day?.shape ?? null,
    progress,
    tier,
  };
}

type DrawnVariant = Exclude<AchievementBadgeVariant, "line">;

/** The drawn badge for one achievement, filling whatever box holds it. */
export function AchievementArt({ item, variant, detail = true }: { readonly item: AchievementItem; readonly variant: DrawnVariant; readonly detail?: boolean }) {
  const props = achievementArtProps(item, detail);
  if (variant === "cat") return <AchievementCat {...props} />;
  if (variant === "day") return <AchievementDayRing {...props} />;
  if (variant === "hourglass") return <AchievementHourglass {...props} />;
  return <AchievementRecordCard {...props} />;
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
