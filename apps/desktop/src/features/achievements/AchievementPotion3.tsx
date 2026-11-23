import { useId, type ReactElement } from "react";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";
import "./achievementPotion3.css";

/*
 * Direction 3, a small world in a flask. Every achievement shares one round
 * flask with a cork; what tells them apart is the calm scene suspended in its
 * liquid and the colour of that liquid sky. Scenes are drawn once in the
 * coordinates of the large flask (inner bulb centred at 50,61, radius 29,
 * liquid surface at y 38) and styled by role classes, so the same shapes
 * become the dashed sketch of a locked badge.
 */

const round = (n: number) => Math.round(n * 100) / 100;

/** Lit part of a moon at phase p (0 new, 0.5 full, 1 new again); lit on the right while waxing. */
function moonPath(cx: number, cy: number, r: number, p: number): string {
  const k = Math.cos(2 * Math.PI * p);
  const rx = round(Math.abs(k) * r);
  const waxing = p < 0.5;
  const crescent = k > 0;
  const outer = waxing ? 1 : 0;
  const inner = waxing === crescent ? 0 : 1;
  return `M${cx} ${cy - r}A${r} ${r} 0 0 ${outer} ${cx} ${cy + r}A${rx} ${r} 0 0 ${inner} ${cx} ${cy - r}Z`;
}

function sparkle(cx: number, cy: number, s: number): string {
  return `M${cx} ${cy - s}Q${cx} ${cy} ${cx + s} ${cy}Q${cx} ${cy} ${cx} ${cy + s}Q${cx} ${cy} ${cx - s} ${cy}Q${cx} ${cy} ${cx} ${cy - s}Z`;
}

function cloud(cx: number, cy: number, s: number): string {
  return `M${round(cx - 8 * s)} ${cy}a${4 * s} ${4 * s} 0 0 1 ${round(3.5 * s)} ${round(-3.8 * s)}a${5 * s} ${5 * s} 0 0 1 ${round(8.5 * s)} ${round(-1.2 * s)}a${round(3.6 * s)} ${round(3.6 * s)} 0 0 1 ${4 * s} ${5 * s}Z`;
}

function swirl(cx: number, cy: number, r: number): string {
  return `M${cx + r} ${cy}A${r} ${r} 0 0 1 ${cx - r} ${cy}A${round(0.7 * r)} ${round(0.7 * r)} 0 0 1 ${round(cx + 0.4 * r)} ${cy}A${round(0.4 * r)} ${round(0.4 * r)} 0 0 1 ${round(cx - 0.4 * r)} ${cy}`;
}

function rays(cx: number, cy: number, from: number, to: number, angles: readonly number[], className: string, width: number) {
  return angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return (
      <line
        key={deg}
        className={className}
        x1={round(cx + from * Math.cos(a))}
        y1={round(cy + from * Math.sin(a))}
        x2={round(cx + to * Math.cos(a))}
        y2={round(cy + to * Math.sin(a))}
        strokeWidth={width}
      />
    );
  });
}

const sprout = (
  <g>
    <path className="p3-l-key" d="M50 77 C50 71 49.4 66 50 60.5" strokeWidth={2} />
    <path className="p3-key" d="M50 67 C44.5 67.5 38.5 64 37 57 C43.5 56.5 48.5 60 50 67Z" />
    <path className="p3-key" d="M50 61.5 C51 54 56.5 48.5 64.5 48 C64.5 55.5 58 61 50 61.5Z" />
    <path className="p3-l-pale p3-detail" d="M49 65.6 L41.5 59.5 M50.8 60.2 L59.5 52.6" strokeWidth={0.7} />
  </g>
);

const sailboat = (
  <g>
    <path className="p3-near" d="M36.5 69 H63.5 L59.5 75 H40.5Z" />
    <path className="p3-l-ink" d="M50 69 V45.5" strokeWidth={1.2} />
    <path className="p3-pale" d="M51.3 47 L51.3 67 L64.5 67Z" />
    <path className="p3-key" d="M48.7 50.5 L48.7 67 L39.5 67Z" />
  </g>
);

