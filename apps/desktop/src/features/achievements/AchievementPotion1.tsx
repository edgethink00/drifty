import { useId, type CSSProperties, type ReactNode } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";
import "./achievementPotion1.css";

/*
 * Direction 1, apothecary remedy bottles.
 *
 * Every achievement is its own remedy: the bottle silhouette and the mark on its
 * paper label carry identity, the liquid is what was earned. Milestones add
 * finishing touches one at a time: cork, wax seal, twine, gilt label rule,
 * hanging tag, then a gold foil capsule with a soft glow.
 *
 * Drawn in a 0..100 box. Upright bottles rest on y = 90.
 */

type MarkName =
  | "wave1" | "wave2" | "wave3" | "sun" | "sunrise" | "moon" | "dayLeft" | "dayRight"
  | "seven" | "calendar" | "hourglass" | "boat" | "level" | "rise";

type Label = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly oval?: boolean; readonly mark?: MarkName };

type Neck = { readonly x: number; readonly y: number; readonly w: number; readonly len: number; readonly angle?: number };

type Vessel = {
  readonly body: string;
  /** Liquid surface height and the glass span it crosses. */
  readonly level: number;
  readonly span: readonly [number, number];
  /** Lowest point of the inside, where a pour starts from. */
  readonly floor: number;
  readonly flat?: boolean;
  readonly neck: Neck;
  readonly label: Label;
  readonly shine: string;
  /** Hairline details on the glass: notches, ribs, old levels. */
  readonly etch?: string;
  readonly dashed?: boolean;
  readonly collar?: number;
  readonly stopper?: "cork" | "ball";
  /** Where the cork lies when it is not in the neck. */
  readonly corkAt?: { readonly x: number; readonly y: number; readonly angle: number };
  /** The vessel that carries the tag when there are two. */
  readonly secondary?: boolean;
};

type Design = {
  readonly mark: MarkName;
  readonly vessels: readonly Vessel[];
  readonly ground: { readonly cx: number; readonly w: number; readonly y?: number };
  readonly glow?: { readonly cx: number; readonly cy: number; readonly r: number };
  /** Width limit for a bottle lying down, which may run wider than upright ones. */
  readonly maxWidth?: number;
  readonly spill?: { readonly puddle: string; readonly trickle: string };
};

type BottleSpec = {
  readonly cx: number; readonly bw: number; readonly base: number;
  readonly nb: number; readonly s: number; readonly nw: number; readonly nt: number;
  readonly r: number; readonly shoulder: "round" | "cone" | "square" | "flask";
};

function bottle({ cx, bw, base, nb, s, nw, nt, r, shoulder }: BottleSpec): string {
  const xl = cx - bw / 2;
  const xr = cx + bw / 2;
  const nl = cx - nw / 2;
  const nr = cx + nw / 2;
  const se = nb + s;
  const curve = (xn: number, xb: number) => {
    switch (shoulder) {
      case "round": return `C${xn + (xb - xn) * 0.62} ${nb} ${xb} ${nb + s * 0.38} ${xb} ${se}`;
      case "cone": return `C${xn + (xb - xn) * 0.4} ${nb + s * 0.35} ${xb} ${nb + s * 0.7} ${xb} ${se}`;
      case "square": return `C${xb + (xn - xb) * 0.12} ${nb} ${xb} ${nb} ${xb} ${se}`;
      case "flask": return `C${xn} ${nb + 3} ${xb} ${nb + 3} ${xb} ${se}`;
    }
  };
  const back = (xn: number, xb: number) => {
    switch (shoulder) {
      case "round": return `C${xb} ${nb + s * 0.38} ${xn + (xb - xn) * 0.62} ${nb} ${xn} ${nb}`;
      case "cone": return `C${xb} ${nb + s * 0.7} ${xn + (xb - xn) * 0.4} ${nb + s * 0.35} ${xn} ${nb}`;
      case "square": return `C${xb} ${nb} ${xb + (xn - xb) * 0.12} ${nb} ${xn} ${nb}`;
      case "flask": return `C${xb} ${nb + 3} ${xn} ${nb + 3} ${xn} ${nb}`;
    }
  };
  return `M${nl} ${nt}V${nb}${curve(nl, xl)}V${base - r}Q${xl} ${base} ${xl + r} ${base}H${xr - r}Q${xr} ${base} ${xr} ${base - r}V${se}${back(nr, xr)}V${nt}Z`;
}

