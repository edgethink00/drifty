import type { CSSProperties } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";
import { sparklePath } from "./achievementScene";
import { useArtId } from "./achievementMarks";

type Tone = 1 | 2 | 3 | 4;
type Hill = readonly ["bell" | "peak", number, number, number, Tone];
type Water = readonly ["sea" | "lake", number, Tone];
type Layer = Hill | Water;

function isWater(layer: Layer): layer is Water {
  return layer[0] === "sea" || layer[0] === "lake";
}

type Scene = {
  readonly night?: boolean;
  /** Where the sun stands on the day's arc, in degrees from the left horizon, and its radius. */
  readonly sun?: readonly [number, number];
  readonly moon?: readonly [number, number];
  readonly layers: readonly Layer[];
  readonly snow?: readonly [number, number, number];
  readonly prop?: "flag" | "boat" | "stones" | "trail" | "climb" | "reflection" | "rays" | "stars" | "sapling" | "grove" | "twin";
  readonly at?: readonly [number, number];
};

const SCENES: Record<AchievementId, Scene> = {
  firstFlow: { sun: [128, 13], layers: [["bell", 45, 70, 82, 1], ["bell", 30, 118, 60, 2], ["bell", 115, 94, 72, 3]], prop: "sapling", at: [112, 109] },
  flow90: { sun: [52, 12], layers: [["bell", 110, 62, 80, 1], ["bell", 40, 84, 75, 2], ["bell", 108, 106, 70, 3]], prop: "grove", at: [108, 117] },
  flow180: { sun: [148, 10], layers: [["peak", 66, 34, 72, 1], ["bell", 26, 102, 60, 2], ["bell", 124, 108, 58, 3]], snow: [66, 34, 72], prop: "flag", at: [66, 34] },
  focusDay8h: { sun: [90, 15], layers: [["bell", 28, 98, 72, 2], ["bell", 122, 104, 72, 3], ["bell", 40, 132, 70, 4]], prop: "rays" },
  earlyStart: { sun: [20, 15], layers: [["lake", 104, 2], ["bell", 16, 100, 46, 3], ["bell", 140, 104, 40, 3]] },
  nightOwl: { night: true, moon: [58, 15], layers: [["bell", 40, 96, 82, 2], ["bell", 118, 104, 70, 3], ["bell", 30, 130, 64, 4]], prop: "stars" },
  weekendShift: { sun: [150, 9], layers: [["peak", 48, 50, 52, 1], ["peak", 100, 62, 52, 2], ["bell", 75, 116, 92, 3]], prop: "twin" },
  streak7: { sun: [132, 11], layers: [["bell", 90, 64, 110, 1], ["bell", 40, 100, 100, 2], ["bell", 140, 132, 52, 4]], prop: "stones" },
  streak30: { sun: [48, 11], layers: [["bell", 64, 64, 110, 1], ["bell", 110, 98, 100, 2], ["bell", 6, 130, 50, 4]], prop: "trail" },
  focus100h: { sun: [150, 9], layers: [["peak", 75, 26, 76, 2], ["bell", 22, 112, 56, 3], ["bell", 128, 114, 56, 3]], snow: [75, 26, 76], prop: "flag", at: [75, 26] },
  driftDay: { sun: [126, 12], layers: [["sea", 92, 1], ["sea", 104, 2], ["sea", 118, 3]], prop: "boat", at: [62, 99] },
  noDriftDay: { sun: [90, 16], layers: [["bell", 18, 84, 42, 1], ["bell", 132, 86, 40, 1], ["lake", 90, 2]], prop: "reflection", at: [104, 99] },
  comeback: { sun: [40, 10], layers: [["bell", 108, 56, 76, 1], ["bell", 34, 98, 70, 2], ["bell", 140, 130, 46, 4]], prop: "climb", at: [106, 60] },
};

/** The day's arc across every sky: the path the sun takes from one horizon to the other. */
const DAY_ARC = { cx: 75, cy: 118, rx: 64, ry: 76 } as const;

