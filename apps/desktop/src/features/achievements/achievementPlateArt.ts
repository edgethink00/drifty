import type { AchievementGroup } from "./achievementCatalog";

/** Every group has one plate outline, so a glance at the shape says what kind of achievement it is. */
export type PlateShape = "hexagon" | "circle" | "shield" | "diamond";

export const PLATE_SHAPE_BY_GROUP: Record<AchievementGroup, PlateShape> = {
  focus: "hexagon",
  rhythm: "circle",
  consistency: "shield",
  unexpected: "diamond",
};

type Point = readonly [number, number];

function roundedPolygon(points: readonly Point[], radius: number): string {
  const corner = (from: Point, to: Point): Point => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [from[0] + ((to[0] - from[0]) * radius) / length, from[1] + ((to[1] - from[1]) * radius) / length];
  };
  const format = (point: Point) => point[0].toFixed(2) + " " + point[1].toFixed(2);
  return points.map((point, index) => {
    const before = points[(index + points.length - 1) % points.length];
    const after = points[(index + 1) % points.length];
    return (index === 0 ? "M" : "L") + format(corner(point, before)) + " Q" + format(point) + " " + format(corner(point, after));
  }).join(" ") + " Z";
}

/** Outlines on a 100 × 100 grid. */
export const PLATE_PATHS: Record<PlateShape, string> = {
  hexagon: roundedPolygon([[50, 7], [87.2, 28.5], [87.2, 71.5], [50, 93], [12.8, 71.5], [12.8, 28.5]], 8),
  circle: "M50 8 A42 42 0 1 1 49.99 8 Z",
  shield: "M23 11 H77 Q87 11 87 21 V50 C87 69 72 83 50 93 C28 83 13 69 13 50 V21 Q13 11 23 11 Z",
  diamond: roundedPolygon([[50, 5], [95, 50], [50, 95], [5, 50]], 11),
};

export type PlateLine = readonly [number, number, number, number];

/**
 * Two veils of fine straight lines, each strung between neighbouring sides of
 * the plate so they read as a curve. The achievement's id picks the corners
 * and the density, so every plate carries its own pattern and keeps it.
 */
export function plateVeils(seed: string): PlateLine[] {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const density = 11 + (hash % 6);
  const firstCorner = (hash >>> 3) % 4;
  const low = 6;
  const span = 88;
  const lines: PlateLine[] = [];
  const string = (corner: number, count: number) => {
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      let from: Point = [low, low + t * span];
      let to: Point = [low + t * span, low + span];
      for (let turn = 0; turn < corner; turn += 1) {
        from = [100 - from[1], from[0]];
        to = [100 - to[1], to[0]];
      }
      lines.push([from[0], from[1], to[0], to[1]]);
    }
  };
  string(firstCorner, density);
  string((firstCorner + 2) % 4, Math.max(6, density - 5));
  return lines;
}
