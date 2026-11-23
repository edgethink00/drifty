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
  /** Lip that turns gold at the top milestone and on a completed one-time achievement. */
  readonly rim: string;
  /** Graduations hug the right contour instead of the left. */
  readonly side?: "right";
  /** Where the entrance stream falls; null when the vessel is not filled from above. */
  readonly pour: number | null;
  readonly ground?: readonly [number, number, number];
  /** Bounds of the drawing (x0, y0, x1, y1), scaled so the glass fills about 86% of the box. */
  readonly frame: readonly [number, number, number, number];
};

function frameSize([x0, y0, x1, y1]: readonly [number, number, number, number]): number {
  return Math.max((y1 - y0) / 0.86, (x1 - x0) / 0.96);
}

function viewBox([x0, y0, x1, y1]: readonly [number, number, number, number]): string {
  const size = frameSize([x0, y0, x1, y1]);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return `${round1((x0 + x1 - size) / 2)} ${round1((y0 + y1 - size) / 2)} ${round1(size)} ${round1(size)}`;
}

const COUNTS = ["1", "5", "10", "25", "50", "100"] as const;
const FILL = [0.42, 0.52, 0.62, 0.72, 0.82, 0.92] as const;
const ladder = (bottom: number, top: number) => FILL.map((share) => Math.round((bottom - (bottom - top) * share) * 10) / 10);
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
const rackSmall = tubes([17, 35, 53, 71], 12, 24, 72);
const RACK_LEVELS = ladder(83.5, 40);
const BURETTE_LEVELS = ladder(77, 8);