function onDayArc([degrees, radius]: readonly [number, number]): readonly [number, number, number] {
  const angle = (degrees / 180) * Math.PI;
  return [DAY_ARC.cx - DAY_ARC.rx * Math.cos(angle), DAY_ARC.cy - DAY_ARC.ry * Math.sin(angle), radius];
}

/** The day's arc from the left horizon up to where the sun stands, for the sun to travel along. */
function dayArcUpTo(degrees: number): string {
  const [x, y] = onDayArc([degrees, 0]);
  return "M" + (DAY_ARC.cx - DAY_ARC.rx) + " " + DAY_ARC.cy + "A" + DAY_ARC.rx + " " + DAY_ARC.ry + " 0 0 1 " + x.toFixed(2) + " " + y.toFixed(2);
}

function layerPath(layer: Layer): string {
  if (isWater(layer)) {
    const top = layer[1];
    if (layer[0] === "lake") return "M-2 " + top + "H152V152H-2Z";
    return "M-6 " + top + Array.from({ length: 9 }, () => "q5-3.4 10 0t10 0").join("") + "V152H-6Z";
  }
  const [kind, cx, top, half] = layer;
  if (kind === "peak") return "M" + (cx - half) + " 152L" + (cx - 4) + " " + (top + 3) + "Q" + cx + " " + top + " " + (cx + 4) + " " + (top + 3) + "L" + (cx + half) + " 152Z";
  return "M" + (cx - half) + " 152C" + (cx - half * 0.42) + " " + top + " " + (cx + half * 0.42) + " " + top + " " + (cx + half) + " 152Z";
}

function snowPath([cx, top, half]: readonly [number, number, number]): string {
  const slope = (half - 4) / (149 - top);
  const edge = (depth: number) => 4 + slope * (depth - 3);
  return "M" + (cx - edge(16)) + " " + (top + 16) + "L" + (cx - 4) + " " + (top + 3) + "Q" + cx + " " + top + " " + (cx + 4) + " " + (top + 3)
    + "L" + (cx + edge(16)) + " " + (top + 16) + "L" + (cx + 5) + " " + (top + 12) + "L" + cx + " " + (top + 17) + "L" + (cx - 5) + " " + (top + 12) + "Z";
}

const STONES = [[24, 134, 5.6], [40, 126, 5.1], [56, 119, 4.7], [71, 113, 4.3], [85, 107, 3.9], [98, 101, 3.5], [110, 96, 3.1]] as const;

function Flag({ at }: { readonly at: readonly [number, number] }) {
  return (
    <g>
      <path className="apa-pole" d={"M" + at[0] + " " + (at[1] + 1) + "V" + (at[1] - 15)} />
      <path className="apa-flag" d={"M" + at[0] + " " + (at[1] - 15) + "L" + (at[0] + 11) + " " + (at[1] - 11.5) + "L" + at[0] + " " + (at[1] - 8) + "Z"} />
    </g>
  );
}

