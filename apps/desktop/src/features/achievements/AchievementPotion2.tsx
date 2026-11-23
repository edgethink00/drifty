import { useId, type CSSProperties, type ReactNode } from "react";
import type { AchievementArtProps } from "./achievementArt";
import type { AchievementId } from "./achievementCatalog";
import "./achievementPotion2.css";

/*
 * Direction 2, measured glassware. Every achievement is one piece of laboratory
 * glass, and the reward is the liquid level: each milestone raises it to the next
 * graduation on the glass (1, 5, 10, 25, 50, 100 times), and a one-time
 * achievement stands filled exactly to its single mark. Liquid colour says what
 * the time was made of: focus green, dawn, night, weekend teal, kept-up gold,
 * drift coral, still blue. Locked glass is dry with a dashed line where the
 * liquid will stand; a hidden one is covered by a cloth.
 */

type Span = readonly [number, number];
type Line = readonly [number, number, number, number];
type PartKind = "glass" | "line" | "legs" | "bold" | "cork" | "cap" | "board" | "floor";
type Part = readonly [PartKind, string];

type Vessel = {
  /** Closed interior: tints the glass and clips the liquid. */
  readonly body: string;
  /** The glass edge as drawn, open at the mouth. */
  readonly outline: string;
  readonly parts?: readonly Part[];
  readonly shine: string;
  /** Lowest point inside the glass. */
  readonly bottom: number;
  /** Six graduations for a repeatable achievement, the single mark for a one-time one. */
  readonly levels: readonly number[];
  /** Where the liquid stands when it does not follow the graduations. */
  readonly fixedLevel?: number;
  readonly spans: (y: number) => readonly Span[];
  /** Explicit graduation strokes; by default they hug the left contour at each level. */
  readonly ticks?: readonly Line[];
  readonly minorTicks?: readonly Line[];
  readonly labels?: boolean;
  /** Mark line and label of a one-time achievement. */
  readonly mark?: { readonly line: Line; readonly label: string; readonly at: readonly [number, number]; readonly size: number };
  readonly flat?: boolean;
  /** Where the entrance stream falls; null when the vessel is not filled from above. */
  readonly pour: number | null;
  readonly ground?: readonly [number, number, number];
};

const COUNTS = ["1", "5", "10", "25", "50", "100"] as const;
const BUBBLES = [0, 1, 1, 2, 2, 3, 4] as const;

const walls = (...spans: Span[]) => (): readonly Span[] => spans;

function round(cx: number, cy: number, r: number, neckBottom: number, neck: Span) {
  return (y: number): readonly Span[] => {
    if (y <= neckBottom) return [neck];
    const half = Math.sqrt(Math.max(r * r - (y - cy) * (y - cy), 0));
    return [[cx - half, cx + half]];
  };
}

function tubes(lefts: readonly number[], width: number, top: number, end: number) {
  const r = width / 2;
  return {
    body: lefts.map((x) => `M${x} ${top} V${end} A${r} ${r} 0 0 0 ${x + width} ${end} V${top} Z`).join(" "),
    outline: lefts.map((x) => `M${x - 1.6} ${top - 1.6} Q${x} ${top - 1.1} ${x} ${top + 1} V${end} A${r} ${r} 0 0 0 ${x + width} ${end} V${top + 1} Q${x + width} ${top - 1.1} ${x + width + 1.6} ${top - 1.6}`).join(" "),
    spans: walls(...lefts.map((x): Span => [x, x + width])),
  };
}

const RACK = [15, 25.5, 36, 46.5, 57, 67.5, 78];
const rack = tubes(RACK, 7, 22, 80);
const pair = tubes([28, 56], 16, 13, 80);