function shineFor({ cx, bw, base, nb, s }: BottleSpec): string {
  const x = cx - bw / 2 + Math.max(3, bw * 0.11);
  return `M${x} ${nb + s + 3}V${base - 9}M${x + 1.5} ${nb + s - 2.6}l0.1 0`;
}

function upright(spec: BottleSpec, rest: Omit<Vessel, "body" | "span" | "floor" | "shine" | "neck"> & { readonly shine?: string }): Vessel {
  return {
    body: bottle(spec),
    span: [spec.cx - spec.bw / 2, spec.cx + spec.bw / 2],
    floor: spec.base,
    shine: rest.shine ?? shineFor(spec),
    neck: { x: spec.cx, y: spec.nt, w: spec.nw, len: spec.nb - spec.nt },
    ...rest,
  };
}

const FIRST_FLOW: BottleSpec = { cx: 50, bw: 34, base: 90, nb: 40, s: 14, nw: 13, nt: 31, r: 6, shoulder: "round" };
const FLOW_90: BottleSpec = { ...FIRST_FLOW, nb: 31, nt: 22 };
const FLOW_180: BottleSpec = { cx: 50, bw: 36, base: 90, nb: 33, s: 15, nw: 10, nt: 15, r: 6, shoulder: "cone" };
const JAR: BottleSpec = { cx: 50, bw: 58, base: 90, nb: 46, s: 7, nw: 34, nt: 39, r: 8, shoulder: "square" };
const SAT: BottleSpec = { cx: 32, bw: 30, base: 90, nb: 58, s: 10, nw: 9, nt: 49, r: 6, shoulder: "flask" };
const SUN: BottleSpec = { cx: 68, bw: 30, base: 90, nb: 51, s: 10, nw: 9, nt: 41, r: 6, shoulder: "flask" };
const SLIM: BottleSpec = { cx: 50, bw: 26, base: 90, nb: 26, s: 10, nw: 10, nt: 17, r: 5, shoulder: "round" };
const RIBBED: BottleSpec = { cx: 50, bw: 38, base: 90, nb: 22, s: 12, nw: 11, nt: 12, r: 4, shoulder: "cone" };
const SQUARE: BottleSpec = { cx: 50, bw: 36, base: 90, nb: 34, s: 6, nw: 12, nt: 25, r: 5, shoulder: "square" };
const WRAPPED: BottleSpec = { cx: 50, bw: 40, base: 90, nb: 32, s: 14, nw: 14, nt: 22, r: 6, shoulder: "round" };

const NOTCHES = [84, 77, 70, 63, 56, 49, 42].map((y) => `M35.4 ${y}H39.6`).join("");
const RIBS = [34.6, 38.4, 61.6, 65.4].map((x) => `M${x} 40V86`).join("");

