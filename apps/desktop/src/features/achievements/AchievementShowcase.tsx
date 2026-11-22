import { useRef, type PointerEvent } from "react";
import type { AchievementItem } from "./useAchievements";
import { AchievementArt, AchievementMedal, achievementArtProps, achievementMedalState } from "./AchievementMedal";
import { AchievementGem } from "./AchievementGem";
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

/** Paper bits around the badge on the new-achievement card: x, y, turn and which of three colours. */
const CONFETTI: readonly (readonly [number, number, number, number])[] = [
  [18, 40, 20, 0], [30, 14, -30, 1], [62, 6, 10, 2], [140, 8, 40, 0], [172, 22, -20, 2], [186, 58, 15, 1],
  [10, 92, -12, 2], [190, 104, 30, 0], [14, 150, 35, 1], [186, 156, -25, 2], [44, 186, 15, 0], [158, 188, -40, 1],
  [100, 2, -8, 1], [4, 124, 60, 0],
];

function Confetti({ group }: { readonly group: string }) {
  return (
    <svg className="achievement-confetti" viewBox="0 0 200 200" data-group={group} aria-hidden="true" focusable="false">
      {CONFETTI.map(([x, y, turn, tone], index) => (
        index % 3 === 2
          ? <circle key={index} className={"achievement-confetti__bit is-" + tone} cx={x} cy={y} r="3" style={{ animationDelay: (index % 5) * 40 + "ms" }} />
          : <rect key={index} className={"achievement-confetti__bit is-" + tone} x={x - 5} y={y - 2} width="10" height="4" rx="1.5" transform={"rotate(" + turn + " " + x + " " + y + ")"} style={{ animationDelay: (index % 5) * 40 + "ms" }} />
      ))}
    </svg>
  );
}

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
        {variant === "gem" && size === "hero" && entrance && item.earned ? (
          <span className="achievement-reveal">
            <span className="achievement-reveal__stone"><AchievementGem {...achievementArtProps(item, true)} state="locked" /></span>
            <span className="achievement-reveal__gem"><AchievementArt item={item} variant={variant} /></span>
          </span>
        ) : <AchievementArt item={item} variant={variant} />}
      </span>
      {size === "hero" && entrance && item.earned ? <Confetti group={item.definition.group} /> : null}
    </span>
  );
}