const VESSELS: Record<AchievementId, Vessel> = {
  firstFlow: {
    body: "M38 11 V78 A12 12 0 0 0 62 78 V11 Z",
    outline: "M35.5 9 Q38 9.5 38 12 V78 A12 12 0 0 0 62 78 V12 Q62 9.5 64.5 9",
    shine: "M42.5 17 V74",
    bottom: 90,
    levels: [42],
    spans: walls([38, 62]),
    mark: { line: [33, 42, 67, 42], label: "25", at: [31.5, 44.2], size: 7 },
    pour: 50,
    ground: [50, 93, 9],
  },
  flow90: {
    body: "M24 20 V81 Q24 86 29 86 H71 Q76 86 76 81 V20 Z",
    outline: "M19.5 17 Q24 17.5 24 22 V81 Q24 86 29 86 H71 Q76 86 76 81 V21 Q76 19 78 18.5",
    shine: "M29.5 26 V78",
    bottom: 86,
    levels: [76, 69, 62, 54, 46, 37],
    spans: walls([24, 76]),
    pour: 50,
    ground: [50, 88.5, 28],
  },
  flow180: {
    body: "M40 9 V84 H60 V9 Z",
    outline: "M37 6.5 Q40 7 40 10 V84 M60 84 V9.5 Q60 8 61.5 7.5",
    parts: [["glass", "M30 84 H70 Q72.5 84 72.5 86.5 Q72.5 89 70 89 H30 Q27.5 89 27.5 86.5 Q27.5 84 30 84 Z"]],
    shine: "M44 14 V80",
    bottom: 84,
    levels: [74, 63, 52, 41, 30, 19],
    spans: walls([40, 60]),
    minorTicks: Array.from({ length: 16 }, (_, i): Line => [56.5, 80 - i * 4, 60, 80 - i * 4]),
    pour: 50,
    ground: [50, 91, 22],
  },
  focusDay8h: {
    body: "M46 9 V45.4 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 54 45.4 V9 Z",
    outline: "M44 7 Q46 7.5 46 10 V45.4 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 54 45.4 V10 Q54 7.5 56 7",
    shine: "M35.5 57 Q33 66 37 76",
    bottom: 85,
    levels: [43, 38, 33, 28, 23, 18],
    spans: round(50, 66, 21, 45.4, [46, 54]),
    ticks: [43, 38, 33, 28, 23].map((y): Line => [56, y, 60.5, y]).concat([[44, 18, 62, 18]]),
    pour: 50,
    ground: [50, 87.5, 14],
  },
  earlyStart: {
    body: "M43 13 V36 L19.8 81.5 Q18 86 22.5 86 H77.5 Q82 86 80.2 81.5 L57 36 V13 Z",
    outline: "M40.5 11 Q43 11.5 43 14 V36 L19.8 81.5 Q18 86 22.5 86 H77.5 Q82 86 80.2 81.5 L57 36 V14 Q57 11.5 59.5 11",
    shine: "M39.5 45 L28 69",
    bottom: 86,
    levels: [77, 70, 63, 56, 49, 42],
    spans: (y) => {
      if (y <= 36) return [[43, 57]];
      const t = Math.min((y - 36) / 45.5, 1);
      return [[43 - 23.2 * t, 57 + 23.2 * t]];
    },
    pour: 50,
    ground: [50, 88.5, 32],
  },
  nightOwl: {
    body: "M44 11 V37.7 A25 25 0 1 0 56 37.7 V11 Z",
    outline: "M41.5 9 Q44 9.5 44 12 V37.7 A25 25 0 1 0 56 37.7 V12 Q56 9.5 58.5 9",
    parts: [["cork", "M37 84.5 Q50 81.5 63 84.5 L64.5 89.5 Q50 92 35.5 89.5 Z"]],
    shine: "M31 50 Q27.5 60 31 71",
    bottom: 87,
    levels: [77, 71, 65, 59, 53, 47],
    spans: round(50, 62, 25, 37.7, [44, 56]),
    pour: 50,
  },
  weekendShift: {
    body: pair.body,
    outline: pair.outline,
    parts: [["line", "M44 29 H56 M44 33 H56"]],
    shine: "M32 18 V76 M60 18 V76",
    bottom: 88,
    levels: [76, 68, 60, 52, 44, 36],
    spans: pair.spans,
    pour: 36,
    ground: [50, 91, 26],
  },
  streak7: {
    body: rack.body,
    outline: rack.outline,
    parts: [["legs", "M12 38 V86 M88 38 V86"], ["floor", "M7 86.5 H93"], ["board", "M11 32.5 H89 Q90.5 32.5 90.5 34 V36.5 Q90.5 38 89 38 H11 Q9.5 38 9.5 36.5 V34 Q9.5 32.5 11 32.5 Z"]],
    shine: "",
    bottom: 83.5,
    levels: [74, 68, 62, 56, 50, 44],
    spans: rack.spans,
    ticks: [74, 68, 62, 56, 50, 44].map((y): Line => [10, y, 5, y]),
    labels: false,
    pour: 50,
  },
  streak30: {
    body: "M46 7 V73 L48.6 77 H51.4 L54 73 V7 Z",
    outline: "M44.5 5.5 Q46 6 46 8 V73 L48.6 77 M51.4 77 L54 73 V8 Q54 6 55.5 5.5",
    parts: [
      ["line", "M24 9 V88.5 M24 22 H45"],
      ["floor", "M15 89 H41"],
      ["glass", "M46.5 77 H53.5 V82 H46.5 Z M48.6 82 L49.6 92 H50.4 L51.4 82"],
      ["bold", "M39.5 79.5 H60.5"],
    ],
    shine: "M48.6 12 V68",
    bottom: 77,
    levels: [66, 56, 46, 36, 26, 16],
    spans: walls([46, 54]),
    ticks: [66, 56, 46, 36, 26, 16].map((y): Line => [56, y, 62, y]),
    minorTicks: Array.from({ length: 30 }, (_, i): Line => [56, 71 - i * 2, 58.5, 71 - i * 2]),
    pour: 50,
  },
  focus100h: {
    body: "M38 17 V25 Q38 30 30 32 L22 34.5 Q14 37 14 46 V80 Q14 88 22 88 H66 Q74 88 74 80 V46 Q74 37 66 34.5 L58 32 Q50 30 50 25 V17 Z",
    outline: "M36 15 Q38 15.5 38 18 V25 Q38 30 30 32 L22 34.5 Q14 37 14 46 V80 Q14 88 22 88 H66 Q74 88 74 80 V46 Q74 37 66 34.5 L58 32 Q50 30 50 25 V18 Q50 15.5 52 15",
    parts: [["line", "M74 44 Q89 44 89 58 Q89 72 74 72 M74 50 Q83 50 83 58 Q83 66 74 66"]],
    shine: "M19.5 52 V79",
    bottom: 88,
    levels: [47],
    spans: walls([14, 74]),
    ticks: [77, 67, 57].map((y): Line => [12, y, 8, y]),
    mark: { line: [9, 47, 79, 47], label: "100", at: [19, 43.6], size: 8 },
    pour: 44,
    ground: [46, 90.5, 32],
  },
  driftDay: {
    body: "M66 46 H19 Q14 46 14 51 V77 Q14 82 19 82 H66 Z",
    outline: "M68 43.6 Q66 44.2 66 46.5 V46 H19 Q14 46 14 51 V77 Q14 82 19 82 H66",
    parts: [["floor", "M6 82 H94"]],
    shine: "M20 51 H60",
    bottom: 82,
    levels: [22, 29, 36, 43, 50, 57],
    fixedLevel: 74,
    spans: walls([14, 66]),
    ticks: [22, 29, 36, 43, 50, 57].map((x): Line => [x, 43.5, x, 38.5]),
    labels: false,
    pour: null,
  },
  noDriftDay: {
    body: "M40 17 V24 Q40 28 32 30 Q22 33 22 42 V81 Q22 86 27 86 H73 Q78 86 78 81 V42 Q78 33 68 30 Q60 28 60 24 V17 Z",
    outline: "M40 17 V24 Q40 28 32 30 Q22 33 22 42 V81 Q22 86 27 86 H73 Q78 86 78 81 V42 Q78 33 68 30 Q60 28 60 24 V17",
    parts: [["cap", "M37.5 9 Q37.5 7.5 39 7.5 H61 Q62.5 7.5 62.5 9 V18.5 H37.5 Z"]],
    shine: "M27.5 46 V79",
    bottom: 86,
    levels: [77, 70, 63, 56, 49, 42],
    spans: walls([22, 78]),
    flat: true,
    pour: null,
    ground: [50, 88.5, 28],
  },
  comeback: {
    body: "M44 37 V45.9 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 56 45.9 V37 Z M27 12 L46.8 31 V44 H53.2 V31 L73 12 Z",
    outline: "M42 35.5 Q44 36 44 38 V45.9 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 56 45.9 V38 Q56 36 58 35.5 M27 12 L46.8 31 V44 M53.2 44 V31 L73 12 M27 12 Q50 15.5 73 12",
    shine: "M35.5 57 Q33 66 37 76",
    bottom: 85,
    levels: [77, 72, 67, 62, 56, 50],
    spans: round(50, 66, 21, 45.9, [44, 56]),
    pour: null,
    ground: [50, 87.5, 14],
  },
};