const DESIGNS: Record<AchievementId, Design> = {
  firstFlow: {
    mark: "wave1",
    ground: { cx: 50, w: 38 },
    vessels: [upright(FIRST_FLOW, { level: 56, label: { x: 38, y: 64, w: 24, h: 19 } })],
  },
  flow90: {
    mark: "wave2",
    ground: { cx: 50, w: 38 },
    vessels: [upright(FLOW_90, { level: 48, label: { x: 38, y: 61, w: 24, h: 22 } })],
  },
  flow180: {
    mark: "wave3",
    ground: { cx: 50, w: 38 },
    vessels: [upright(FLOW_180, { level: 52, label: { x: 38, y: 59, w: 24, h: 24 }, collar: 26 })],
  },
  focusDay8h: {
    mark: "sun",
    ground: { cx: 50, w: 62 },
    vessels: [upright(JAR, { level: 57, label: { x: 31, y: 63, w: 38, h: 20 } })],
  },
  earlyStart: {
    mark: "sunrise",
    ground: { cx: 50, w: 58 },
    vessels: [{
      body: "M44 34V47C44 50 23 50 23 64V78C23 86 28 90 36 90H64C72 90 77 86 77 78V64C77 50 56 50 56 47V34Z",
      level: 60, span: [23, 77], floor: 90,
      neck: { x: 50, y: 34, w: 12, len: 13 },
      label: { x: 35, y: 67, w: 30, h: 17, oval: true },
      shine: "M27.4 66V80M30.5 57.4l0.1 0",
    }],
  },
  nightOwl: {
    mark: "moon",
    ground: { cx: 50, w: 32 },
    vessels: [{
      body: "M45 30V43.6A23 23 0 1 0 55 43.6V30Z",
      level: 57, span: [27, 73], floor: 89,
      neck: { x: 50, y: 30, w: 10, len: 13 },
      label: { x: 37, y: 66, w: 26, h: 15, oval: true },
      shine: "M32.4 58.6A18.5 18.5 0 0 0 35.4 78.4",
    }],
  },
  weekendShift: {
    mark: "dayRight",
    ground: { cx: 50, w: 70 },
    vessels: [
      upright(SAT, { level: 70, label: { x: 23, y: 76, w: 18, h: 10, mark: "dayLeft" }, secondary: true, shine: "M20.6 72V81" }),
      upright(SUN, { level: 64, label: { x: 59, y: 72, w: 18, h: 11, mark: "dayRight" }, shine: "M56.6 66V81" }),
    ],
  },
  streak7: {
    mark: "seven",
    ground: { cx: 50, w: 28 },
    vessels: [upright(SLIM, { level: 42, label: { x: 42.5, y: 56, w: 15, h: 23 }, etch: NOTCHES, shine: "M59.6 40V80" })],
  },
  streak30: {
    mark: "calendar",
    ground: { cx: 50, w: 42 },
    vessels: [upright(RIBBED, { level: 37, label: { x: 41, y: 51, w: 18, h: 26 }, etch: RIBS, shine: "M34.6 40V86" })],
  },
  focus100h: {
    mark: "hourglass",
    ground: { cx: 50, w: 66 },
    vessels: [{
      body: "M45 26V40C45 50 20 60 18 80Q17.5 90 28 90H72Q82.5 90 82 80C80 60 55 50 55 40V26Z",
      level: 57, span: [20, 80], floor: 90,
      neck: { x: 50, y: 26, w: 10, len: 14 },
      label: { x: 36, y: 68, w: 28, h: 15 },
      shine: "M23.6 78Q24.6 67 31.6 61",
      stopper: "ball",
    }],
  },
  driftDay: {
    mark: "boat",
    ground: { cx: 40, w: 54, y: 87.6 },
    glow: { cx: 52, cy: 74, r: 40 },
    maxWidth: 92,
    vessels: [{
      body: "M80 67H74C68 67 66 60 60 60H20Q14 60 14 66V80Q14 86 20 86H60C66 86 68 79 74 79H80Z",
      level: 75, span: [14, 80], floor: 86,
      neck: { x: 80, y: 73, w: 12, len: 7, angle: 90 },
      label: { x: 24, y: 63.5, w: 26, h: 19 },
      shine: "M19 63.6H56",
      corkAt: { x: 89.6, y: 82.4, angle: 96 },
    }],
    spill: {
      puddle: "M72 88.4C72 86.9 77.4 86 84 86C90.6 86 95 86.9 95 88.4C95 89.9 90.6 90.8 84 90.8C77.4 90.8 72 89.9 72 88.4Z",
      trickle: "M80.4 77.4C83 78 84.2 82 83.4 86.6",
    },
  },
  noDriftDay: {
    mark: "level",
    ground: { cx: 50, w: 56 },
    vessels: [{
      body: "M45 24V40L24 84Q22 90 28 90H72Q78 90 76 84L55 40V24Z",
      level: 45, span: [22, 78], floor: 90, flat: true,
      neck: { x: 50, y: 24, w: 10, len: 16 },
      label: { x: 37, y: 63, w: 26, h: 16 },
      shine: "M40.6 52L30.6 75",
    }],
  },
  comeback: {
    mark: "rise",
    ground: { cx: 50, w: 40 },
    vessels: [upright(SQUARE, { level: 50, label: { x: 38, y: 56, w: 24, h: 21 }, etch: "M34.6 82.4H65.4", dashed: true })],
  },
};

