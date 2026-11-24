import { Fragment } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import type { AchievementHoldings } from "../../achievementCollection";
import type { AchievementItem } from "../../useAchievements";
import { heldParts } from "./c9Copy";

type MedalProps = {
  readonly item: AchievementItem;
  /** The small image, for marks under about 3rem. */
  readonly small?: boolean;
  readonly className?: string;
};

/** The medal image as baked; its box is sized by the layout's CSS. */
export function C9Medal({ item, small = false, className = "c9-medal" }: MedalProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    <span className={className} data-stage={stage} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

/** One quiet line: how many are held per rarity tier, or per medal metal without rarity. */
export function C9Held({ holdings, className }: { readonly holdings: AchievementHoldings; readonly className: string }) {
  const { t } = useLocalization();
  const parts = heldParts(holdings, t);
  if (parts.length === 0) return null;
  return (
    <p className={className} data-tier-summary={holdings.kind}>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 ? <span className="c9-held__sep" aria-hidden="true"> · </span> : null}
          <span className="c9-held__part" data-notable={part.notable ? "true" : undefined}>
            {t("achievements.c9.tierCount", { name: part.name, count: part.count })}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