/** Graduation strokes: explicit, or hugging the left contour of the glass at each level. */
function graduations(vessel: Vessel): { major: readonly Line[]; minor: readonly Line[] } {
  const hug = (y: number, length: number): Line => {
    const x = vessel.spans(y)[0][0] - 2;
    return [x, y, x - length, y];
  };
  const major = vessel.ticks ?? vessel.levels.map((y) => hug(y, 5));
  const minor = vessel.minorTicks ?? (vessel.ticks || vessel.levels.length < 2 ? [] : vessel.levels.slice(1).map((y, i) => hug((y + vessel.levels[i]) / 2, 2.6)));
  return { major, minor };
}

function rise(amount: number): CSSProperties {
  return { "--p2-rise": `${amount}px` } as CSSProperties;
}

function order(index: number): CSSProperties {
  return { "--p2-i": index } as CSSProperties;
}

/** Wisps of drift rising off the spilled puddle. */
function vapour(count: number) {
  const starts: readonly (readonly [number, number])[] = [[76, 78], [83, 76], [70, 74], [88.5, 72]];
  return starts.slice(0, count).map(([x, y], i) => (
    <path key={i} className="p2-vapour p2-late" style={order(i)} d={`M${x} ${y} c -2.4 -3 2.4 -5.5 0 -8.5 s 2.4 -5.5 0 -8.5`} />
  ));
}