/** Marks drawn in a 20 x 20 box centred on 0, 0. */
function Mark({ name }: { readonly name: MarkName }): ReactNode {
  switch (name) {
    case "wave1":
      return <path className="p1-ink-line" d="M-8 0C-5.4-4.4-2.6-4.4 0 0S5.4 4.4 8 0" />;
    case "wave2":
      return <path className="p1-ink-line" d="M-8-3C-5.4-7.4-2.6-7.4 0-3S5.4 1.4 8-3M-8 4C-5.4-.4-2.6-.4 0 4S5.4 8.4 8 4" />;
    case "wave3":
      return <path className="p1-ink-line" d="M-8-6C-5.4-9.6-2.6-9.6 0-6S5.4-2.4 8-6M-8 0C-5.4-3.6-2.6-3.6 0 0S5.4 3.6 8 0M-8 6C-5.4 2.4-2.6 2.4 0 6S5.4 9.6 8 6" />;
    case "sun":
      return (
        <>
          <circle className="p1-ink-fill" cx="0" cy="0" r="4" />
          <path className="p1-ink-line" d="M0-9V-7M0 7V9M-9 0H-7M7 0H9M-6.4-6.4L-5-5M5 5L6.4 6.4M-6.4 6.4L-5 5M5-5L6.4-6.4" />
        </>
      );
    case "sunrise":
      return (
        <>
          <path className="p1-ink-fill" d="M-5.4 3.4A5.4 5.4 0 0 1 5.4 3.4Z" />
          <path className="p1-ink-line" d="M-9.4 3.4H9.4M0-6.6V-4.4M-7-3.4L-5.6-2.2M7-3.4L5.6-2.2" />
        </>
      );
    case "moon":
      return (
        <>
          <path className="p1-ink-fill" d="M2.4-7.6A7.6 7.6 0 1 0 7.8 3.2A6 6 0 0 1 2.4-7.6Z" />
          <circle className="p1-ink-fill" cx="7" cy="-5.6" r="1.1" />
        </>
      );
    case "dayLeft":
    case "dayRight":
      return (
        <>
          <rect className="p1-ink-line" x="-9" y="-4.6" width="18" height="9.2" rx="1.6" />
          <path className="p1-ink-line" d="M0-4.6V4.6" />
          <rect className="p1-ink-fill" x={name === "dayLeft" ? -6.6 : 2.4} y="-2.2" width="4.2" height="4.4" rx="0.8" />
        </>
      );
    case "seven":
      return <path className="p1-ink-line" d="M-4.6-7.6H5L-1.4 8" />;
    case "calendar":
      return (
        <>
          <rect className="p1-ink-line" x="-7.6" y="-6.4" width="15.2" height="14" rx="2" />
          <path className="p1-ink-line" d="M-7.6-2.2H7.6M-3.8-9V-5M3.8-9V-5M-3.6 2.8L-1 5.2L3.8 0.2" />
        </>
      );
    case "hourglass":
      return (
        <>
          <path className="p1-ink-line" d="M-6-8.4H6M-6 8.4H6M-4.6-8.4C-4.6-2.4 4.6 2.4 4.6 8.4M4.6-8.4C4.6-2.4-4.6 2.4-4.6 8.4" />
          <path className="p1-ink-fill" d="M-3.6 8.2C-3 5.4-1 4.6 0 3.4C1 4.6 3 5.4 3.6 8.2Z" />
        </>
      );
    case "boat":
      return (
        <>
          <path className="p1-ink-fill" d="M-8.4 1.8H8.4L5 6.2H-5Z" />
          <path className="p1-ink-line" d="M0 1.8V-8L6 0.4H0M-9.4 9C-7 7.8-5 7.8-2.6 9S2 10.2 4.4 9" />
        </>
      );
    case "level":
      return (
        <>
          <rect className="p1-ink-line" x="-9" y="-4" width="18" height="8" rx="4" />
          <ellipse className="p1-ink-fill" cx="0" cy="0" rx="2.6" ry="1.9" />
          <path className="p1-ink-line" d="M-4.2-4V4M4.2-4V4" />
        </>
      );
    case "rise":
      return <path className="p1-ink-line" d="M-8.4 6.4L-3.6 1.6L0 4.4L7.4-4.4M2.6-4.6H7.6V0.4" />;
  }
}

