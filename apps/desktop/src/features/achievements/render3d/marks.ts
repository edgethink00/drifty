import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AchievementGlyphName } from "../AchievementGlyph";
import type { MedalArt } from "../medalStyle";
import { glyphTubes } from "./glyph3d";

/*
 * The marks at a medal's centre, drawn for the medal rather than borrowed from
 * the screen icons. Everything is authored on the icons' 24-unit grid with the
 * origin at the centre and y up, then scaled so 24 units span size.
 *
 *   relief   filled pictograms standing flat from the field, as a struck coin's design does
 *   seal     the relief smaller, inside a fine ring, like a stamp
 *   geo      no pictures: arcs, dots and ticks that hint at what was done
 *   numeral  the achievement's number, set in a plain geometric figure; geo where there is none
 */

type Point = readonly [number, number];
type Stroke = readonly Point[];

const TAU = Math.PI * 2;

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 32): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / steps;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  });
}

function ring(cx: number, cy: number, r: number, steps = 48): Point[] {
  return arc(cx, cy, r, 0, TAU, steps);
}

// ---- Filled shapes for relief and seal ----

function circleShape(cx: number, cy: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(cx, cy, r, 0, TAU, false);
  return shape;
}

function circlePath(cx: number, cy: number, r: number): THREE.Path {
  const path = new THREE.Path();
  path.absarc(cx, cy, r, 0, TAU, true);
  return path;
}

function polygonShape(points: readonly Point[]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

function polygonPath(points: readonly Point[]): THREE.Path {
  const path = new THREE.Path();
  [...points].reverse().forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
  return path;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number, hole = false): THREE.Shape | THREE.Path {
  const s = hole ? new THREE.Path() : new THREE.Shape();
  if (hole) {
    s.moveTo(x + r, y);
    s.absarc(x + r, y + r, r, -Math.PI / 2, -Math.PI, true);
    s.lineTo(x, y + h - r);
    s.absarc(x + r, y + h - r, r, Math.PI, Math.PI / 2, true);
    s.lineTo(x + w - r, y + h);
    s.absarc(x + w - r, y + h - r, r, Math.PI / 2, 0, true);
    s.lineTo(x + w, y + r);
    s.absarc(x + w - r, y + r, r, 0, -Math.PI / 2, true);
  } else {
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x + w, y + h - r);
    s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h);
    s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r);
    s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  }
  s.closePath();
  return s;
}

/** A thick stroke as filled shapes: a round-ended bar per segment and a disc at each joint, overlapping into one form. */
function strokeShapes(points: readonly Point[], width: number): THREE.Shape[] {
  const half = width / 2;
  const shapes: THREE.Shape[] = points.map(([x, y]) => circleShape(x, y, half));
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1]!;
    const [bx, by] = points[index]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-4) continue;
    const nx = (-(by - ay) / length) * half;
    const ny = ((bx - ax) / length) * half;
    shapes.push(polygonShape([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]));
  }
  return shapes;
}

function sine(x0: number, x1: number, y: number, amplitude: number, waves: number, steps = 40): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const x = x0 + ((x1 - x0) * index) / steps;
    return [x, y + Math.sin(((x - x0) / (x1 - x0)) * waves * TAU) * amplitude] as const;
  });
}

