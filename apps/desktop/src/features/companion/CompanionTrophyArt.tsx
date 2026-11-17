import { useId, type CSSProperties } from "react";

/* Illustration for the weekly first-place card: a line-drawn trophy between two
   laurel sprigs, drawn in a 300×86 frame that the card's art block crops to its
   own width. Strokes and fills come from the `.trophy-art` tokens in
   companion-pill.css, so the light and dark themes recolour it without new
   markup, and the "rise" entrance is pure CSS keyed to the active view. */

const CUP = "M135 17H165V31C165 41.5 158.5 48 150 48C141.5 48 135 41.5 135 31Z";
const HANDLES = "M135 21h-6a5 5 0 0 0-5 5c0 6.5 5 10.5 11.5 10.5M165 21h6a5 5 0 0 1 5 5c0 6.5-5 10.5-11.5 10.5";
const STEM = "M150 48v9M141 57h18l2 9h-22z";
const PLATE = "M143 61.5h14";
const SPRIG_STEM = "M0 0C-5-9-6-19-3-29";
const LEAF = "M0 0C3-3.4 8.5-3.8 13 0C8.5 3.8 3 3.4 0 0Z";
const LEAVES = [
  "translate(-2 -7) rotate(-150) scale(.75)",
  "translate(-1 -9) rotate(-40) scale(.7)",
  "translate(-4 -15) rotate(-145) scale(.75)",
  "translate(-3 -18) rotate(-50) scale(.7)",
  "translate(-4 -23) rotate(-130) scale(.7)",
];
const CONFETTI_DASHES = ["M68 30l6-3", "M232 27l6 3", "M80 63l3 5", "M222 63l-3 5"];
const CONFETTI_DOTS: readonly (readonly [number, number, number])[] = [
  [86, 44, 2],
  [216, 42, 2],
  [62, 50, 1.4],
  [240, 52, 1.4],
];
/* The trophy and its sprigs are drawn small and scaled about their centre, so
   the frame's height is used without redrawing the geometry. */
const TROPHY_SCALE = "translate(150 42) scale(1.22) translate(-150 -42)";

function starPoints(cx: number, cy: number, outer: number, ratio = 0.42): string {
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : outer * ratio;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return (cx + radius * Math.cos(angle)).toFixed(2) + "," + (cy + radius * Math.sin(angle)).toFixed(2);
  }).join(" ");
}

function Sprig({ x, mirror = false }: { readonly x: number; readonly mirror?: boolean }) {
  return (
    <g transform={"translate(" + x + " 66)" + (mirror ? " scale(-1 1)" : "")}>
      <g className="trophy-art__ink trophy-art__sprig">
        <path d={SPRIG_STEM} />
        {LEAVES.map((leaf) => <path key={leaf} d={LEAF} transform={leaf} />)}
      </g>
    </g>
  );
}

export function CompanionTrophyArt() {
  const cupClipId = "companion-trophy-cup-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className="trophy-art" aria-hidden="true">
      <svg viewBox="0 0 300 86" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <clipPath id={cupClipId}><path d={CUP} /></clipPath>
        </defs>
        <g className="trophy-art__confetti">
          {CONFETTI_DASHES.map((dash, index) => (
            <path key={dash} className="trophy-art__ink trophy-art__piece" d={dash} style={{ "--piece": index } as CSSProperties} />
          ))}
          {CONFETTI_DOTS.map(([cx, cy, r], index) => (
            <circle
              key={cx + ":" + cy}
              className="trophy-art__gold trophy-art__piece"
              cx={cx}
              cy={cy}
              r={r}
              style={{ "--piece": CONFETTI_DASHES.length + index } as CSSProperties}
            />
          ))}
        </g>
        <g transform={TROPHY_SCALE}>
          <Sprig x={117} />
          <Sprig x={183} mirror />
          <g className="trophy-art__trophy">
            <circle className="trophy-art__gold" cx="155" cy="31" r="14" />
            <g className="trophy-art__ink">
              <path d={CUP} />
              <path d={HANDLES} />
              <path d={STEM} />
              <path d={PLATE} />
            </g>
            <g clipPath={"url(#" + cupClipId + ")"}>
              <g transform="rotate(20 150 32)">
                <rect className="trophy-art__glint" x="141" y="-4" width="8" height="72" />
              </g>
            </g>
            <text className="trophy-art__number" x="150" y="39" textAnchor="middle">1</text>
          </g>
          <polygon className="trophy-art__ink trophy-art__star trophy-art__star--left" points={starPoints(106, 24, 4.2)} />
          <polygon className="trophy-art__ink trophy-art__star trophy-art__star--right" points={starPoints(196, 20, 3.4)} />
        </g>
      </svg>
    </div>
  );
}
