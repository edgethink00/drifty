import { useRef, type PointerEvent } from "react";
import type { AchievementItem } from "./useAchievements";
import { achievementBadgeStage, achievementBadgeUrl } from "./achievementBadge";

type AchievementShowcaseProps = {
  readonly item: AchievementItem;
  /** "detail" on the tab's stage, "hero" on the new-achievement card. */
  readonly size: "detail" | "hero";
  /** Set the medal down as the card opens. */
  readonly entrance?: boolean;
};

const MAX_TILT_DEG = 6;

function reducedMotion(): boolean {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * The large medal, standing on the surface with a soft shadow under it. It
 * leans a little toward the pointer, the way a medal held in the hand would;
 * on the new-achievement card it is set down into place.
 */
export function AchievementShowcase({ item, size, entrance = false }: AchievementShowcaseProps) {
  const node = useRef<HTMLSpanElement>(null);
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage);
  const arriving = size === "hero" && entrance && item.earned !== null;

  function handlePointerMove(event: PointerEvent<HTMLSpanElement>) {
    const element = node.current;
    if (!element || reducedMotion()) return;
    const box = element.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    element.dataset.tilting = "true";
    element.style.setProperty("--tilt-x", (-y * 2 * MAX_TILT_DEG).toFixed(2) + "deg");
    element.style.setProperty("--tilt-y", (x * 2 * MAX_TILT_DEG).toFixed(2) + "deg");
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
      className={"achievement-showcase achievement-showcase--" + size + (arriving ? " achievement-showcase--arriving" : "")}
      data-stage={stage}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <span className="achievement-showcase__floor" aria-hidden="true" />
      <span className="achievement-showcase__drop">
        <span className="achievement-showcase__object">
          {src ? <img className="achievement-showcase__image" src={src} alt="" draggable={false} /> : null}
        </span>
      </span>
    </span>
  );
}