/** The crescent left when a circle is taken from another, as one outline. */
function crescent(R: number, cx: number, cy: number, r: number): THREE.Shape {
  // Where the two circles cross, found along the line between their centres.
  const d = Math.hypot(cx, cy);
  const a = (R * R - r * r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const ux = cx / d;
  const uy = cy / d;
  const p1: Point = [a * ux - h * uy, a * uy + h * ux];
  const p2: Point = [a * ux + h * uy, a * uy - h * ux];
  const angle = (p: Point, ox: number, oy: number) => Math.atan2(p[1] - oy, p[0] - ox);
  const shape = new THREE.Shape();
  shape.moveTo(p1[0], p1[1]);
  // The outer circle the long way round, from one crossing to the other.
  shape.absarc(0, 0, R, angle(p1, 0, 0), angle(p2, 0, 0), false);
  // Back along the inner circle, the short way.
  shape.absarc(cx, cy, r, angle(p2, cx, cy), angle(p1, cx, cy), true);
  shape.closePath();
  return shape;
}

const RAYS = (count: number, r0: number, r1: number, start = 0): Point[][] =>
  Array.from({ length: count }, (_, index) => {
    const angle = start + (index / count) * TAU;
    return [[Math.cos(angle) * r0, Math.sin(angle) * r0], [Math.cos(angle) * r1, Math.sin(angle) * r1]];
  });

/** Each mark as filled shapes on the 24-unit grid, centred, y up. */
function reliefShapes(name: AchievementGlyphName): THREE.Shape[] {
  switch (name) {
    case "firstFlow": {
      const left = new THREE.Shape();
      left.moveTo(-0.6, -0.6); left.quadraticCurveTo(-8, -1, -7.6, 5.4); left.quadraticCurveTo(-1.2, 5.6, -0.6, -0.6);
      const right = new THREE.Shape();
      right.moveTo(0.6, 1.2); right.quadraticCurveTo(0.6, 8.6, 8.4, 8.6); right.quadraticCurveTo(8.6, 1.2, 0.6, 1.2);
      return [...strokeShapes([[0, -8.5], [0, 1.4]], 2.2), left, right];
    }
    case "flow90": {
      const body = circleShape(0, -1.6, 7.4);
      body.holes.push(roundedRect(-1, -1.6 - 1, 2, 6.2, 1, true) as THREE.Path);
      return [body, roundedRect(-2.4, 7.4, 4.8, 2, 0.8) as THREE.Shape, polygonShape([[-0.9, 5.4], [0.9, 5.4], [0.9, 7.6], [-0.9, 7.6]])];
    }
    case "flow180":
      return [polygonShape([[-10, -7], [-3.6, 5], [0.2, -1.2], [3, 2.8], [10, -7]]), circleShape(6.4, 6.2, 2)];
    case "focusDay8h":
      return [circleShape(0, 0, 4.4), ...RAYS(8, 6.4, 9, Math.PI / 8).flatMap((ray) => strokeShapes(ray, 2))];
    case "earlyStart": {
      const sun = new THREE.Shape();
      sun.moveTo(-5.4, -2.6); sun.absarc(0, -2.6, 5.4, Math.PI, 0, true); sun.closePath();
      return [sun, ...strokeShapes([[-9.6, -4.6], [9.6, -4.6]], 2), ...[Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4].flatMap((a) => strokeShapes([[Math.cos(a) * 7.2, -2.6 + Math.sin(a) * 7.2], [Math.cos(a) * 9.4, -2.6 + Math.sin(a) * 9.4]], 2))];
    }
    case "nightOwl":
      return [crescent(8, 3.6, 3, 6.6)];
    case "weekendShift": {
      const body = roundedRect(-9, -7, 18, 12, 2.2) as THREE.Shape;
      body.holes.push(roundedRect(-1.4, -2.2, 2.8, 2.6, 0.8, true) as THREE.Path);
      const handle = roundedRect(-4, 4, 8, 4.4, 1.6) as THREE.Shape;
      handle.holes.push(roundedRect(-2.4, 4.2, 4.8, 2.4, 0.8, true) as THREE.Path);
      return [body, handle];
    }
    case "streak7": {
      const page = roundedRect(-8.5, -9, 17, 15, 2.2) as THREE.Shape;
      page.holes.push(polygonPath([[-4.6, -2], [-1.4, -5.2], [5, 1.2], [3.4, 2.8], [-1.4, -2], [-3, -0.4]]));
      return [page, ...strokeShapes([[-4.4, 5], [-4.4, 8.6]], 2), ...strokeShapes([[4.4, 5], [4.4, 8.6]], 2)];
    }
    case "streak30": {
      const page = roundedRect(-8.5, -9, 17, 15, 2.2) as THREE.Shape;
      for (const [x, y] of [[-5, -1], [-1, -1], [3, -1], [-5, -5.6], [-1, -5.6], [3, -5.6]] as const) page.holes.push(roundedRect(x, y, 2.4, 2.4, 0.5, true) as THREE.Path);
      return [page, ...strokeShapes([[-4.4, 5], [-4.4, 8.6]], 2), ...strokeShapes([[4.4, 5], [4.4, 8.6]], 2)];
    }
    case "focus100h": {
      const gem = polygonShape([[-5.6, 7], [5.6, 7], [9.6, 2], [0, -9.6], [-9.6, 2]]);
      gem.holes.push(polygonPath([[-7.4, 1.2], [7.4, 1.2], [7.9, 2.6], [-7.9, 2.6]]));
      return [gem];
    }
    case "driftDay":
      return [-5.4, 0, 5.4].flatMap((y) => strokeShapes(sine(-9, 9, y, 1.4, 1.5), 2.2));
    case "noDriftDay": {
      const outer = circleShape(0, 0, 9.4); outer.holes.push(circlePath(0, 0, 7.2));
      const inner = circleShape(0, 0, 5.2); inner.holes.push(circlePath(0, 0, 3));
      return [outer, inner, circleShape(0, 0, 1.4)];
    }
    case "comeback":
      return [...strokeShapes([[-9, -5.6], [-3.4, 0], [0.6, -4], [7.6, 3]], 2.4), polygonShape([[3.4, 5.4], [9.6, 5], [9.2, -1.2]])];
    default:
      return [...strokeShapes(arc(0, 3.4, 3.8, Math.PI * 1.05, -Math.PI * 0.35, 20).concat([[1.2, -1.4], [0, -2.8], [0, -4]]), 2.4), circleShape(0, -7.6, 1.5)];
  }
}

// ---- Strokes for geo and numeral ----

/** No pictures: each mark as arcs, dots and ticks. */
function geoStrokes(name: AchievementGlyphName): Stroke[] {
  switch (name) {
    case "firstFlow": return [ring(0, -3, 1.6, 16), arc(0, -3, 6.2, -Math.PI * 0.15, Math.PI * 0.85)];
    case "flow90": return [arc(0, 0, 7.6, Math.PI / 2, Math.PI / 2 - Math.PI * 1.5, 48), ring(0, 7.6, 0.01, 1), ring(0, 0, 1.4, 16)];
    case "flow180": return [ring(0, 0, 8, 56), ring(0, 0, 5.2, 40), ring(0, 0, 2.4, 20)];
    case "focusDay8h": return [ring(0, 0, 4, 32), ...RAYS(8, 6.6, 8.8)];
    case "earlyStart": return [[[-9, -3], [9, -3]], arc(0, -3, 5.6, 0, Math.PI, 28), [[0, 4.8], [0, 4.8]]];
    case "nightOwl": {
      const outer = arc(0, 0, 8, Math.PI * 0.32, Math.PI * 1.85, 40);
      return [outer, arc(3.6, 3, 6.6, Math.PI * 0.05, Math.PI * 1.06, 36)];
    }
    case "weekendShift": return [ring(-3.6, 1.6, 2.4, 20), ring(3.6, 1.6, 2.4, 20), [[-7, -4], [7, -4]]];
    case "streak7": return Array.from({ length: 7 }, (_, index) => { const a = Math.PI - (index / 6) * Math.PI; return [[Math.cos(a) * 7.6, Math.sin(a) * 7.6 - 2.4], [Math.cos(a) * 7.6, Math.sin(a) * 7.6 - 2.4]] as Stroke; }).concat([[[-3, -5.4], [3, -5.4]]]);
    case "streak30": return [...RAYS(30, 7.2, 9), ring(0, 0, 1.4, 16)];
    case "focus100h": return [[[0, 8.6], [8.6, 0], [0, -8.6], [-8.6, 0], [0, 8.6]], [[0, 4.6], [4.6, 0], [0, -4.6], [-4.6, 0], [0, 4.6]]];
    case "driftDay": return [sine(-9, 9, 0, 3, 1.5, 48)];
    case "noDriftDay": return [ring(0, 0, 8, 56), [[0, 0], [0, 0]]];
    case "comeback": return [arc(0, -1, 6, Math.PI * 1.1, -Math.PI * 0.35, 36), [[5.6, -6.2], [4.6, -3.2], [7.6, -2.4]]];
    default: return Array.from({ length: 8 }, (_, index) => { const a = (index / 8) * TAU; return [[Math.cos(a) * 7, Math.sin(a) * 7], [Math.cos(a) * 7, Math.sin(a) * 7]] as Stroke; }).concat([ring(0, 0, 0.01, 1)]);
  }
}

/** A plain geometric figure set on a 5 by 9 cell, origin at its lower left. */
const FIGURES: Readonly<Record<string, readonly Stroke[]>> = {
  "0": [[...arc(2.5, 6.5, 2.5, 0, Math.PI, 14), ...arc(2.5, 2.5, 2.5, Math.PI, TAU, 14), [5, 6.5]]],
  "1": [[[1, 7.4], [2.9, 9], [2.9, 0]]],
  "2": [[...arc(2.5, 6.6, 2.4, Math.PI * 0.95, -Math.PI * 0.18, 16), [0.1, 0], [5, 0]]],
  "3": [[...arc(2.4, 6.9, 2.1, Math.PI * 0.9, -Math.PI * 0.5, 16)], [...arc(2.4, 2.5, 2.4, Math.PI * 0.5, -Math.PI * 0.9, 18)]],
  "5": [[[4.7, 9], [0.8, 9], [0.4, 5], ...arc(2.5, 2.7, 2.6, Math.PI * 0.72, -Math.PI * 0.9, 20)]],
  "7": [[[0, 9], [5, 9], [1.8, 0]]],
  "8": [ring(2.5, 6.9, 2.1, 24), ring(2.5, 2.4, 2.5, 28)],
  "9": [[...ring(2.5, 6.4, 2.5, 28)], [[5, 6.4], [3.6, 0]]],
  h: [[[0.3, 9], [0.3, 0]], [[0.3, 3.4], ...arc(2.5, 3.4, 2.2, Math.PI, 0, 14), [4.7, 0]]],
};

const NUMBERS: Readonly<Partial<Record<AchievementGlyphName, string>>> = {
  firstFlow: "25", flow90: "90", flow180: "180", focusDay8h: "8h", streak7: "7", streak30: "30", focus100h: "100",
};

function numeralStrokes(text: string): Stroke[] {
  const gap = 1.8;
  const width = text.length * 5 + (text.length - 1) * gap;
  const scale = Math.min(1.25, 16 / width);
  const x0 = (-width * scale) / 2;
  const y0 = (-9 * scale) / 2;
  return [...text].flatMap((char, index) => (FIGURES[char] ?? []).map((stroke) => stroke.map(([x, y]) => [x0 + (x + index * (5 + gap)) * scale, y0 + y * scale] as const)));
}

// ---- Geometry ----

function tubes(strokes: readonly Stroke[], scale: number, radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const stroke of strokes) {
    const points = stroke.map(([x, y]) => new THREE.Vector2(x * scale, y * scale));
    for (const point of points) {
      const joint = new THREE.SphereGeometry(radius, 14, 10);
      joint.translate(point.x, point.y, 0);
      parts.push(joint);
    }
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!;
      const b = points[index]!;
      const length = a.distanceTo(b);
      if (length < 1e-4) continue;
      const segment = new THREE.CylinderGeometry(radius, radius, length, 14, 1, true);
      segment.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(b.x - a.x, b.y - a.y, 0).normalize()));
      segment.translate((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
      parts.push(segment);
    }
  }
  const merged = mergeGeometries(parts.map((part) => part.toNonIndexed()));
  parts.forEach((part) => part.dispose());
  return merged ?? new THREE.BufferGeometry();
}