function Prop({ scene, sun }: { readonly scene: Scene; readonly sun: readonly [number, number, number] | null }) {
  const at = scene.at ?? [75, 75];
  switch (scene.prop) {
    case "sapling":
      return (
        <g>
          <path className="apa-pole" d={"M" + at[0] + " " + at[1] + "V" + (at[1] - 11)} />
          <ellipse className="apa-tree" cx={at[0] - 4} cy={at[1] - 11} rx="4.6" ry="2.4" transform={"rotate(-30 " + (at[0] - 4) + " " + (at[1] - 11) + ")"} />
          <ellipse className="apa-tree" cx={at[0] + 4.5} cy={at[1] - 13} rx="5" ry="2.6" transform={"rotate(28 " + (at[0] + 4.5) + " " + (at[1] - 13) + ")"} />
        </g>
      );
    case "grove":
      return (
        <g>
          {[[-12, 2, 5.5], [0, 0, 7.5], [12, 2, 6]].map(([dx, dy, r]) => (
            <g key={dx}>
              <path className="apa-pole" d={"M" + (at[0] + dx) + " " + (at[1] + dy) + "V" + (at[1] + dy - r - 4)} />
              <circle className="apa-tree" cx={at[0] + dx} cy={at[1] + dy - r - 5} r={r} />
            </g>
          ))}
        </g>
      );
    case "flag":
      return <Flag at={at} />;
    case "twin":
      return (
        <g>
          <Flag at={[48, 50]} />
          <Flag at={[100, 62]} />
        </g>
      );
    case "boat":
      return (
        <g transform={"rotate(-9 " + at[0] + " " + at[1] + ")"}>
          <path className="apa-hull" d={"M" + (at[0] - 13) + " " + at[1] + "H" + (at[0] + 13) + "L" + (at[0] + 8) + " " + (at[1] + 6) + "H" + (at[0] - 8) + "Z"} />
          <path className="apa-pole" d={"M" + at[0] + " " + at[1] + "V" + (at[1] - 22)} />
          <path className="apa-paper" d={"M" + (at[0] + 1.5) + " " + (at[1] - 21) + "L" + (at[0] + 13) + " " + (at[1] - 3) + "H" + (at[0] + 1.5) + "Z"} />
        </g>
      );
    case "stones":
      return <g>{STONES.map(([x, y, r]) => <ellipse key={x} className="apa-paper" cx={x} cy={y} rx={r} ry={r * 0.55} />)}</g>;
    case "trail":
      return <path className="apa-trail" d="M8 142C52 136 30 114 70 110S118 100 104 82" />;
    case "climb":
      return (
        <g>
          <path className="apa-trail" d="M22 142L52 122L42 110L78 94L68 84L104 62" />
          <Flag at={at} />
        </g>
      );
    case "reflection":
      return (
        <g>
          {[[98, 30], [104, 22], [110, 14], [116, 8]].map(([y, w]) => <rect key={y} className="apa-shine" x={75 - w / 2} y={y} width={w} height="2" rx="1" />)}
          <path className="apa-hull" d={"M" + (at[0] - 11) + " " + at[1] + "H" + (at[0] + 11) + "L" + (at[0] + 7) + " " + (at[1] + 5) + "H" + (at[0] - 7) + "Z"} />
          <path className="apa-pole" d={"M" + at[0] + " " + at[1] + "V" + (at[1] - 18)} />
          <path className="apa-paper" d={"M" + (at[0] + 1.5) + " " + (at[1] - 17) + "L" + (at[0] + 11) + " " + (at[1] - 3) + "H" + (at[0] + 1.5) + "Z"} />
        </g>
      );
    case "rays": {
      const [cx, cy, r] = sun ?? [75, 42, 15];
      return (
        <g>
          {Array.from({ length: 8 }, (_, index) => {
            const angle = (index / 8) * Math.PI * 2;
            const tip = r + 15;
            const base = r + 5;
            const spread = 0.17;
            const at = (radius: number, turn: number) => (cx + radius * Math.sin(turn)).toFixed(2) + " " + (cy - radius * Math.cos(turn)).toFixed(2);
            return <path key={index} className="apa-ray" d={"M" + at(base, angle - spread) + "L" + at(tip, angle) + "L" + at(base, angle + spread) + "Z"} />;
          })}
        </g>
      );
    }
    case "stars":
      return <g>{[[96, 34, 4], [118, 52, 3], [80, 60, 2.6], [112, 26, 2.4]].map(([x, y, r]) => <path key={x} className="apa-star" d={sparklePath(x, y, r)} />)}</g>;
    default:
      return null;
  }
}

/**
 * A paper-cut landscape for each achievement: the hour it happened in the sky
 * and its shape in the hills, each layer a sheet casting a small shadow on the
 * one behind. Until earned the same scene in the surface's greys.
 */