const mountain = (
  <g>
    <path className="p3-far" d="M13 90 L50 45 L87 90Z" />
    <path className="p3-near" d="M50 45 L87 90 H62 L55.5 72 L57.5 60Z" />
    <path className="p3-pale" d="M50 45 L57.4 54 L53.6 52.3 L50.6 55.4 L47 52.3 L42.6 54Z" />
    <path className="p3-l-ink" d="M50 45 V39.5" strokeWidth={1} />
    <path className="p3-sun" d="M50.3 39.5 L55.6 41.2 L50.3 42.9Z" />
  </g>
);

const noonSun = (
  <g>
    <circle className="p3-glow" cx={50} cy={50} r={12} />
    <circle className="p3-sun" cx={50} cy={50} r={6.4} />
    {rays(50, 50, 8.6, 11.6, [0, 45, 90, 135, 180, 225, 270, 315], "p3-l-sun", 1.5)}
  </g>
);

const fieldBands = [[66, 2.2, "p3-far"], [68.2, 2.8, "p3-key"], [71, 3.6, "p3-far"], [74.6, 4.6, "p3-key"], [79.2, 6, "p3-far"], [85.2, 8, "p3-key"], [93.2, 7, "p3-far"]] as const;

const sunrise = (
  <g>
    <circle className="p3-glow" cx={50} cy={70} r={17} />
    <path className="p3-sun" d="M38 70 A12 12 0 0 1 62 70Z" />
    {rays(50, 70, 14.5, 18.5, [-150, -120, -90, -60, -30], "p3-l-sun", 1.6)}
  </g>
);

const litHouse = (
  <g>
    <circle className="p3-glow" cx={56} cy={66} r={9} />
    <path className="p3-near" d="M46 78 V62.5 L56 54.5 L66 62.5 V78Z" />
    <rect className="p3-sun" x={53} y={63.5} width={6} height={6} rx={0.6} />
    <path className="p3-l-near p3-detail" d="M56 63.5 V69.5 M53 66.5 H59" strokeWidth={0.8} />
  </g>
);

const lamp = (
  <g>
    <path className="p3-beam" d="M39 55 H53 L66 86 H25Z" />
    <rect className="p3-ink" x={61} y={66} width={10} height={2.8} rx={1.4} />
    <path className="p3-l-ink" d="M66 67 L61 56 L50.5 47.8" strokeWidth={1.7} />
    <circle className="p3-ink" cx={61} cy={56} r={1.3} />
    <path className="p3-ink" d="M42 47 H50.5 L53.5 55.2 H39Z" />
    <circle className="p3-sun" cx={46.2} cy={55.6} r={2.1} />
  </g>
);

const twoHills = (
  <g>
    <path className="p3-far" d="M6 90 Q27 50 52 90Z" />
    <path className="p3-key" d="M38 92 Q66 46 96 92Z" />
  </g>
);

/** Lanterns hung along a quadratic string from (23,49) to (77,49), sagging through (50,66). */
function lanterns(count: number, rx: number, ry: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / (count + 1);
    const x = round((1 - t) * (1 - t) * 23 + 2 * t * (1 - t) * 50 + t * t * 77);
    const y = round((1 - t) * (1 - t) * 49 + 2 * t * (1 - t) * 66 + t * t * 49);
    const cy = round(y + 1.4 + ry);
    return (
      <g key={i}>
        <circle className="p3-glow" cx={x} cy={cy} r={ry * 1.7} />
        <path className="p3-l-ink" d={`M${x} ${y} V${round(cy - ry)}`} strokeWidth={0.7} />
        <ellipse className="p3-sun" cx={x} cy={cy} rx={rx} ry={ry} />
        <rect className="p3-ink" x={round(x - rx * 0.55)} y={round(cy - ry - 0.5)} width={round(rx * 1.1)} height={1} rx={0.4} />
        <rect className="p3-ink" x={round(x - rx * 0.55)} y={round(cy + ry - 0.5)} width={round(rx * 1.1)} height={1} rx={0.4} />
      </g>
    );
  });
}

const garlandString = <path className="p3-l-ink" d="M23 49 Q50 66 77 49" strokeWidth={0.8} />;