function LabelArt({ label, mark, detail, locked, gilt }: { readonly label: Label; readonly mark: MarkName; readonly detail: boolean; readonly locked: boolean; readonly gilt: boolean }) {
  const { x, y, w, h } = label;
  const scale = (Math.min(w, h) * (detail ? 0.68 : 0.8)) / 20;
  const stroke = (detail ? (locked ? 1.2 : 1.9) : 3) / scale;
  const paper = label.oval
    ? <ellipse className="p1-label" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
    : <rect className="p1-label" x={x} y={y} width={w} height={h} rx="1.4" />;
  const rule = label.oval
    ? <ellipse className="p1-gilt" cx={x + w / 2} cy={y + h / 2} rx={w / 2 - 1.3} ry={h / 2 - 1.3} />
    : <rect className="p1-gilt" x={x + 1.3} y={y + 1.3} width={w - 2.6} height={h - 2.6} rx="0.6" />;
  return (
    <g className={gilt ? "p1-label-group p1-label-group--gilt" : "p1-label-group"}>
      {paper}
      {gilt && detail ? rule : null}
      <g className="p1-mark" transform={`translate(${x + w / 2} ${y + h / 2}) scale(${scale})`} strokeWidth={stroke}>
        <Mark name={label.mark ?? mark} />
      </g>
    </g>
  );
}

/** Cork, seal and capsule, drawn upward from the mouth at 0, 0. */
function Closure({ neck, tier, detail, stopper }: { readonly neck: Neck; readonly tier: number; readonly detail: boolean; readonly stopper: "cork" | "ball" }) {
  const cw = neck.w - 1.6;
  const half = cw / 2;
  if (stopper === "ball") {
    return (
      <g className="p1-cork-drop">
        <rect className="p1-stopper" x={-neck.w / 2 + 1.4} y="-4.6" width={neck.w - 2.8} height="6" rx="1" />
        <circle className="p1-stopper" cx="0" cy="-9.4" r="6.2" />
        <path className="p1-stopper-shine" d="M-3.4-11.6A3.8 3.8 0 0 1 -0.6-13.2" />
      </g>
    );
  }
  if (!detail) {
    const cap = tier >= 6 ? "p1-cap p1-cap--gold" : tier >= 2 ? "p1-cap p1-cap--wax" : "p1-cap";
    return <rect className={`${cap} p1-cork-drop`} x={-half - 0.6} y="-7" width={cw + 1.2} height="7.6" rx="1.6" />;
  }
  const sealR = Math.min(6.2, Math.max(4.6, cw * 0.56));
  return (
    <>
      <path className="p1-cork p1-cork-drop" d={`M${-half} 0.6L${-half - 0.5}-5.4Q${-half - 0.5}-6.6 ${-half + 0.8}-6.6H${half - 0.8}Q${half + 0.5}-6.6 ${half + 0.5}-5.4L${half} 0.6Z`} />
      {tier >= 6 ? (
        <g className="p1-capsule">
          <path d={`M${-half - 1.7} 6.4V-5Q${-half - 1.7}-7.8 ${-half + 1}-7.8H${half - 1}Q${half + 1.7}-7.8 ${half + 1.7}-5V6.4Z`} />
          {detail ? <path className="p1-capsule-line" d={`M${-half - 1.7} 3.4H${half + 1.7}M${-half + 1.6}-5.6V1.6M${half - 2.6}-5.6V1.6`} /> : null}
        </g>
      ) : null}
      {tier >= 2 && detail ? (
        <g className="p1-seal">
          <circle cx="0" cy="-7.4" r={sealR} />
          <circle className="p1-seal-ring" cx="0" cy="-7.4" r={sealR * 0.6} />
        </g>
      ) : null}
    </>
  );
}