export function AchievementPaper({ id, group, state, entrance = false }: AchievementArtProps) {
  const uid = useArtId("achievement-paper");
  const scene = SCENES[id];
  const sun = scene.sun ? onDayArc(scene.sun) : null;
  const moon = scene.moon ? onDayArc(scene.moon) : null;
  const behind = scene.prop === "rays" || scene.prop === "stars";
  return (
    <svg className="achievement-art achievement-paper" viewBox="0 0 150 150" data-group={group} data-state={state} data-stone={id} data-night={scene.night ? "true" : undefined} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={uid + "-tile"}><rect x="0" y="0" width="150" height="150" rx="38" /></clipPath>
        <filter id={uid + "-cut"} x="-10%" y="-20%" width="120%" height="140%">
          <feDropShadow className="apa-cast" dx="0" dy="-1.2" stdDeviation="1.6" />
        </filter>
        <radialGradient id={uid + "-sunglow"}>
          <stop offset="0" className="apa-glow" />
          <stop offset="1" style={{ stopColor: "white", stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id={uid + "-box"} cx="50%" cy="58%" r="72%">
          <stop offset="0.62" style={{ stopColor: "black", stopOpacity: 0 }} />
          <stop offset="1" className="apa-box-edge" />
        </radialGradient>
      </defs>
      <g clipPath={"url(#" + uid + "-tile)"}>
        <rect className="apa-sky" x="0" y="0" width="150" height="150" />
        <path className="apa-arc" d={"M" + (DAY_ARC.cx - DAY_ARC.rx) + " " + DAY_ARC.cy + "A" + DAY_ARC.rx + " " + DAY_ARC.ry + " 0 0 1 " + (DAY_ARC.cx + DAY_ARC.rx) + " " + DAY_ARC.cy} />
        {sun && entrance && scene.sun ? (
          <g>
            <circle cx="0" cy="0" r={sun[2] * 2.6} style={{ fill: "url(#" + uid + "-sunglow)" }}>
              <animateMotion dur="1.5s" begin="0.25s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.3 0.6 0.2 1" path={dayArcUpTo(scene.sun[0])} />
            </circle>
            <circle className="apa-sun" cx="0" cy="0" r={sun[2]}>
              <animateMotion dur="1.5s" begin="0.25s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.3 0.6 0.2 1" path={dayArcUpTo(scene.sun[0])} />
            </circle>
          </g>
        ) : (
          <>
            {state === "earned" && sun ? <circle cx={sun[0]} cy={sun[1]} r={sun[2] * 2.6} style={{ fill: "url(#" + uid + "-sunglow)" }} /> : null}
            {sun ? <circle className="apa-sun apa-rise" cx={sun[0]} cy={sun[1]} r={sun[2]} style={{ "--i": 0 } as CSSProperties} /> : null}
          </>
        )}
        {moon ? (
          <g>
            <circle className="apa-moon" cx={moon[0]} cy={moon[1]} r={moon[2]} />
            <circle className="apa-sky" cx={moon[0] + 7} cy={moon[1] - 4} r={moon[2] * 0.82} />
          </g>
        ) : null}
        {behind ? <Prop scene={scene} sun={sun} /> : null}
        {scene.layers.map((layer, index) => (
          <g key={index} className="apa-rise" style={{ "--i": index + 1 } as CSSProperties}>
            <path className={"apa-layer apa-t" + layer[layer.length - 1]} d={layerPath(layer)} filter={"url(#" + uid + "-cut)"} />
            {state === "earned" ? <path className="apa-cut-edge" d={layerPath(layer)} /> : null}
            {index === 0 && scene.snow ? <path className="apa-paper" d={snowPath(scene.snow)} /> : null}
          </g>
        ))}
        {scene.prop && !behind ? <g className="apa-rise" style={{ "--i": scene.layers.length + 1 } as CSSProperties}><Prop scene={scene} sun={sun} /></g> : null}
        {state === "earned" ? <rect x="0" y="0" width="150" height="150" style={{ fill: "url(#" + uid + "-box)" }} /> : null}
      </g>
      {state === "concealed" ? <text className="ac-question" x="75" y="86" fontSize="30" textAnchor="middle">?</text> : null}
    </svg>
  );
}
