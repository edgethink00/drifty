import { useRef, type PointerEvent } from "react";
import type { AchievementItem } from "./useAchievements";
import { AchievementMedal, achievementMedalState, achievementPlateCount } from "./AchievementMedal";
import { AchievementPlate } from "./AchievementPlate";
import { useAchievementBadgeVariant } from "./achievementDesignReview";

type AchievementShowcaseProps = {
  readonly item: AchievementItem;
  /** "detail" beside the grid, "hero" on the new-achievement card. */
  readonly size: "detail" | "hero";
  /** Bring the plate in as the card opens. */
  readonly entrance?: boolean;
};

const MAX_TILT_X = 14;
const MAX_TILT_Y = 18;

/**
 * The large plate. It leans toward the pointer, and because its count floats
 * a little above the plate the two shift against each other as it leans.
 */
export function AchievementShowcase({ item, size, entrance = false }: AchievementShowcaseProps) {
  const variant = useAchievementBadgeVariant();
  const node = useRef<HTMLSpanElement>(null);
  if (variant !== "plate") return <AchievementMedal item={item} size={size === "hero" ? "xl" : "lg"} />;

  const state = achievementMedalState(item);
  const count = achievementPlateCount(item);

  function handlePointerMove(event: PointerEvent<HTMLSpanElement>) {
    const element = node.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    element.dataset.tilting = "true";
    element.style.setProperty("--tilt-x", (-y * 2 * MAX_TILT_X).toFixed(2) + "deg");
    element.style.setProperty("--tilt-y", (x * 2 * MAX_TILT_Y).toFixed(2) + "deg");
  }

  function handlePointerLeave() {
    const element = node.current;
    if (!element) return;
    delete element.dataset.tilting;
    element.style.removeProperty("--tilt-x");
    element.style.removeProperty("--tilt-y");
  }

  return (
    <span
      ref={node}
      className={"achievement-showcase achievement-showcase--" + size + " is-" + state + (entrance ? " achievement-showcase--entrance" : "")}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <span className="achievement-showcase__object">
        <AchievementPlate group={item.definition.group} state={state} glyph={state === "earned" ? item.definition.id : state === "locked" ? "lock" : "hidden"} seed={item.definition.id} />
        {count === null ? null : <span className="achievement-showcase__count">{count}</span>}
      </span>
    </span>
  );
}