function Rim({ neck }: { readonly neck: Neck }) {
  return <rect className="p1-rim" x={-neck.w / 2 - 1.3} y="0" width={neck.w + 2.6} height="3" rx="1.2" />;
}

function Twine({ neck, withTag }: { readonly neck: Neck; readonly withTag: boolean }) {
  const ty = Math.min(6.6, neck.len - 1.6);
  const edge = neck.w / 2 + 0.6;
  return (
    <g className="p1-twine-group">
      <path className="p1-twine" d={`M${-edge} ${ty - 1}H${edge}M${-edge} ${ty + 1.2}H${edge}M${-edge} ${ty + 3.4}H${edge}`} />
      <path className="p1-twine p1-twine-end" d={`M${edge} ${ty + 1.2}q3 2.6 2 7.4M${edge} ${ty + 1.2}q4.4 1.4 6 5.8`} />
      {withTag ? (
        <g className="p1-tag">
          <path className="p1-tag-thread" d={`M${edge} ${ty + 1.2}L${edge + 7} ${ty + 9.4}`} />
          <g transform={`translate(${edge + 7} ${ty + 9.4}) rotate(${-14 - (neck.angle ?? 0)}) scale(1.55)`}>
            <path className="p1-label" d="M-2.2 0H2.2L4 1.8V10.4H-4V1.8Z" />
            <circle className="p1-tag-hole" cx="0" cy="2.2" r="0.8" />
            <path className="p1-gilt" d="M-2.4 7.6H2.4" />
          </g>
        </g>
      ) : null}
    </g>
  );
}