export function AchievementPotion2({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = useId().replace(/:/g, "");
  const clipId = `p2-clip-${uid}`;
  const fillId = `p2-fill-${uid}`;
  const moonId = `p2-moon-${uid}`;
  const className = ["potion2", `potion2--${state}`, detail ? "" : "potion2--compact", entrance && state === "earned" ? "potion2--enter" : ""].filter(Boolean).join(" ");

  if (state === "concealed") {
    return (
      <svg className={className} viewBox="0 0 100 100" data-group={group} aria-hidden="true" focusable="false">
        <ellipse className="p2-ground" cx="50" cy="89.5" rx="16" ry="2.2" />
        <path className="p2-frost" d="M44 14 V37 A25 25 0 1 0 56 37 V14 Z" />
        {detail ? <path className="p2-haze" d="M33 70 Q41 66 49 70 T65 70 M36 78 Q44 74 52 78 T66 77" /> : null}
        <path className="p2-edge" d="M44 14 V37 A25 25 0 1 0 56 37 V14" />
        <path className="p2-foil" d="M41.5 10.5 Q41.5 7.5 44.5 7.5 H55.5 Q58.5 7.5 58.5 10.5 L59.5 26.5 L57.2 29.2 L54.8 27 L52.4 29.6 L50 27.2 L47.6 29.6 L45.2 27 L42.8 29.2 L40.5 26.5 Z" />
        {detail ? <path className="p2-fold" d="M45.5 10 L44.5 25 M50 9.5 V25.5 M54.5 10 L55.5 25 M42 15.5 H58" /> : null}
        <path className="p2-etch" d="M44.6 56.5 Q44.6 50.8 50 50.8 Q55.4 50.8 55.4 55.8 Q55.4 59.2 50.8 61 V64.6 M50.8 70 V70.2" />
      </svg>
    );
  }

  const vessel = VESSELS[id];
  const earned = state === "earned";
  const repeatable = vessel.levels.length > 1;
  const step = repeatable ? Math.min(Math.max(tier, 1), 6) : 1;
  const level = vessel.fixedLevel ?? vessel.levels[step - 1];
  const target = vessel.fixedLevel ?? vessel.levels[0];
  const { major, minor } = graduations(vessel);
  const reached = earned ? (repeatable ? step : major.length) : 0;
  const bubbles = earned && detail && !vessel.fixedLevel ? (repeatable ? BUBBLES[step] : 3) : 0;
  const surfaces = vessel.spans(level);
  const targetSpans = vessel.spans(target);

  const bubbleMarks: ReactNode[] = [];
  const room = vessel.bottom - 4 - (level + 4);
  if (room > 4) {
    for (let k = 0; k < bubbles; k += 1) {
      const y = vessel.bottom - 5 - (k * room) / Math.max(bubbles, 1);
      const spans = vessel.spans(y);
      const [x0, x1] = spans[k % spans.length];
      const x = x0 + (x1 - x0) * [0.62, 0.36, 0.7, 0.45][k];
      bubbleMarks.push(<circle key={k} className="p2-bubble" cx={x} cy={y} r={[1.5, 1.1, 1.3, 0.9][k]} />);
    }
  }

  const labelTick = repeatable && detail && earned && vessel.labels !== false ? major[step - 1] : null;
  const labelLeft = labelTick ? labelTick[2] < labelTick[0] : false;

  const pourStream = earned && entrance && vessel.pour !== null;
  const funnelSpan: Span = [37.4, 62.6];

  return (
    <svg className={className} viewBox="0 0 100 100" data-id={id} data-group={group} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <path d={vessel.body} />
        </clipPath>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop className="p2-stop-top" offset="0" />
          <stop className="p2-stop-bottom" offset="1" />
        </linearGradient>
        {id === "nightOwl" ? (
          <mask id={moonId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <rect width="100" height="100" fill="white" />
            <circle cx="58.4" cy={Math.min(level + 9, 80) - 1} r="2.5" fill="black" />
          </mask>
        ) : null}
      </defs>

      {vessel.ground ? <ellipse className="p2-ground" cx={vessel.ground[0]} cy={vessel.ground[1]} rx={vessel.ground[2]} ry="2.2" /> : null}
      <path className="p2-glass" d={vessel.body} />

      {pourStream ? <rect className="p2-stream" x={(vessel.pour ?? 50) - 0.9} y="1" width="1.8" height={vessel.bottom - 1} rx="0.9" /> : null}
      {earned && id === "comeback" ? <rect className="p2-stream p2-stream--steady" x="49.2" y="32" width="1.6" height={level - 32} rx="0.8" /> : null}

      {earned ? (
        <g clipPath={`url(#${clipId})`}>
          <g className="p2-liquid" style={rise(vessel.bottom - level + 6)}>
            <rect className="p2-body" x="0" y={level} width="100" height={vessel.bottom - level + 1} fill={`url(#${fillId})`} />
            {vessel.flat
              ? surfaces.map(([x0, x1], i) => <line key={i} className="p2-flat" x1={x0} y1={level} x2={x1} y2={level} />)
              : surfaces.map(([x0, x1], i) => (
                <ellipse key={i} className="p2-surface" cx={(x0 + x1) / 2} cy={level} rx={(x1 - x0) / 2} ry={Math.min(1.7, (x1 - x0) * 0.09)} />
              ))}
            {bubbleMarks}
            {id === "nightOwl" && detail ? <circle className="p2-moon" cx="57" cy={Math.min(level + 9, 80)} r="3" mask={`url(#${moonId})`} /> : null}
          </g>
          {id === "comeback" ? (
            <g>
              <rect x="20" y="22" width="60" height="11" fill={`url(#${fillId})`} />
              <ellipse className="p2-surface" cx="50" cy="22" rx={(funnelSpan[1] - funnelSpan[0]) / 2} ry="1.6" />
            </g>
          ) : null}
        </g>
      ) : null}

      {earned && id === "driftDay" ? (
        <g className="p2-late">
          <path className="p2-spill" d={`M64 74 H66 C69.5 74 70 77.5 70.6 80.4 Q71 82 73 82 H${80 + step * 2} Q${83 + step * 2} 82 ${83 + step * 2} 83.4 Q${83 + step * 2} 84.8 ${80 + step * 2} 84.8 H62 Q60.5 84.8 60.5 83.4 Q60.5 82 62 82 H66 Z`} />
          {detail ? vapour([1, 1, 2, 2, 3, 4][step - 1]) : null}
        </g>
      ) : null}

      {detail && vessel.shine ? <path className="p2-shine" d={vessel.shine} /> : null}
      <path className="p2-edge" d={vessel.outline} />
      {vessel.parts?.map(([kind, d], i) => <path key={i} className={`p2-part p2-part--${kind}`} d={d} />)}

      {detail ? (
        <g className="p2-scale">
          {minor.map(([x1, y1, x2, y2], i) => <line key={`m${i}`} className="p2-tick p2-tick--minor" x1={x1} y1={y1} x2={x2} y2={y2} />)}
          {major.map(([x1, y1, x2, y2], i) => (
            <line key={i} className={i < reached ? "p2-tick p2-tick--on" : "p2-tick"} style={order(i)} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {labelTick ? (
            <text className="p2-label p2-late" x={labelLeft ? labelTick[2] - 1.4 : labelTick[2] + 1.4} y={labelTick[1] + 2.1} fontSize="6" textAnchor={labelLeft ? "end" : "start"}>
              {COUNTS[step - 1]}
            </text>
          ) : null}
        </g>
      ) : null}

      {vessel.mark ? (
        <g className={earned ? "p2-mark p2-mark--on" : "p2-mark"}>
          <line x1={vessel.mark.line[0]} y1={vessel.mark.line[1]} x2={vessel.mark.line[2]} y2={vessel.mark.line[3]} />
          {detail ? <text x={vessel.mark.at[0]} y={vessel.mark.at[1]} fontSize={vessel.mark.size} textAnchor={id === "firstFlow" ? "end" : "start"}>{vessel.mark.label}</text> : null}
        </g>
      ) : null}

      {earned && id === "noDriftDay" && detail ? (
        <g className="p2-late">
          <ellipse className="p2-level-bubble" cx="50" cy={level + 2.6} rx="4.4" ry="1.6" />
          <path className="p2-level-mark" d={`M44 ${level - 3} V${level + 6} M56 ${level - 3} V${level + 6}`} />
        </g>
      ) : null}

      {!earned && !vessel.mark ? (
        <line className="p2-target" x1={targetSpans[0][0] - 2} y1={target} x2={targetSpans[targetSpans.length - 1][1] + 2} y2={target} />
      ) : null}
    </svg>
  );
}
