import type { AchievementId } from "./achievementCatalog";

/**
 * omo 2, enamel pins: path data for 13 die-cut pins drawn on a 100 x 100
 * grid. The outline is the cut metal; fields are the enamel pools inside it,
 * each ringed by a raised metal line; wires are extra metal lines (steam,
 * handles, numerals) drawn with the same bevel.
 */

export type Omo2Tone =
  | "ivory" | "paper" | "focus" | "drift" | "learning" | "comm" | "music"
  | "game" | "ent" | "shop" | "blue" | "purple" | "ink" | "metal";

export type Omo2Field = { readonly d: string; readonly tone: Omo2Tone };
export type Omo2Wire = { readonly d: string; readonly w?: number };

export type Omo2Pin = {
  /** Cut outline, one or more overlapping parts (their union is the pin). */
  readonly parts: readonly string[];
  readonly fields: readonly Omo2Field[];
  readonly wires?: readonly Omo2Wire[];
  /** Enamel used for milestone studs and the compact mark. */
  readonly main: Omo2Tone;
  /** Fields kept at the 1.75rem size, by index. */
  readonly compact: readonly number[];
  /** Top and bottom of the cut outline, for seating the pin above its bar. */
  readonly box: readonly [number, number];
  /** Where the polished glint sits, and where the tier-6 star stud sits. */
  readonly glint: readonly [number, number];
  readonly star: readonly [number, number];
};

const f = (n: number) => Number(n.toFixed(2));

export function circle(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx + r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)} ${f(cy)}A${rx} ${ry} 0 1 0 ${f(cx + rx)} ${f(cy)}A${rx} ${ry} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
}

export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

type Point = readonly [number, number];

export function poly(points: readonly Point[]): string {
  return points.map(([x, y], i) => (i === 0 ? "M" : "L") + f(x) + " " + f(y)).join("") + "Z";
}

export function star(cx: number, cy: number, n: number, outer: number, inner: number, turn = -90): string {
  const points: Point[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((turn + (i * 180) / n) * Math.PI) / 180;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(points);
}

function ray(cx: number, cy: number, a: number, r1: number, r2: number, w1: number, w2: number): string {
  const t = (a * Math.PI) / 180;
  const u: Point = [Math.cos(t), Math.sin(t)];
  const n: Point = [-u[1], u[0]];
  const at = (r: number, w: number): [Point, Point] => [
    [cx + u[0] * r + n[0] * w, cy + u[1] * r + n[1] * w],
    [cx + u[0] * r - n[0] * w, cy + u[1] * r - n[1] * w],
  ];
  const [a1, b1] = at(r1, w1);
  const [a2, b2] = at(r2, w2);
  return poly([a1, a2, b2, b1]);
}

function place(points: readonly Point[], angle: number, ox: number, oy: number): Point[] {
  const t = (angle * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return points.map(([x, y]) => [ox + x * c - y * s, oy + x * s + y * c] as const);
}

function curve(points: readonly Point[], angle: number, ox: number, oy: number, close = true): string {
  const p = place(points, angle, ox, oy);
  let d = "M" + f(p[0][0]) + " " + f(p[0][1]);
  for (let i = 1; i + 2 < p.length; i += 3) {
    d += "C" + [p[i], p[i + 1], p[i + 2]].map(([x, y]) => f(x) + " " + f(y)).join(" ");
  }
  return d + (close ? "Z" : "");
}

function pennantStripes(): Omo2Field[] {
  const left = 24.6;
  const right = 75.4;
  const top = 18.6;
  const tail = 81.2;
  const notch = 68.6;
  const yAt = (x: number) => (x <= 50 ? tail - ((x - left) / (50 - left)) * (tail - notch) : notch + ((x - 50) / (right - 50)) * (tail - notch));
  const width = (right - left) / 7;
  const stripes: Omo2Field[] = [];
  for (let i = 0; i < 7; i += 1) {
    const a = left + i * width;
    const b = a + width;
    const pts: Point[] = [[a, top], [b, top], [b, yAt(b)]];
    if (a < 50 && b > 50) pts.push([50, notch]);
    pts.push([a, yAt(a)]);
    stripes.push({ d: poly(pts), tone: i % 2 === 0 ? "comm" : "ivory" });
  }
  return stripes;
}

const ROCKET_TURN = 38;
const ROCKET_X = 64;
const ROCKET_Y = 35;
const ROCKET_SCALE = 1.22;
const rocketBody: Point[] = [[0, -26], [9.5, -18], [11.5, -5], [10.5, 11], [3.5, 11], [-3.5, 11], [-10.5, 11], [-11.5, -5], [-9.5, -18], [0, -26]];
const grow = (pts: readonly Point[]): Point[] => pts.map(([x, y]) => [x * ROCKET_SCALE, y * ROCKET_SCALE] as const);
const rocket = (pts: Point[]) => poly(place(grow(pts), ROCKET_TURN, ROCKET_X, ROCKET_Y));

const BOAT_TURN = -9;
const boat = (pts: Point[]) => poly(place(pts, BOAT_TURN, 50, 62));

const sunRays = [210, 240, 270, 300, 330];

type Cubic = readonly [Point, Point, Point, Point];

function bezier([p0, p1, p2, p3]: Cubic, t: number): [Point, Point] {
  const m = 1 - t;
  const x = m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0];
  const y = m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1];
  const dx = 3 * m * m * (p1[0] - p0[0]) + 6 * m * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy = 3 * m * m * (p1[1] - p0[1]) + 6 * m * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const len = Math.hypot(dx, dy) || 1;
  return [[x, y], [-dy / len, dx / len]];
}