function VesselArt({ vessel, design, uid, index, earned, locked, tier, detail, entrance }: {
  readonly vessel: Vessel; readonly design: Design; readonly uid: string; readonly index: number;
  readonly earned: boolean; readonly locked: boolean; readonly tier: number; readonly detail: boolean; readonly entrance: boolean;
}) {
  const clip = `${uid}-clip${index}`;
  const [x0, x1] = vessel.span;
  const cx = (x0 + x1) / 2;
  const y = vessel.level;
  const bow = vessel.flat ? 0 : 1.5;
  const liquid = `M${x0 - 10} ${y - bow}H${x0}Q${cx} ${y + bow * 2} ${x1} ${y - bow}H${x1 + 10}V100H${x0 - 10}Z`;
  const surface = `M${x0} ${y - bow}Q${cx} ${y + bow * 2} ${x1} ${y - bow}`;
  const neck = vessel.neck;
  const neckTransform = `translate(${neck.x} ${neck.y})${neck.angle ? ` rotate(${neck.angle})` : ""}`;
  const stopper = vessel.stopper ?? "cork";
  const rise = { "--p1-rise": `${vessel.floor - y + 2}px` } as CSSProperties;
  const pour = entrance && earned && !neck.angle;

  return (
    <g className="p1-vessel">
      <clipPath id={clip}>
        <path d={vessel.body} />
      </clipPath>
      <path className="p1-glass-fill" d={vessel.body} />
      {earned ? (
        <g clipPath={`url(#${clip})`}>
          <g className="p1-rise" style={rise}>
            <path className="p1-liquid" d={liquid} fill={`url(#${uid}-liquid)`} />
            {detail ? <path className="p1-surface" d={surface} /> : null}
          </g>
        </g>
      ) : null}
      {pour ? <rect className="p1-stream" x={neck.x - 1.1} y="2" width="2.2" height={y - 2} rx="1.1" /> : null}
      {detail && vessel.etch ? <path className={vessel.dashed ? "p1-etch p1-etch--dashed" : "p1-etch"} d={vessel.etch} /> : null}
      <path className="p1-shine" d={vessel.shine} />
      {entrance && earned ? (
        <g clipPath={`url(#${clip})`}>
          <path className="p1-gleam" style={{ "--p1-gleam": `${x1 - x0 + 40}px` } as CSSProperties} d={`M${x0 - 30} 100L${x0 - 14} 100L${x0} 0L${x0 - 16} 0Z`} />
        </g>
      ) : null}
      <path className="p1-glass" d={vessel.body} />
      <LabelArt label={vessel.label} mark={design.mark} detail={detail} locked={locked} gilt={earned && tier >= (detail ? 4 : 6)} />
      <g transform={neckTransform}>
        <Rim neck={neck} />
        {vessel.collar ? <rect className="p1-rim" x={-neck.w / 2 - 1.6} y={vessel.collar - neck.y} width={neck.w + 3.2} height="2.6" rx="1.2" /> : null}
        {earned && tier >= 1 && !vessel.corkAt ? <Closure neck={neck} tier={tier} detail={detail} stopper={stopper} /> : null}
        {earned && tier >= 3 && detail ? <Twine neck={neck} withTag={tier >= 5 && !vessel.secondary} /> : null}
      </g>
      {earned && tier >= 1 && vessel.corkAt ? (
        <g transform={`translate(${vessel.corkAt.x} ${vessel.corkAt.y}) rotate(${vessel.corkAt.angle}) translate(0 2.4)`}>
          <Closure neck={neck} tier={tier} detail={detail} stopper={stopper} />
        </g>
      ) : null}
    </g>
  );
}

function Concealed({ detail }: { readonly detail: boolean }) {
  return (
    <g className="p1-concealed">
      {detail ? <ellipse className="p1-ground" cx="50" cy="91.2" rx="23" ry="1.8" /> : null}
      <path className="p1-wrap" d={bottle(WRAPPED)} />
      <path className="p1-wrap" d="M42 34V17Q42 15 44 15H56Q58 15 58 17V34Z" />
      {detail ? <path className="p1-fold" d="M42 21.4L50 25.6L58 21.4M50 37V88" /> : null}
      <path className="p1-twine" d="M41 31.4H59" />
      <path className="p1-twine p1-bow" d="M50 31.4C46 27.4 41.6 28.6 43.4 31.4C44.6 33.2 48 32.4 50 31.4C52 32.4 55.4 33.2 56.6 31.4C58.4 28.6 54 27.4 50 31.4M49 32L46.4 37.6M51 32L53.6 37.6" />
      {detail ? <rect className="p1-label" x="38" y="52" width="24" height="26" rx="1.4" /> : null}
      <path className="p1-question" d={detail
        ? "M45.4 61.2C45.4 57.8 47.6 56 50.2 56C53 56 54.8 57.8 54.8 60.4C54.8 64.2 50.4 64.4 50.4 68.6M50.4 73.4V73.6"
        : "M43.4 58.6C43.4 53.8 46.4 51.4 50.2 51.4C54.4 51.4 57 54 57 57.8C57 63 50.4 63.6 50.4 69M50.4 76V76.2"} />
    </g>
  );
}

const SHELF = 92;