const MOON_ARC = [[162, 0.12, 4.3], [126, 0.27, 4.3], [90, 0.5, 5.2], [54, 0.73, 4.3], [18, 0.88, 4.3]] as const;

function moonArc(cx: number, cy: number, radius: number, moons: readonly (readonly [number, number, number])[], scale: number) {
  return moons.map(([deg, phase, r]) => {
    const a = (deg * Math.PI) / 180;
    const x = round(cx + radius * Math.cos(a));
    const y = round(cy - radius * Math.sin(a));
    const size = round(r * scale);
    return (
      <g key={deg}>
        <circle className="p3-faint" cx={x} cy={y} r={size} />
        <path className="p3-sun" d={moonPath(x, y, size, phase)} />
      </g>
    );
  });
}

const tree = (
  <g>
    <path className="p3-ink" d="M48.3 71 L49 57 H51 L51.7 71Z" />
    <circle className="p3-key" cx={50} cy={46.5} r={8} />
    <circle className="p3-key" cx={44} cy={52} r={6.5} />
    <circle className="p3-key" cx={56} cy={52} r={6.5} />
    <circle className="p3-key" cx={46.5} cy={58} r={5} />
    <circle className="p3-key" cx={53.5} cy={58} r={5} />
  </g>
);

const roots = (
  <path
    className="p3-l-sun"
    d="M50 71 C49.5 78 47 84 44 90 M50 71 C52 77 58 80 63 86 M50 71 C47 75 40 76 33.5 80 M50 71 C53 74 61 74 67.5 77.5 M50 71 C50.6 80 50 86 50.5 91 M45.6 82.5 C42 83.5 39 86 37.5 88.5"
    strokeWidth={1.3}
  />
);

const driftBoat = (
  <g transform="rotate(-15 50 68)">
    <path className="p3-near" d="M39 66 H61 L57.5 71.5 H42.5Z" />
    <path className="p3-l-ink" d="M50 66 V51.5" strokeWidth={1.1} />
    <path className="p3-key" d="M51 53 Q58 57.5 59 64.5 L51 64.5Z" />
  </g>
);

const stillWorld = (
  <g>
    <circle className="p3-sun" cx={40} cy={46} r={4.2} />
    <path className="p3-far" d="M16 64 Q34 50 52 64Z" />
    <path className="p3-key" d="M38 64 Q62 44 88 64Z" />
    <path className="p3-l-near" d="M62 54.4 V48.5" strokeWidth={1.3} />
    <circle className="p3-near" cx={62} cy={46.2} r={4} />
  </g>
);

const stillLake = (
  <>
    <rect className="p3-water" x={0} y={64} width={100} height={36} />
    {stillWorld}
    <g className="p3-mirror" transform="matrix(1 0 0 -1 0 128)">{stillWorld}</g>
    <path className="p3-l-pale" d="M0 64 H100" strokeWidth={0.6} />
  </>
);

function paperPlane(x: number, y: number, angle: number, scale: number) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <path className="p3-pale" d="M7 0 L-6 -5 L-2.5 0Z" />
      <path className="p3-key" d="M7 0 L-2.5 0 L-6 5Z" />
    </g>
  );
}

const home = (
  <g>
    <circle className="p3-glow" cx={35.5} cy={73} r={7} />
    <rect className="p3-near" x={30} y={68} width={11} height={11} />
    <path className="p3-ink" d="M28.4 68.6 L35.5 62 L42.6 68.6Z" />
    <rect className="p3-sun" x={34} y={72} width={3} height={6} rx={0.4} />
  </g>
);

type Scene = {
  /** Where the liquid sky meets the land, for the sky gradient. */
  readonly horizon: number;
  /** Night scenes keep a deep liquid in both themes. */
  readonly night?: boolean;
  readonly art: ReactElement;
  /** The one characteristic shape for the 1.75rem mark. */
  readonly mark: ReactElement;
};