const VESSELS: Record<AchievementId, Vessel> = {
  firstFlow: {
    frame: [24, 8.5, 70, 93],
    body: "M38 11 V78 A12 12 0 0 0 62 78 V11 Z",
    outline: "M35.5 9 Q38 9.5 38 12 V78 A12 12 0 0 0 62 78 V12 Q62 9.5 64.5 9",
    shine: "M42.5 17 V74",
    bottom: 90,
    levels: [23],
    spans: walls([38, 62]),
    mark: { line: [33, 23, 67, 23], label: "25", at: [31.5, 25.4], size: 7.5 },
    rim: "M37 10 H63",
    pour: 50,
    ground: [50, 93, 9],
  },
  flow90: {
    frame: [12, 17, 80, 89],
    body: "M24 20 V81 Q24 86 29 86 H71 Q76 86 76 81 V20 Z",
    outline: "M19.5 17 Q24 17.5 24 22 V81 Q24 86 29 86 H71 Q76 86 76 81 V21 Q76 19 78 18.5",
    shine: "M29.5 26 V78",
    bottom: 86,
    levels: ladder(86, 20),
    rim: "M20.5 18 H77",
    spans: walls([24, 76]),
    pour: 50,
    ground: [50, 88.5, 28],
  },
  flow180: {
    frame: [24, 6.5, 74, 91],
    body: "M40 9 V84 H60 V9 Z",
    outline: "M37 6.5 Q40 7 40 10 V84 M60 84 V9.5 Q60 8 61.5 7.5",
    parts: [["glass", "M30 84 H70 Q72.5 84 72.5 86.5 Q72.5 89 70 89 H30 Q27.5 89 27.5 86.5 Q27.5 84 30 84 Z"]],
    shine: "M44 14 V80",
    bottom: 84,
    levels: ladder(84, 9),
    rim: "M38 7.8 H61",
    spans: walls([40, 60]),
    minorTicks: Array.from({ length: 16 }, (_, i): Line => [56.5, 80 - i * 4, 60, 80 - i * 4]),
    pour: 50,
    ground: [50, 91, 22],
  },
  focusDay8h: {
    frame: [28, 7, 72, 88],
    body: "M46 9 V45.4 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 54 45.4 V9 Z",
    outline: "M44 7 Q46 7.5 46 10 V45.4 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 54 45.4 V10 Q54 7.5 56 7",
    shine: "M35.5 57 Q33 66 37 76",
    bottom: 85,
    levels: ladder(85, 10),
    spans: round(50, 66, 21, 45.4, [46, 54]),
    side: "right",
    rim: "M44.5 8 H55.5",
    pour: 50,
    ground: [50, 87.5, 14],
  },
  earlyStart: {
    frame: [8, 11, 84, 89],
    body: "M43 13 V36 L19.8 81.5 Q18 86 22.5 86 H77.5 Q82 86 80.2 81.5 L57 36 V13 Z",
    outline: "M40.5 11 Q43 11.5 43 14 V36 L19.8 81.5 Q18 86 22.5 86 H77.5 Q82 86 80.2 81.5 L57 36 V14 Q57 11.5 59.5 11",
    shine: "M39.5 45 L28 69",
    bottom: 86,
    levels: ladder(86, 28),
    rim: "M41.5 12 H58.5",
    spans: (y) => {
      if (y <= 36) return [[43, 57]];
      const t = Math.min((y - 36) / 45.5, 1);
      return [[43 - 23.2 * t, 57 + 23.2 * t]];
    },
    pour: 50,
    ground: [50, 88.5, 32],
  },
  nightOwl: {
    frame: [18, 9, 76, 91],
    body: "M44 11 V37.7 A25 25 0 1 0 56 37.7 V11 Z",
    outline: "M41.5 9 Q44 9.5 44 12 V37.7 A25 25 0 1 0 56 37.7 V12 Q56 9.5 58.5 9",
    parts: [["cork", "M37 84.5 Q50 81.5 63 84.5 L64.5 89.5 Q50 92 35.5 89.5 Z"]],
    shine: "M31 50 Q27.5 60 31 71",
    bottom: 87,
    levels: ladder(87, 30),
    rim: "M42.5 10 H57.5",
    spans: round(50, 62, 25, 37.7, [44, 56]),
    pour: 50,
  },
  weekendShift: {
    frame: [14, 11, 76, 91],
    body: pair.body,
    outline: pair.outline,
    parts: [["line", "M44 29 H56 M44 33 H56"]],
    shine: "M32 18 V76 M60 18 V76",
    bottom: 88,
    levels: ladder(88, 14),
    rim: "M26.5 12 H45.5 M54.5 12 H73.5",
    spans: pair.spans,
    pour: 36,
    ground: [50, 91, 26],
  },
  streak7: {
    frame: [4, 20, 94, 87],
    body: rack.body,
    outline: rack.outline,
    parts: [["legs", "M12 38 V86 M88 38 V86"], ["floor", "M7 86.5 H93"], ["board", "M11 32.5 H89 Q90.5 32.5 90.5 34 V36.5 Q90.5 38 89 38 H11 Q9.5 38 9.5 36.5 V34 Q9.5 32.5 11 32.5 Z"]],
    shine: "",
    bottom: 83.5,
    levels: RACK_LEVELS,
    spans: rack.spans,
    ticks: RACK_LEVELS.map((y): Line => [10, y, 5, y]),
    rim: "M11 32.5 H89",
    labels: false,
    pour: 50,
  },
  streak30: {
    frame: [15, 5.5, 75, 92],
    body: "M46 7 V73 L48.6 77 H51.4 L54 73 V7 Z",
    outline: "M44.5 5.5 Q46 6 46 8 V73 L48.6 77 M51.4 77 L54 73 V8 Q54 6 55.5 5.5",
    parts: [
      ["legs", "M24 9 V88.5 M24 22 H45"],
      ["floor", "M15 89 H41"],
      ["glass", "M46.5 77 H53.5 V82 H46.5 Z M48.6 82 L49.6 92 H50.4 L51.4 82"],
      ["bold", "M39.5 79.5 H60.5"],
    ],
    shine: "M48.6 12 V68",
    bottom: 77,
    levels: BURETTE_LEVELS,
    spans: walls([46, 54]),
    ticks: BURETTE_LEVELS.map((y): Line => [56, y, 62, y]),
    rim: "M45 6.5 H55",
    minorTicks: Array.from({ length: 30 }, (_, i): Line => [56, 71 - i * 2, 58.5, 71 - i * 2]),
    pour: 50,
  },
  focus100h: {
    frame: [10, 9, 92, 91],
    body: "M44 12 V22 Q44 27 36 29.5 L26 32.5 Q18 35 18 44 V80 Q18 88 26 88 H74 Q82 88 82 80 V44 Q82 35 74 32.5 L64 29.5 Q56 27 56 22 V12 Z",
    outline: "M42 10 Q44 10.5 44 13 V22 Q44 27 36 29.5 L26 32.5 Q18 35 18 44 V80 Q18 88 26 88 H74 Q82 88 82 80 V44 Q82 35 74 32.5 L64 29.5 Q56 27 56 22 V13 Q56 10.5 58 10",
    parts: [["glass", "M82 76 H87.5 Q89 76 89 77.5 V79.5 Q89 81 87.5 81 H82"], ["bold", "M86 76 V72.5"]],
    shine: "M23.5 50 V80",
    bottom: 88,
    levels: [43],
    spans: walls([18, 82]),
    ticks: [77, 67, 57].map((y): Line => [16, y, 12, y]),
    mark: { line: [14, 43, 86, 43], label: "100", at: [23, 39.8], size: 8 },
    rim: "M43 11 H57",
    pour: 50,
    ground: [50, 90.5, 34],
  },
  driftDay: {
    frame: [6, 38, 94, 85],
    body: "M66 46 H19 Q14 46 14 51 V77 Q14 82 19 82 H66 Z",
    outline: "M68 43.6 Q66 44.2 66 46.5 V46 H19 Q14 46 14 51 V77 Q14 82 19 82 H66",
    parts: [["floor", "M6 82 H94"]],
    shine: "M20 51 H60",
    bottom: 82,
    levels: [22, 29, 36, 43, 50, 57],
    fixedLevel: 64,
    rim: "M67.2 45 V82.5",
    spans: walls([14, 66]),
    ticks: [22, 29, 36, 43, 50, 57].map((x): Line => [x, 43.5, x, 38.5]),
    labels: false,
    pour: null,
  },
  noDriftDay: {
    frame: [10, 34, 100, 82],
    body: "M27 34 H73 A15 15 0 0 1 73 64 H27 A15 15 0 0 1 27 34 Z",
    outline: "M27 34 H73 A15 15 0 0 1 73 64 H27 A15 15 0 0 1 27 34 Z",
    parts: [["line", "M33 64 V72 M67 64 V72"], ["board", "M18 72 H82 Q84 72 84 74 V77 Q84 79 82 79 H18 Q16 79 16 77 V74 Q16 72 18 72 Z"]],
    shine: "M27 38.5 H70",
    bottom: 64,
    levels: ladder(64, 34),
    spans: (y) => {
      const half = Math.sqrt(Math.max(225 - (y - 49) * (y - 49), 0));
      return [[27 - half, 73 + half]];
    },
    side: "right",
    flat: true,
    rim: "M17 72 H83",
    pour: null,
    ground: [50, 81.5, 32],
  },
  comeback: {
    frame: [22, 10, 78, 88],
    body: "M44 37 V45.9 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 56 45.9 V37 Z M27 12 L46.8 31 V44 H53.2 V31 L73 12 Z",
    outline: "M42 35.5 Q44 36 44 38 V45.9 A21 21 0 0 0 41.06 85 H58.94 A21 21 0 0 0 56 45.9 V38 Q56 36 58 35.5 M27 12 L46.8 31 V44 M53.2 44 V31 L73 12 M27 12 Q50 15.5 73 12",
    shine: "M35.5 57 Q33 66 37 76",
    bottom: 85,
    levels: ladder(85, 42),
    rim: "M27 12 Q50 15.5 73 12",
    spans: round(50, 66, 21, 45.9, [44, 56]),
    pour: null,
    ground: [50, 87.5, 14],
  },
};