/** Scale that gives every badge a similar visual mass, no taller than 88% of the box, standing on the shelf. */
function fitTransform(design: Design | null, hero: boolean): string {
  const bounds = design
    ? design.vessels.reduce(
      (box, vessel) => ({
        top: Math.min(box.top, vessel.neck.angle ? 58 : vessel.neck.y - (vessel.stopper === "ball" ? 16 : 13)),
        left: Math.min(box.left, vessel.span[0]),
        right: Math.max(box.right, vessel.span[1]),
      }),
      { top: SHELF, left: design.ground.cx - design.ground.w / 2, right: design.ground.cx + design.ground.w / 2 },
    )
    : { top: 13, left: 30, right: 70 };
  const right = design?.spill ? 95 : bounds.right;
  const height = SHELF - bounds.top;
  const width = right - bounds.left;
  // Equal ink area per badge: a wide jar is held back, a thin bottle grows until it meets the height limit.
  const fit = Math.min(1.32, 88 / height, (design?.maxWidth ?? 72) / width, Math.sqrt(4000 / (height * width)));
  const scale = hero ? fit * 1.08 : fit;
  const cx = (bounds.left + right) / 2;
  return `translate(50 ${SHELF}) scale(${scale.toFixed(3)}) translate(${-cx} ${-SHELF})`;
}

/** Apothecary remedy bottles: one bottle and label mark per achievement. */
export function AchievementPotion1({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const design = DESIGNS[id];
  const glow = design.glow ?? { cx: 50, cy: 58, r: 44 };
  const earned = state === "earned";
  const locked = state === "locked";
  // One-time achievements are earned with tier 0 and show the full set of finishing touches.
  const level = earned ? (tier <= 0 ? 6 : Math.min(tier, 6)) : 0;
  const classes = [
    "potion1",
    `potion1--${state}`,
    state === "concealed" ? null : `potion1--${id}`,
    detail ? null : "potion1--compact",
    entrance && earned ? "potion1--entrance" : null,
  ].filter(Boolean).join(" ");

  return (
    <svg className={classes} viewBox="0 0 100 100" data-group={group} data-tier={level} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}-liquid`} x1="0" y1="0" x2="0" y2="1">
          <stop className="p1-stop-top" offset="0" />
          <stop className="p1-stop-mid" offset="0.35" />
          <stop className="p1-stop-bottom" offset="1" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.55" r="0.5">
          <stop className="p1-glow-in" offset="0" />
          <stop className="p1-glow-out" offset="1" />
        </radialGradient>
      </defs>
      <g transform={fitTransform(state === "concealed" ? null : design, entrance && earned)}>
      {state === "concealed" ? <Concealed detail={detail} /> : (
        <>
          {earned && level >= 6 && detail ? <circle className="p1-glow" cx={glow.cx} cy={glow.cy} r={glow.r} fill={`url(#${uid}-glow)`} /> : null}
          {detail ? (
            <>
              <path className="p1-shelf" d={`M${design.ground.cx - design.ground.w / 2 - 8} ${(design.ground.y ?? 91.2) - 0.4}H${design.ground.cx + design.ground.w / 2 + 8}`} />
              <ellipse className="p1-ground" cx={design.ground.cx} cy={design.ground.y ?? 91.2} rx={design.ground.w / 2} ry="1.8" />
              {earned && level >= 6 ? <path className="p1-glint" d={`M${design.ground.cx - design.ground.w * 0.34} ${(design.ground.y ?? 91.2) - 0.4}H${design.ground.cx + design.ground.w * 0.34}`} /> : null}
              {earned ? <ellipse className="p1-reflection" cx={design.ground.cx} cy={(design.ground.y ?? 91.2) + 1.4} rx={design.ground.w * 0.4} ry="1.6" /> : null}
            </>
          ) : null}
          {earned && design.spill ? (
            <g className="p1-spill">
              <path className="p1-puddle" d={design.spill.puddle} />
              <path className="p1-trickle" d={design.spill.trickle} />
            </g>
          ) : null}
          {design.vessels.map((vessel, index) => (
            <VesselArt
              key={index}
              vessel={vessel}
              design={design}
              uid={uid}
              index={index}
              earned={earned}
              locked={locked}
              tier={level}
              detail={detail}
              entrance={entrance}
            />
          ))}
        </>
      )}
      </g>
    </svg>
  );
}