/** A tapered band along a cubic centreline, half-width growing from w0 to w1 between t0 and t1. */
function band(c: Cubic, w0: number, w1: number, t0 = 0, t1 = 1): string {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = t0 + ((t1 - t0) * i) / 24;
    const [[x, y], [nx, ny]] = bezier(c, t);
    const w = w0 + (w1 - w0) * ((t - t0) / (t1 - t0));
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }
  return poly([...left, ...right.reverse()]);
}

function clipAbove(points: readonly Point[], cut: number, keepAbove: boolean): Point[] {
  const inside = (p: Point) => (keepAbove ? p[1] <= cut : p[1] >= cut);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (cut - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, cut]);
    }
  }
  return out;
}

const TRAIL: Cubic = [[9, 46], [7, 86], [34, 92], [42.5, 70]];
const rocketInset: Point[] = rocketBody.slice(0, -1).map(([x, y]) => [x * 0.74, (y + 6) * 0.8 - 6] as const);

export const OMO2_PINS: Record<AchievementId, Omo2Pin> = {
  firstFlow: {
    parts: ["M50 7C57 21 75 33 75 57C75 76 63 90 50 90C37 90 25 77 25 60C25 48 30 40 37 33C37 43 40 49 45 51C42 37 44 21 50 7Z"],
    fields: [
      { d: "M50 13.5C56.5 26 71.5 37 71.5 57C71.5 73.5 61.5 86.5 50 86.5C38.5 86.5 28.5 75.5 28.5 60C28.5 51 31.5 45 34.5 40.5C36 46.5 40 52 47.5 55C44.5 41 45.5 27 50 13.5Z", tone: "ent" },
      { d: "M51 44C56 54 64 60 64 70C64 79 58 84 50.5 84C43 84 37 79 37 71C37 64 42 59 47 55C48.5 51 50 48 51 44Z", tone: "ivory" },
      { d: "M50.5 63C53.5 67.5 56.5 70.5 56.5 74.5C56.5 78.5 53.5 80.5 50.5 80.5C47.5 80.5 44.5 78.5 44.5 74.5C44.5 70.5 47.5 67.5 50.5 63Z", tone: "shop" },
    ],
    main: "ent",
    compact: [0, 1],
    box: [7, 90],
    glint: [60.5, 24],
    star: [50, 72],
  },
  flow90: {
    parts: [
      circle(50, 57, 32),
      rrect(45, 16, 10, 12, 1.5),
      rrect(38.5, 9, 23, 9, 3.5),
      poly([[67.6, 34.2], [74.0, 27.8], [80.0, 33.8], [73.6, 40.2]]),
    ],
    fields: [
      { d: circle(50, 57, 25), tone: "ivory" },
      { d: "M50 57V32A25 25 0 0 1 75 57Z", tone: "focus" },
      { d: circle(50, 78.5, 1.9), tone: "metal" },
      { d: circle(28.5, 57, 1.9), tone: "metal" },
    ],
    wires: [{ d: "M50 57L36.5 43.5", w: 3.2 }],
    main: "focus",
    compact: [0, 1],
    box: [9, 89],
    glint: [29.5, 37],
    star: [37, 68],
  },
  flow180: {
    parts: [
      "M8 86L36 46L45 56L60 30L92 86Z",
      rrect(58.4, 7, 3.2, 26, 1.6),
      "M60.5 8L80 14L60.5 20Z",
    ],
    fields: [
      { d: "M14.5 83L36 52.3L44.8 62.2L60 36.2L86.8 83Z", tone: "learning" },
      { d: "M60 36.2L68.8 51.6L64.6 49L60.4 53.2L56.2 49L52.2 51.3Z", tone: "ivory" },
      { d: "M36 52.3L41.2 58.2L38.6 57L36 59.4L33.4 57L31.4 58.8Z", tone: "ivory" },
      { d: "M18.2 77.7H83.8L86.8 83H14.5Z", tone: "focus" },
      { d: "M63 10.9L73.5 14L63 17.1Z", tone: "drift" },
    ],
    main: "learning",
    compact: [0, 1],
    box: [7, 86],
    glint: [24, 64],
    star: [62, 68],
  },
  focusDay8h: {
    parts: [star(50, 50, 8, 45, 30)],
    fields: [
      { d: star(50, 50, 8, 39.5, 26.6), tone: "ent" },
      { d: circle(50, 50, 21), tone: "drift" },
      { d: circle(50, 50, 8), tone: "ivory" },
    ],
    main: "drift",
    compact: [0, 1],
    box: [5, 95],
    glint: [33, 35],
    star: [50, 50],
  },
  earlyStart: {
    parts: [
      rrect(9, 61, 82, 15, 7.5),
      "M27 63A23 23 0 0 1 73 63Z",
      ...sunRays.map((a) => ray(50, 63, a, 18, 39, 5.2, 3.4)),
    ],
    fields: [
      { d: "M30.5 63.5A19.5 19.5 0 0 1 69.5 63.5Z", tone: "ent" },
      ...sunRays.map((a) => ({ d: ray(50, 63, a, 26.5, 35.8, 2.4, 1.2), tone: "shop" as const })),
      { d: rrect(12.5, 64.5, 75, 8, 4), tone: "comm" },
    ],
    main: "ent",
    compact: [0, 6],
    box: [24, 76],
    glint: [16, 64.5],
    star: [50, 53],
  },
  nightOwl: {
    parts: ["M22 32L26 9L41.5 21.5Q50 19 58.5 21.5L74 9L78 32Q86.5 46 84.5 62Q80.5 89 50 91Q19.5 89 15.5 62Q13.5 46 22 32Z"],
    fields: [
      { d: "M25 33.5L28 15.5L40.6 25.4Q50 22.6 59.4 25.4L72 15.5L75 33.5Q82.8 46.4 81 61.6Q77.4 85.4 50 87.4Q22.6 85.4 19 61.6Q17.2 46.4 25 33.5Z", tone: "purple" },
      { d: "M50 37C44.5 30.5 25.5 30 24.5 47C23.5 63 40 67 50 59C60 67 76.5 63 75.5 47C74.5 30 55.5 30.5 50 37Z", tone: "ivory" },
      { d: circle(38.5, 47.5, 8.6), tone: "shop" },
      { d: circle(61.5, 47.5, 8.6), tone: "shop" },
      { d: circle(39.5, 48, 3.8), tone: "ink" },
      { d: circle(60.5, 48, 3.8), tone: "ink" },
      { d: "M50 55.5L54.2 60.5L50 67L45.8 60.5Z", tone: "game" },
    ],
    wires: [{ d: "M39 76L44.5 79.5L50 76L55.5 79.5L61 76", w: 2.6 }],
    main: "purple",
    compact: [0, 2, 3],
    box: [9, 91],
    glint: [27, 19],
    star: [50, 82],
  },
  weekendShift: {
    parts: [
      rrect(14, 31, 52, 56, 9),
      "M62 41H70C80.5 41 86 48 86 57C86 66.5 80 73 70 73H62V64H69C74 64 76.5 61 76.5 57C76.5 52.5 74 50 69 50H62Z",
    ],
    fields: [
      { d: rrect(17.5, 34.5, 45, 49, 6), tone: "learning" },
      { d: "M17.5 51H62.5V65H17.5Z", tone: "ivory" },
      { d: circle(32, 58, 3.4), tone: "drift" },
      { d: circle(48, 58, 3.4), tone: "drift" },
    ],
    wires: [
      { d: "M30 30C25.5 24 34.5 19.5 30 11", w: 4.4 },
      { d: "M48 30C43.5 24 52.5 19.5 48 11", w: 4.4 },
    ],
    main: "learning",
    compact: [0, 1],
    box: [11, 87],
    glint: [20, 37],
    star: [40, 75],
  },
  streak7: {
    parts: [rrect(14, 8, 72, 9, 4.5), "M22 14H78V87L50 73L22 87Z"],
    fields: pennantStripes(),
    main: "comm",
    compact: [0, 1, 2, 3, 4, 5, 6],
    box: [8, 87],
    glint: [20, 10.5],
    star: [50, 44],
  },
  streak30: {
    parts: [
      "M16 24Q16 16 24 16H76Q84 16 84 24V70L68 86H24Q16 86 16 78Z",
      rrect(29.5, 7, 8, 17, 4),
      rrect(62.5, 7, 8, 17, 4),
    ],
    fields: [
      { d: "M19.5 27Q19.5 19.5 27 19.5H73Q80.5 19.5 80.5 27V33H19.5Z", tone: "drift" },
      { d: "M19.5 36.5H80.5V68.6L66.6 82.5H26Q19.5 82.5 19.5 76Z", tone: "ivory" },
      { d: "M80.5 71.5L69.5 82.5L71.5 73.5Z", tone: "paper" },
    ],
    wires: [
      { d: "M32.5 45H45L38.5 53C44.5 52.5 47.5 56 47.5 61C47.5 66.5 43.5 70 38.5 70C35.5 70 33 68.5 31.8 66.5", w: 4 },
      { d: ellipse(60.5, 57.5, 7.5, 12), w: 4 },
    ],
    main: "drift",
    compact: [0, 1],
    box: [7, 86],
    glint: [33.5, 10],
    star: [72, 27],
  },
  focus100h: {
    parts: [
      "M26 14H74V34C74 52 64 61 50 62C36 61 26 52 26 34Z",
      rrect(45, 58, 10, 14, 2),
      rrect(36, 70, 28, 8, 3),
      rrect(27, 77, 46, 14, 3.5),
    ],
    fields: [
      { d: "M29.5 17.5H70.5V34C70.5 49.5 62 57.6 50 58.5C38 57.6 29.5 49.5 29.5 34Z", tone: "blue" },
      { d: star(50, 36, 5, 11, 4.6), tone: "metal" },
      { d: rrect(30.5, 80.5, 39, 7, 2.5), tone: "ink" },
    ],
    wires: [
      { d: "M27 22H19.5C14.5 22 13 26.5 13.5 31C14.5 40 21 45.5 29.5 46.5", w: 4.6 },
      { d: "M73 22H80.5C85.5 22 87 26.5 86.5 31C85.5 40 79 45.5 70.5 46.5", w: 4.6 },
    ],
    main: "blue",
    compact: [0, 2],
    box: [14, 91],
    glint: [31, 18],
    star: [50, 36],
  },
  driftDay: {
    parts: [
      boat([[0, -38], [17, -4], [-17, -4]]),
      boat([[-37, -4], [37, -4], [25, 12], [-25, 12]]),
      "M7 79C15 72.5 24 72.5 32 78.5C40 84.5 48 84.5 56 78.5C64 72.5 72 72.5 80 78.5C84 81.5 88 82 93 80.5V93H7Z",
    ],
    fields: [
      { d: "M10.5 81.4C17.5 76.5 24.5 76.5 31 81.3C40 88 48 88 57 81.3C63.5 76.5 72.5 76.5 79 81.3C83 84.3 86.5 85.2 89.5 84.8V89.5H10.5Z", tone: "comm" },
      { d: boat([[-32.5, -0.6], [32.5, -0.6], [23.4, 8.6], [-23.4, 8.6]]), tone: "paper" },
      { d: boat([[0, -31], [12.4, -6.5], [-12.4, -6.5]]), tone: "ivory" },
    ],
    main: "comm",
    compact: [0, 1, 2],
    box: [24, 93],
    glint: [52, 29],
    star: [30, 86],
  },
  noDriftDay: {
    parts: [rrect(4, 32, 92, 36, 10)],
    fields: [
      { d: rrect(8, 36, 20, 28, 6.5), tone: "comm" },
      { d: rrect(72, 36, 20, 28, 6.5), tone: "comm" },
      { d: rrect(32, 39, 36, 22, 11), tone: "focus" },
      { d: circle(50, 50, 5), tone: "ivory" },
    ],
    wires: [
      { d: "M41.5 43V57", w: 2.2 },
      { d: "M58.5 43V57", w: 2.2 },
    ],
    main: "focus",
    compact: [0, 1, 2],
    box: [32, 68],
    glint: [12, 35],
    star: [50, 50],
  },
  comeback: {
    parts: [
      rocket(rocketBody),
      rocket([[-10, -1], [-19, 10], [-19, 18], [-9.5, 12]]),
      rocket([[10, -1], [19, 10], [19, 18], [9.5, 12]]),
      rocket([[-6.5, 10], [6.5, 10], [6.5, 16], [-6.5, 16]]),
      curve(grow([[-6, 15], [-6, 23], [-2, 28], [0, 33], [2, 28], [6, 23], [6, 15]]), ROCKET_TURN, ROCKET_X, ROCKET_Y),
      band(TRAIL, 1.4, 9),
      circle(TRAIL[0][0], TRAIL[0][1], 1.6),
    ],
    fields: [
      { d: band(TRAIL, 1.9, 5.7, 0.22, 0.97), tone: "music" },
      { d: rocket(clipAbove(rocketInset, -9.5, false)), tone: "ivory" },
      { d: rocket(clipAbove(rocketInset, -12, true)), tone: "drift" },
      { d: (() => { const [[cx, cy]] = place(grow([[0, -2]]), ROCKET_TURN, ROCKET_X, ROCKET_Y); return circle(cx, cy, 4.4); })(), tone: "comm" },
      { d: curve(grow([[-3.5, 18], [-3.5, 23], [-1.5, 26], [0, 29], [1.5, 26], [3.5, 23], [3.5, 18]]), ROCKET_TURN, ROCKET_X, ROCKET_Y), tone: "shop" },
    ],
    main: "music",
    compact: [0, 1, 2],
    box: [10, 93],
    glint: [76, 17],
    star: [24, 82],
  },
};

/** The milestone bar under a repeatable pin, in the 120-unit badge space. */
export const OMO2_BAR = { x: 35, y: 104, w: 50, h: 9 } as const;
export const OMO2_STUD_X = [41.5, 48.9, 56.3, 63.7, 71.1, 78.5] as const;

/** A crimped foil blind-bag packet, in the 120-unit badge space. */
export function packetPath(): string {
  const left = 34;
  const right = 86;
  const top = 17;
  const bottom = 103;
  const teeth = 10;
  const step = (right - left) / teeth;
  let d = `M${left} ${top + 2}`;
  for (let i = 0; i < teeth; i += 1) d += `L${f(left + step * (i + 0.5))} ${top}L${f(left + step * (i + 1))} ${top + 2}`;
  d += `L${right} ${bottom - 2}`;
  for (let i = teeth; i > 0; i -= 1) d += `L${f(left + step * (i - 0.5))} ${bottom}L${f(left + step * (i - 1))} ${bottom - 2}`;
  return d + "Z";
}