/** Etched identity marks: a glyph in a 10-unit box, and where it sits on each vessel (x, y, scale). */
const ETCH: Partial<Record<AchievementId, { readonly d: string; readonly dots?: readonly (readonly [number, number])[]; readonly at: readonly [number, number, number] }>> = {
  firstFlow: { d: "M-4 4 Q-4.4 -4 4 -4 Q4.4 4 -4 4 Z M-4 4 L1.2 -1.2", at: [50, 60, 0.9] },
  flow90: { d: "M-4 4 V-4 A8 8 0 0 1 4 4 Z", at: [62, 32, 0.9] },
  flow180: { d: "M0 -4.5 A4.5 4.5 0 1 1 -0.01 -4.5 M0 -2.6 V0 H2.6", at: [49.5, 24, 0.85] },
  focusDay8h: { d: "M2 0 A2 2 0 1 1 -2 0 A2 2 0 1 1 2 0 M0 -3.6 V-5 M0 3.6 V5 M-3.6 0 H-5 M3.6 0 H5 M2.6 -2.6 L3.5 -3.5 M-2.6 -2.6 L-3.5 -3.5 M2.6 2.6 L3.5 3.5 M-2.6 2.6 L-3.5 3.5", at: [50, 70, 0.95] },
  earlyStart: { d: "M-5 2.5 H5 M-3 2.5 A3 3 0 0 1 3 2.5 M0 -2.2 V-4 M-3.4 -0.9 L-4.6 -2.1 M3.4 -0.9 L4.6 -2.1", at: [50, 49, 0.95] },
  weekendShift: { d: "M-4 3.5 H4", dots: [[-2, -0.5], [2, -0.5]], at: [56, 70, 0.85] },
  streak7: { d: "M-6 -1.5 V1.5 M-4 -1.5 V1.5 M-2 -1.5 V1.5 M0 -1.5 V1.5 M2 -1.5 V1.5 M4 -1.5 V1.5 M6 -1.5 V1.5", at: [50, 35.6, 0.85] },
  streak30: { d: "M-3.5 -2.5 H3.5 V4 H-3.5 Z M-3.5 -0.4 H3.5 M-1.6 -4 V-1.6 M1.6 -4 V-1.6", at: [50, 30, 0.62] },
  driftDay: { d: "M-5 -1.5 Q-2.5 -4 0 -1.5 T5 -1.5 M-5 2 Q-2.5 -0.5 0 2 T5 2", at: [38, 54, 0.9] },
  comeback: { d: "M-3 -3 H1 A3 3 0 0 1 1 3 H-3 M-1.4 -4.6 L-3 -3 L-1.4 -1.4", at: [50, 72, 0.9] },
};

