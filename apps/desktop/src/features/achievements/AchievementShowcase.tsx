import { useRef, type PointerEvent } from "react";
import type { AchievementItem } from "./useAchievements";
import { AchievementArt, AchievementMedal, achievementMedalState } from "./AchievementMedal";
import { useAchievementBadgeVariant } from "./achievementDesignReview";

type AchievementShowcaseProps = {
  readonly item: AchievementItem;
  /** "detail" beside the grid, "hero" on the new-achievement card. */
  readonly size: "detail" | "hero";
  /** Bring the badge in as the card opens. */
  readonly entrance?: boolean;
};

const MAX_TILT_X = 12;
const MAX_TILT_Y = 16;

/** The large badge. It leans toward the pointer, the way a card held in the hand would. */
export function AchievementShowcase({ item, size, entrance = false }: AchievementShowcaseProps) {
  const variant = useAchievementBadgeVariant();
  const node = useRef<HTMLSpanElement>(null);
  if (variant === "line") return <AchievementMedal item={item} size={size === "hero" ? "xl" : "lg"} />;

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
      className={"achievement-showcase achievement-showcase--" + size + " is-" + achievementMedalState(item) + (entrance ? " achievement-showcase--entrance" : "")}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <span className="achievement-showcase__object">
        <AchievementArt item={item} variant={variant} />
      </span>
    </span>
  );
}
