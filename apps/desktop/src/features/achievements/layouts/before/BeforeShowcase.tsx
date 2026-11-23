import { useRef, type CSSProperties, type PointerEvent } from "react";
import type { AchievementItem } from "../../useAchievements";
import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";

type BeforeShowcaseProps = {
  readonly item: AchievementItem;
  /** "detail" beside the grid, "hero" on the new-achievement card. */
  readonly size: "detail" | "hero";
  /** Strike the medal as the card opens. */
  readonly entrance?: boolean;
};

const MAX_TILT_X = 12;
const MAX_TILT_Y = 16;

/** Paper bits around the medal on the new-achievement card: x, y, turn and which of three colours. */
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

/**
 * The large medal. It leans toward the pointer, the way a medal held in the
 * hand would; on the new-achievement card it is struck into place and a
 * light runs across its metal.
 */
export function BeforeShowcase({ item, size, entrance = false }: BeforeShowcaseProps) {
  const node = useRef<HTMLSpanElement>(null);
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage);
  const struck = size === "hero" && entrance && item.earned !== null;

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
      className={"achievement-showcase achievement-showcase--" + size + (struck ? " achievement-showcase--entrance" : "")}
      data-stage={stage}
      style={src ? ({ "--medal-image": 'url("' + src + '")' } as CSSProperties) : undefined}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <span className="achievement-showcase__object">
        {src ? <img className="achievement-showcase__image" src={src} alt="" draggable={false} /> : null}
        {struck ? <span className="achievement-showcase__sheen" aria-hidden="true" /> : null}
      </span>
      {struck ? <Confetti group={item.definition.group} /> : null}
    </span>
  );
}