function relief(shapes: readonly THREE.Shape[], scale: number, depth: number): THREE.BufferGeometry {
  const parts = shapes.map((shape) => {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.35, bevelSize: 0.22, bevelSegments: 4, curveSegments: 24 });
    geometry.scale(scale, scale, 1);
    return geometry.toNonIndexed();
  });
  const merged = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  return merged ?? new THREE.BufferGeometry();
}

/**
 * The mark's geometry for a design: tubes lie centred on z = 0 (half above
 * the field when set on it); reliefs stand from z = 0 upward.
 */
export function markGeometry(art: MedalArt, name: AchievementGlyphName, size: number, earned: boolean): { readonly geometry: THREE.BufferGeometry; readonly standing: boolean } {
  const scale = size / 24;
  const radius = (earned ? 0.088 : 0.074) * (size / 1.02);
  switch (art) {
    case "relief":
      return { geometry: relief(reliefShapes(name), scale * 0.95, 0.07), standing: true };
    case "seal": {
      const inner = relief(reliefShapes(name), scale * 0.62, 0.06);
      const band = tubes([ring(0, 0, 10.4, 72)], scale, radius * 0.5);
      band.translate(0, 0, 0.03);
      const merged = mergeGeometries([inner, band]);
      return { geometry: merged ?? inner, standing: true };
    }
    case "geo":
      return { geometry: tubes(geoStrokes(name), scale, radius * 0.8), standing: false };
    case "numeral": {
      const number = NUMBERS[name];
      return { geometry: tubes(number ? numeralStrokes(number) : geoStrokes(name), scale, radius * 0.9), standing: false };
    }
    default:
      return { geometry: glyphTubes(name, size, radius, 0), standing: false };
  }
}
