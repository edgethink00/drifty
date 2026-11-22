import { useRef, type CSSProperties, type PointerEvent } from "react";
import type { AchievementItem } from "./useAchievements";
import { AchievementMedal, achievementAwardImage, achievementMedalState } from "./AchievementMedal";
import { useAchievementBadgeVariant } from "./achievementDesignReview";

type AchievementShowcaseProps = {
  readonly item: AchievementItem;
  /** "detail" beside the grid, "hero" on the new-achievement card. */
  readonly size: "detail" | "hero";
  /** Turn the award in and sweep the light across it once, as it arrives. */
  readonly entrance?: boolean;
};

const MAX_TILT_X = 18;
const MAX_TILT_Y = 24;

/**
 * An award held up to the light: it leans toward the pointer and a highlight
 * travels across the metal, the way a medal catches light when turned in the hand.
 */
export function AchievementShowcase({ item, size, entrance = false }: AchievementShowcaseProps) {
  const variant = useAchievementBadgeVariant();
  const node = useRef<HTMLSpanElement>(null);
  if (variant !== "award") return <AchievementMedal item={item} size={size === "hero" ? "xl" : "lg"} />;

  const state = achievementMedalState(item);
  const image = achievementAwardImage(item);
  const mask = { WebkitMaskImage: "url(" + image + ")", maskImage: "url(" + image + ")" } as CSSProperties;

  function handlePointerMove(event: PointerEvent<HTMLSpanElement>) {
    const element = node.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    element.dataset.tilting = "true";
    element.style.setProperty("--tilt-x", (-y * 2 * MAX_TILT_X).toFixed(2) + "deg");
    element.style.setProperty("--tilt-y", (x * 2 * MAX_TILT_Y).toFixed(2) + "deg");
    // The highlight band sits in a background 2.8 times the award's width;
    // this places its centre under the pointer.
    element.style.setProperty("--sheen-position", (((0.9 - x) / 1.8) * 100).toFixed(1) + "%");
  }

  function handlePointerLeave() {
    const element = node.current;
    if (!element) return;
    delete element.dataset.tilting;
    element.style.removeProperty("--tilt-x");
    element.style.removeProperty("--tilt-y");
    element.style.removeProperty("--sheen-position");
  }

  return (
    <span
      ref={node}
      className={"achievement-showcase achievement-showcase--" + size + " is-" + state + (entrance ? " achievement-showcase--entrance" : "")}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <span className="achievement-showcase__object">
        <img className="achievement-showcase__image" src={image} alt="" draggable={false} />
        {state === "locked" ? null : <span className="achievement-showcase__sheen" style={mask} />}
      </span>
    </span>
  );
}
