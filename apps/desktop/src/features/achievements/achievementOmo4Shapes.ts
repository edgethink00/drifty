import type { AchievementGroup } from "./achievementCatalog";

/** Geometry for the omo 4 stamps, all in a 120 x 120 box centred on 60, 60. */
export const CX = 60;
export const CY = 60;

const round = (value: number) => Math.round(value * 100) / 100;

export function polar(cx: number, cy: number, r: number, degrees: number): readonly [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a))];
}

function circle(r: number): string {
  return `M${CX - r} ${CY}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

function roundedPolygon(sides: number, apothem: number, corner: number): string {
  const step = (2 * Math.PI) / sides;
  const radius = apothem / Math.cos(Math.PI / sides);
  const cut = corner * Math.tan(Math.PI / sides);
  const vertices = Array.from({ length: sides }, (_, k) => {
    const a = (k + 0.5) * step - Math.PI / 2;
    return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)] as const;
  });
  const toward = (from: readonly [number, number], to: readonly [number, number], distance: number) => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    return [round(from[0] + (dx / length) * distance), round(from[1] + (dy / length) * distance)] as const;
  };
  let d = "";
  vertices.forEach((vertex, k) => {
    const previous = vertices[(k + sides - 1) % sides];
    const next = vertices[(k + 1) % sides];
    const enter = toward(vertex, previous, cut);
    const leave = toward(vertex, next, cut);
    d += (k === 0 ? "M" : "L") + enter[0] + " " + enter[1];
    d += `A${round(corner)} ${round(corner)} 0 0 1 ${leave[0]} ${leave[1]}`;
  });
  return d + "Z";
}

function scallop(base: number, bumps: number): string {
  const chord = 2 * base * Math.sin(Math.PI / bumps);
  const arc = round(chord * 0.64);
  let d = "";
  for (let k = 0; k <= bumps; k += 1) {
    const [x, y] = polar(CX, CY, base, (k * 360) / bumps - 90);
    d += k === 0 ? `M${x} ${y}` : `A${arc} ${arc} 0 0 1 ${x} ${y}`;
  }
  return d + "Z";
}

/**
 * The stamp outline for a group, grown (or shrunk, when negative) by `grow`.
 * focus: a circle, rhythm: an octagon, consistency: a rounded square, unexpected: a seal edge.
 * `plain` swaps the seal edge for its inner circle, for rims and rings drawn inside or around it.
 */
export function framePath(group: AchievementGroup, grow = 0, plain = false): string {
  switch (group) {
    case "rhythm": return roundedPolygon(8, 41.5 + grow, Math.max(0.6, 4.5 + grow));
    case "consistency": return roundedPolygon(4, 39 + grow, Math.max(0.6, 12 + grow));
    case "unexpected": return plain ? circle(40.5 + grow) : scallop(41.2 + grow, 22);
    default: return circle(44 + grow);
  }
}

export function starPath(cx: number, cy: number, r: number): string {
  const points = Array.from({ length: 10 }, (_, k) => polar(cx, cy, k % 2 === 0 ? r : r * 0.45, k * 36 - 90));
  return "M" + points.map(([x, y]) => x + " " + y).join("L") + "Z";
}

export function twinklePath(cx: number, cy: number, r: number): string {
  const w = r * 0.28;
  return `M${cx} ${cy - r}Q${cx + w} ${cy - w} ${cx + r} ${cy}Q${cx + w} ${cy + w} ${cx} ${cy + r}Q${cx - w} ${cy + w} ${cx - r} ${cy}Q${cx - w} ${cy - w} ${cx} ${cy - r}Z`;
}