const SCENES: Readonly<Record<AchievementId, Scene>> = {
  firstFlow: {
    horizon: 76,
    art: (
      <>
        <circle className="p3-glow" cx={50} cy={58} r={14} />
        <path className="p3-far" d="M10 80 Q30 71 50 75 T90 73 V96 H10Z" />
        <path className="p3-near" d="M10 85 Q50 68 90 85 V96 H10Z" />
        {sprout}
      </>
    ),
    mark: (
      <>
        <path className="p3-near" d="M8 87 Q50 70 92 87 V100 H8Z" />
        <g transform="translate(50 76) scale(1.4) translate(-50 -76)">{sprout}</g>
      </>
    ),
  },
  flow90: {
    horizon: 70,
    art: (
      <>
        <circle className="p3-sun" cx={69} cy={50} r={4} />
        <rect className="p3-water" x={10} y={70} width={80} height={30} />
        <path className="p3-far" d="M20 70.2 Q27 64 35 70.2Z" />
        <path className="p3-l-pale" d="M10 70 H90" strokeWidth={0.6} />
        <path className="p3-l-pale" d="M27 78 H38 M58 81.5 H72 M38 86.5 H50" strokeWidth={1} />
        {sailboat}
      </>
    ),
    mark: (
      <>
        <rect className="p3-water" x={0} y={72} width={100} height={30} />
        <g transform="translate(50 72) scale(1.35) translate(-50 -72)">{sailboat}</g>
      </>
    ),
  },
  flow180: {
    horizon: 86,
    art: (
      <>
        {mountain}
        <path className="p3-l-sun p3-trail" d="M41 90 L57 82 L45 73.5 L54.5 65 L48 57.5 L50.5 51.5" strokeWidth={1.2} />
        <path className="p3-near" d="M10 92 Q30 84 50 91 T90 89 V100 H10Z" />
      </>
    ),
    mark: <g transform="translate(50 74) scale(1.18) translate(-50 -74)">{mountain}</g>,
  },
  focusDay8h: {
    horizon: 66,
    art: (
      <>
        {noonSun}
        {fieldBands.map(([y, h, className]) => <rect key={y} className={className} x={10} y={y} width={80} height={h} />)}
      </>
    ),
    mark: (
      <>
        <g transform="translate(50 50) scale(1.3) translate(-50 -50)">{noonSun}</g>
        <rect className="p3-far" x={0} y={72} width={100} height={6} />
        <rect className="p3-key" x={0} y={78} width={100} height={8} />
        <rect className="p3-far" x={0} y={86} width={100} height={14} />
      </>
    ),
  },
  earlyStart: {
    horizon: 70,
    art: (
      <>
        {sunrise}
        <rect className="p3-water" x={10} y={70} width={80} height={30} />
        <path className="p3-far" d="M13 70.2 Q22 62.5 32 70.2Z" />
        <path className="p3-far" d="M66 70.2 Q77 61.5 89 70.2Z" />
        <path className="p3-l-sun" d="M41.5 74 H58.5 M45 78.5 H55 M47.5 83 H52.5" strokeWidth={1.6} />
      </>
    ),
    mark: (
      <>
        <g transform="translate(50 70) scale(1.25) translate(-50 -70)">{sunrise}</g>
        <rect className="p3-water" x={0} y={70} width={100} height={30} />
      </>
    ),
  },
  nightOwl: {
    horizon: 78,
    night: true,
    art: (
      <>
        <path className="p3-pale" d={moonPath(36, 51, 7, 0.17)} />
        <path className="p3-pale" d={sparkle(63, 44.5, 2.4)} />
        <path className="p3-pale" d={sparkle(71, 53, 1.7)} />
        <path className="p3-far" d="M10 78 Q28 67 48 76 V96 H10Z" />
        {litHouse}
        <path className="p3-near" d="M10 80 Q50 74 90 80 V100 H10Z" />
      </>
    ),
    mark: (
      <>
        <path className="p3-pale" d={moonPath(40, 50, 11, 0.17)} />
        <g transform="translate(60 78) scale(1.15) translate(-56 -78)">{litHouse}</g>
        <path className="p3-near" d="M0 80 H100 V100 H0Z" />
      </>
    ),
  },
  weekendShift: {
    horizon: 84,
    art: (
      <>
        {twoHills}
        {lamp}
      </>
    ),
    mark: (
      <g transform="translate(50 60) scale(1.3) translate(-50 -60)">
        {twoHills}
        {lamp}
      </g>
    ),
  },
  streak7: {
    horizon: 82,
    night: true,
    art: (
      <>
        <path className="p3-far" d="M10 83 Q30 75 50 81 T90 79 V100 H10Z" />
        <path className="p3-near" d="M10 89 Q50 80 90 89 V100 H10Z" />
        {garlandString}
        {lanterns(7, 2.4, 2.9)}
      </>
    ),
    mark: (
      <>
        {garlandString}
        {lanterns(4, 4, 4.8)}
      </>
    ),
  },
  streak30: {
    horizon: 78,
    night: true,
    art: (
      <>
        <path className="p3-pale" d={sparkle(41, 43, 1.4)} />
        <path className="p3-pale" d={sparkle(61, 42, 1.8)} />
        <path className="p3-pale" d={sparkle(30, 55, 1.2)} />
        {moonArc(50, 72, 22, MOON_ARC, 1)}
        <rect className="p3-water" x={10} y={78} width={80} height={22} />
        <path className="p3-l-sun" d="M45 82 H55 M47 86 H53" strokeWidth={1.2} />
      </>
    ),
    mark: <>{moonArc(50, 70, 19, [[150, 0.15, 6.2], [90, 0.5, 7.4], [30, 0.85, 6.2]], 1)}</>,
  },
  focus100h: {
    horizon: 71,
    art: (
      <>
        <rect className="p3-near" x={10} y={71} width={80} height={30} />
        {roots}
        <path className="p3-far" d="M10 71.5 Q50 67.5 90 71.5 V73 H10Z" />
        {tree}
      </>
    ),
    mark: (
      <g transform="translate(50 68) scale(1.12) translate(-50 -68)">
        <rect className="p3-near" x={0} y={71} width={100} height={30} />
        {roots}
        {tree}
      </g>
    ),
  },
  driftDay: {
    horizon: 69,
    art: (
      <>
        <path className="p3-pale" d={cloud(38, 48, 1)} />
        <path className="p3-pale" d={cloud(64, 55, 0.8)} />
        <rect className="p3-water" x={10} y={69} width={80} height={31} />
        <path className="p3-l-pale" d={swirl(38, 82, 5)} strokeWidth={1.2} />
        <path className="p3-l-pale" d={swirl(64, 80, 4)} strokeWidth={1.2} />
        <path className="p3-l-pale" d="M22 75 Q27 72 32 75 M68 88 Q72 85.5 76 88" strokeWidth={1} />
        {driftBoat}
      </>
    ),
    mark: (
      <>
        <rect className="p3-water" x={0} y={70} width={100} height={30} />
        <path className="p3-l-pale" d={swirl(50, 83, 7)} strokeWidth={2.2} />
        <g transform="translate(50 68) scale(1.35) translate(-50 -68)">{driftBoat}</g>
      </>
    ),
  },
  noDriftDay: {
    horizon: 64,
    art: stillLake,
    mark: <g transform="translate(54 64) scale(1.3) translate(-54 -64)">{stillLake}</g>,
  },
  comeback: {
    horizon: 79,
    art: (
      <>
        <path className="p3-far" d="M50 80 Q70 70 90 77 V100 H50Z" />
        <path className="p3-near" d="M10 79 Q50 74 90 82 V100 H10Z" />
        {home}
        <path className="p3-l-pale p3-trail" d="M43 72 C60 72 72 63 69.5 52 C67.5 43 54 41.5 49 49" strokeWidth={1.1} />
        {paperPlane(46.6, 53.4, 122, 0.85)}
      </>
    ),
    mark: (
      <>
        <path className="p3-near" d="M0 82 Q50 76 100 84 V100 H0Z" />
        <path className="p3-l-pale p3-trail" d="M30 74 C60 78 78 62 71 49 C65 39 50 40 46 47" strokeWidth={2.6} />
        {paperPlane(42, 55, 118, 2)}
      </>
    ),
  },
};

