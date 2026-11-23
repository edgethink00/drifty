import type { AchievementItem } from "./useAchievements";
import { AchievementGlyph } from "./AchievementGlyph";
import { AchievementCat } from "./AchievementCat";
import { AchievementGem } from "./AchievementGem";
import { AchievementNumeral } from "./AchievementNumeral";
import { AchievementPaper } from "./AchievementPaper";
import { AchievementOmo1 } from "./AchievementOmo1";
import { AchievementOmo2 } from "./AchievementOmo2";
import { AchievementOmo3 } from "./AchievementOmo3";
import { AchievementOmo4 } from "./AchievementOmo4";
import { AchievementPotion1 } from "./AchievementPotion1";
import { AchievementPotion2 } from "./AchievementPotion2";
import { AchievementPotion3 } from "./AchievementPotion3";
import { AchievementPotion4 } from "./AchievementPotion4";
import { AchievementRender3d } from "./AchievementRender3d";
import type { AchievementArtProps, AchievementArtState } from "./achievementArt";
import { ACHIEVEMENT_MILESTONES } from "./achievementMilestones";
import { useAchievementBadgeVariant, type AchievementBadgeVariant } from "./achievementDesignReview";

export type AchievementMedalSize = "sm" | "md" | "lg" | "xl";

export function achievementMedalState(item: AchievementItem): AchievementArtState {
  if (item.earned) return "earned";
  return item.definition.hidden ? "concealed" : "locked";
}

export function achievementArtProps(item: AchievementItem, detail: boolean): AchievementArtProps {
  const { id, group, repeatable } = item.definition;
  const count = item.earned?.count ?? 0;
  return {
    id,
    group,
    state: achievementMedalState(item),
    detail,
    tier: item.earned && repeatable ? ACHIEVEMENT_MILESTONES.filter((milestone) => milestone <= count).length : 0,
  };
}

/** The drawn badge for one achievement, filling whatever box holds it. */
export function AchievementArt({ item, variant, detail = true, entrance = false }: { readonly item: AchievementItem; readonly variant: AchievementBadgeVariant; readonly detail?: boolean; readonly entrance?: boolean }) {
  const props = { ...achievementArtProps(item, detail), entrance };
  switch (variant) {
    case "gem": return <AchievementGem {...props} />;
    case "numeral": return <AchievementNumeral {...props} />;
    case "paper": return <AchievementPaper {...props} />;
    case "omo1": return <AchievementOmo1 {...props} />;
    case "omo2": return <AchievementOmo2 {...props} />;
    case "omo3": return <AchievementOmo3 {...props} />;
    case "omo4": return <AchievementOmo4 {...props} />;
    case "potion1": return <AchievementPotion1 {...props} />;
    case "potion2": return <AchievementPotion2 {...props} />;
    case "potion3": return <AchievementPotion3 {...props} />;
    case "potion4": return <AchievementPotion4 {...props} />;
    case "medal3d": return <AchievementRender3d kind="medal" {...props} />;
    case "elixir3d": return <AchievementRender3d kind="elixir" {...props} />;
    case "drop3d": return <AchievementRender3d kind="drop" {...props} />;
    case "glass3d": return <AchievementRender3d kind="glass" {...props} />;
    default: return <AchievementCat {...props} />;
  }
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