function etching(id: AchievementId): ReactNode {
  const etch = ETCH[id];
  if (!etch) return null;
  const [x, y, k] = etch.at;
  const glyph = (cls: string) => (
    <g className={cls}>
      <path d={etch.d} vectorEffect="non-scaling-stroke" />
      {etch.dots?.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="1.1" vectorEffect="non-scaling-stroke" />)}
    </g>
  );
  return (
    <g className="p2-etch-mark" transform={`translate(${x} ${y}) scale(${k})`}>
      {glyph("p2-etch-halo")}
      {glyph("p2-etch-line")}
    </g>
  );
}

const STREAK7_COMPACT: Vessel = {
  ...VESSELS.streak7,
  body: rackSmall.body,
  outline: rackSmall.outline,
  parts: [["board", "M12 34 H88 Q89.5 34 89.5 35.5 V38.5 Q89.5 40 88 40 H12 Q10.5 40 10.5 38.5 V35.5 Q10.5 34 12 34 Z"]],
  spans: rackSmall.spans,
  bottom: 78,
  levels: ladder(78, 42),
  frame: [10, 22, 90, 80],
  rim: "M12 34 H88",
};

/** Graduation strokes: explicit, or hugging one contour of the glass at each level. */
function graduations(vessel: Vessel): { major: readonly Line[]; minor: readonly Line[] } {
  const hug = (y: number, length: number): Line => {
    const spans = vessel.spans(y);
    if (vessel.side === "right") {
      const x = spans[spans.length - 1][1] + 2;
      return [x, y, x + length, y];
    }
    const x = spans[0][0] - 2;
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
  const glassId = `p2-glassfill-${uid}`;
  const fillId = `p2-fill-${uid}`;
  const moonId = `p2-moon-${uid}`;
  const className = ["potion2", `potion2--${state}`, detail ? "" : "potion2--compact", entrance && state === "earned" ? "potion2--enter" : ""].filter(Boolean).join(" ");

  if (state === "concealed") {
    return (
      <svg className={className} viewBox={viewBox([24, 7.5, 76, 90])} data-group={group} aria-hidden="true" focusable="false">
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

  const vessel = !detail && id === "streak7" ? STREAK7_COMPACT : VESSELS[id];
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
  // Text keeps one rendered size whatever the vessel's frame scale.
  const textScale = frameSize(vessel.frame) / 100;
  const finish = earned && repeatable && step === 6;

  const pourStream = earned && entrance && vessel.pour !== null;
  const funnelSpan: Span = [37.4, 62.6];

  return (
    <svg className={className} viewBox={viewBox(vessel.frame)} data-id={id} data-group={group} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <path d={vessel.body} />
        </clipPath>
        <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="0">
          <stop className="p2-glass-wall" offset="0" />
          <stop className="p2-glass-mid" offset="0.5" />
          <stop className="p2-glass-wall" offset="1" />
        </linearGradient>
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

      {earned && detail ? <ellipse className="p2-glow p2-late" cx={(vessel.ground ?? [50])[0]} cy={(vessel.ground ?? [0, 89])[1]} rx={(vessel.ground ?? [0, 0, 22])[2] + 12} ry="4.5" /> : null}
      {vessel.ground ? <ellipse className="p2-ground" cx={vessel.ground[0]} cy={vessel.ground[1]} rx={vessel.ground[2]} ry="2.2" /> : null}
      <path className="p2-glass" d={vessel.body} style={{ fill: `url(#${glassId})` }} />
      {detail ? <path className="p2-inner-wall" d={vessel.body} clipPath={`url(#${clipId})`} /> : null}

      {pourStream ? <rect className="p2-stream" x={(vessel.pour ?? 50) - 0.9} y="1" width="1.8" height={vessel.bottom - 1} rx="0.9" /> : null}
      {earned && id === "comeback" ? <rect className="p2-stream p2-stream--steady" x="49.2" y="32" width="1.6" height={level - 32} rx="0.8" /> : null}

      {earned ? (
        <g clipPath={`url(#${clipId})`}>
          <g className="p2-liquid" style={rise(vessel.bottom - level + 6)}>
            <rect className="p2-body" x="0" y={level} width="100" height={vessel.bottom - level + 6} fill={`url(#${fillId})`} />
            {vessel.flat
              ? surfaces.map(([x0, x1], i) => <line key={i} className={finish ? "p2-gold-line" : "p2-flat"} x1={x0} y1={level} x2={x1} y2={level} />)
              : surfaces.map(([x0, x1], i) => (
                <g key={i}>
                  <ellipse className="p2-surface" cx={(x0 + x1) / 2} cy={level} rx={(x1 - x0) / 2} ry={Math.min(1.7, (x1 - x0) * 0.09)} />
                  {finish ? <line className="p2-gold-line" x1={x0 + 0.8} y1={level} x2={x1 - 0.8} y2={level} /> : null}
                  {detail ? <path className="p2-meniscus" d={`M${x0 + 0.6} ${level} A${(x1 - x0) / 2 - 0.6} ${Math.min(1.7, (x1 - x0) * 0.09)} 0 0 0 ${x1 - 0.6} ${level}`} /> : null}
                </g>
              ))}
            {bubbleMarks}
            {entrance && detail && !vessel.fixedLevel
              ? [0.3, 0.62, 0.46].map((share, i) => {
                const [x0, x1] = vessel.spans(vessel.bottom - 4)[i % surfaces.length];
                return <circle key={`r${i}`} className="p2-rising" style={{ ...order(i), ...rise(vessel.bottom - level - 6) }} cx={x0 + (x1 - x0) * share} cy={vessel.bottom - 4} r={1.3 - i * 0.2} />;
              })
              : null}
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
          <path className="p2-spill" d={`M64 ${level} H66 C70 ${level} 70.4 76 70.6 80.4 Q71 82 73 82 H${80 + step * 2} Q${83 + step * 2} 82 ${83 + step * 2} 83.4 Q${83 + step * 2} 84.8 ${80 + step * 2} 84.8 H62 Q60.5 84.8 60.5 83.4 Q60.5 82 62 82 H66 Z`} />
          {detail ? vapour([1, 1, 2, 2, 3, 4][step - 1]) : null}
        </g>
      ) : null}

      {detail && vessel.shine ? <path className="p2-shine" d={vessel.shine} /> : null}
      <path className="p2-edge" d={vessel.outline} />
      {vessel.parts?.map(([kind, d], i) => <path key={i} className={`p2-part p2-part--${kind}`} d={d} />)}
      {detail ? etching(id) : null}

      {detail ? (
        <g className="p2-scale">
          {minor.map(([x1, y1, x2, y2], i) => <line key={`m${i}`} className="p2-tick p2-tick--minor" x1={x1} y1={y1} x2={x2} y2={y2} />)}
          {major.map(([x1, y1, x2, y2], i) => (
            <line key={i} className={i < reached ? "p2-tick p2-tick--on" : "p2-tick"} style={order(i)} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {labelTick ? (
            <text className="p2-label p2-late" x={labelLeft ? labelTick[2] - 1.4 * textScale : labelTick[2] + 1.4 * textScale} y={labelTick[1] + 3.1 * textScale} fontSize={9 * textScale} textAnchor={labelLeft ? "end" : "start"}>
              {COUNTS[step - 1]}
            </text>
          ) : null}
        </g>
      ) : null}

      {vessel.mark ? (
        <g className={earned ? "p2-mark p2-mark--on" : "p2-mark"}>
          <line x1={vessel.mark.line[0]} y1={vessel.mark.line[1]} x2={vessel.mark.line[2]} y2={vessel.mark.line[3]} />
          {detail ? <text x={vessel.mark.at[0]} y={vessel.mark.at[1]} fontSize={9 * textScale} textAnchor={id === "firstFlow" ? "end" : "start"}>{vessel.mark.label}</text> : null}
        </g>
      ) : null}

      {earned && id === "noDriftDay" && detail ? (
        <g className="p2-late">
          <ellipse className="p2-level-bubble" cx="50" cy={level + 2.4} rx="5" ry="1.8" />
          <path className="p2-level-mark" d="M43 35 V63 M57 35 V63" />
        </g>
      ) : null}

      {earned && (step === 6 || !repeatable) ? <path className="p2-rim p2-late" d={vessel.rim} /> : null}

      {!earned && !vessel.mark ? (
        <line className="p2-target" x1={targetSpans[0][0] - 2} y1={target} x2={targetSpans[targetSpans.length - 1][1] + 2} y2={target} />
      ) : null}
    </svg>
  );
}