const MOTES = [[27, 58, 2.1], [73, 55, 1.6], [31, 47.5, 1.8], [69.5, 45.5, 1.4], [25.5, 68.5, 1.6], [75, 66.5, 2]] as const;

type Geometry = {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly neck: number;
  readonly lipY: number;
  readonly lipH: number;
  readonly corkTop: number;
  readonly stroke: number;
  readonly inner?: string;
};

const LARGE: Geometry = { cx: 50, cy: 61, r: 31, neck: 7, lipY: 15.8, lipH: 3.2, corkTop: 6, stroke: 1.5 };
const COMPACT: Geometry = { cx: 50, cy: 58.5, r: 37.5, neck: 9, lipY: 11.5, lipH: 4.6, corkTop: 3, stroke: 3.8, inner: "translate(50 58.5) scale(1.2) translate(-50 -61)" };

function arcPoint(g: Geometry, radius: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return `${round(g.cx + radius * Math.cos(a))} ${round(g.cy + radius * Math.sin(a))}`;
}

function arc(g: Geometry, radius: number, from: number, to: number) {
  return `M${arcPoint(g, radius, from)}A${radius} ${radius} 0 0 1 ${arcPoint(g, radius, to)}`;
}

export function AchievementPotion3({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const scene = SCENES[id];
  const g = detail ? LARGE : COMPACT;
  const earned = state === "earned";
  // One-time achievements arrive with tier 0 and are complete the moment they are earned.
  const level = earned ? (tier <= 0 ? 6 : Math.min(tier, 6)) : 0;
  const animate = entrance && earned && detail;

  const join = round(g.cy - Math.sqrt(g.r * g.r - g.neck * g.neck));
  const neckTop = g.lipY + g.lipH;
  const left = g.cx - g.neck;
  const right = g.cx + g.neck;
  const flask = `M${left} ${neckTop}V${join}A${g.r} ${g.r} 0 1 0 ${right} ${join}V${neckTop}`;
  const corkBottom = neckTop + 1.6;
  const corkH = corkBottom - g.corkTop;
  const cork = `M${left + 0.2} ${g.corkTop + 1.4}Q${left + 0.2} ${g.corkTop} ${left + 1.6} ${g.corkTop}H${right - 1.6}Q${right - 0.2} ${g.corkTop} ${right - 0.2} ${g.corkTop + 1.4}L${right - 1.1} ${corkBottom}H${left + 1.1}Z`;

  const sky = `${uid}-sky`;
  const clip = `${uid}-clip`;
  const halo = `${uid}-halo`;
  const motes = detail ? MOTES.slice(0, level) : [];

  return (
    <svg
      className={"potion3" + (animate ? " potion3--entrance" : "")}
      viewBox="0 0 100 100"
      data-id={id}
      data-group={group}
      data-state={state}
      data-size={detail ? "large" : "compact"}
      data-night={scene.night ? "" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <circle cx={50} cy={61} r={29} />
        </clipPath>
        <linearGradient id={sky} gradientUnits="userSpaceOnUse" x1={0} y1={38} x2={0} y2={scene.horizon}>
          <stop offset="0" className="p3-stop-top" />
          <stop offset="1" className="p3-stop-low" />
        </linearGradient>
        {level >= 6 && detail ? (
          <radialGradient id={halo} cx="50%" cy="50%" r="50%">
            <stop offset="0.55" className="p3-halo-in" />
            <stop offset="1" className="p3-halo-out" />
          </radialGradient>
        ) : null}
      </defs>

      {level >= 6 && detail ? <circle className="p3-halo" cx={50} cy={57} r={41} fill={`url(#${halo})`} /> : null}
      {detail ? <ellipse className="p3-shadow" cx={g.cx} cy={g.cy + g.r + 2} rx={g.r * 0.62} ry={2.1} /> : null}
      <path className="p3-body" d={flask + "Z"} />

      <g transform={g.inner}>
        <g clipPath={`url(#${clip})`}>
          {state === "earned" ? (
            <>
              <g className="p3-liquid">
                <rect x={18} y={38} width={64} height={58} fill={`url(#${sky})`} />
                <ellipse className="p3-meniscus" cx={50} cy={38} rx={17.7} ry={1.3} />
              </g>
              <g className="p3-scene">{detail ? scene.art : scene.mark}</g>
              {motes.map(([x, y, r], i) => (
                <g key={i} className="p3-mote" style={animate ? { animationDelay: `${900 + i * 85}ms` } : undefined}>
                  <circle className="p3-mote-glow" cx={x} cy={y} r={r + 1.4} />
                  <circle className="p3-mote-ring" cx={x} cy={y} r={r} strokeWidth={0.75} />
                  <circle className="p3-mote-shine" cx={round(x - r * 0.35)} cy={round(y - r * 0.35)} r={round(r * 0.28)} />
                </g>
              ))}
            </>
          ) : null}
          {state === "locked" ? <g className="p3-scene p3-sketch">{detail ? scene.art : scene.mark}</g> : null}
          {state === "concealed" ? (
            <>
              <rect className="p3-fog" x={18} y={30} width={64} height={64} />
              {detail ? (
                <>
                  <ellipse className="p3-fog-hi" cx={40} cy={50} rx={13} ry={4.5} />
                  <ellipse className="p3-fog-hi" cx={62} cy={70} rx={14} ry={4.5} />
                  <ellipse className="p3-fog-hi" cx={45} cy={84} rx={11} ry={3.4} />
                  <path className="p3-drops" d="M42.5 53 C42.5 46 47 42.5 51 42.5 C56 42.5 59 46 59 50 C59 55 52.5 56 51 60.5 L51 64" strokeWidth={2.8} strokeDasharray="0.01 3.1" />
                  <circle className="p3-drop" cx={51} cy={71} r={1.7} />
                </>
              ) : (
                <>
                  <path className="p3-drops" d="M41 53 C41 45 46.5 41 51 41 C56.5 41 60 45 60 50 C60 55.5 52 56.5 51 61.5 L51 64.5" strokeWidth={5.4} />
                  <circle className="p3-drop" cx={51} cy={73.5} r={3.4} />
                </>
              )}
            </>
          ) : null}
        </g>
      </g>

      {detail ? <path className="p3-shade" d={arc(g, g.r - 2.6, 22, 78)} strokeWidth={1.6} /> : null}
      <path className="p3-gleam" d={arc(g, g.r - (detail ? 4.6 : 6), 165, 222)} strokeWidth={detail ? 2.4 : 3.6} />
      {detail ? <circle className="p3-gleam-dot" cx={round(g.cx + (g.r - 4.6) * Math.cos((236 * Math.PI) / 180))} cy={round(g.cy + (g.r - 4.6) * Math.sin((236 * Math.PI) / 180))} r={1.1} /> : null}
      {detail ? <path className="p3-gleam" d={`M${left + 2} ${neckTop + 2}V${join - 1}`} strokeWidth={1.2} /> : null}
      <path className="p3-edge" d={flask} strokeWidth={g.stroke} />

      <path className="p3-cork" d={cork} strokeWidth={detail ? 0.8 : 1.6} />
      {detail && state === "earned" ? (
        <g className="p3-cork-grain">
          <circle cx={g.cx - 2.6} cy={g.corkTop + 3} r={0.55} />
          <circle cx={g.cx + 2.2} cy={g.corkTop + 5.4} r={0.55} />
          <circle cx={g.cx - 0.6} cy={g.corkTop + 7.6} r={0.55} />
        </g>
      ) : null}
      {level >= 5 ? <rect className="p3-band" x={left + 0.2} y={g.corkTop} width={g.neck * 2 - 0.4} height={round(corkH * 0.16)} rx={round(corkH * 0.08)} strokeWidth={detail ? 0.5 : 0.9} /> : null}
      {level >= 4 ? <rect className="p3-band" x={left + 0.4} y={round(g.corkTop + corkH * 0.34)} width={g.neck * 2 - 0.8} height={round(corkH * 0.24)} strokeWidth={detail ? 0.6 : 1} /> : null}
      <rect
        className={"p3-lip" + (level >= 3 ? " p3-lip--gold" : "")}
        x={left - 1.6}
        y={g.lipY}
        width={g.neck * 2 + 3.2}
        height={g.lipH}
        rx={g.lipH / 2}
        strokeWidth={detail ? 1.2 : 2.6}
      />
    </svg>
  );
}
