import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AchievementGlyphName } from "../AchievementGlyph";

/*
 * The pictograms at a medal's centre, drawn for the medal as filled shapes
 * that stand from the field like a struck coin's design, rather than the
 * screen's line icons. Authored on the icons' 24-unit grid, centred, y up.
 */

type Point = readonly [number, number];

const TAU = Math.PI * 2;

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 32): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / steps;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  });
}

// ---- Filled shapes ----

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

// ---- Geometry ----

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

/** The achievement's pictogram as a relief standing from z = 0 upward, scaled so 24 units span size. */
export function reliefMark(name: AchievementGlyphName, size: number): THREE.BufferGeometry {
  return relief(reliefShapes(name), (size / 24) * 0.95, 0.07);
}
