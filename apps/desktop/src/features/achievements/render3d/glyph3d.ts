import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ACHIEVEMENT_GLYPH_PATHS, type AchievementGlyphName } from "../AchievementGlyph";

/** The line glyph's strokes as 2D polylines, centred, y up, scaled so 24 units become size. */
export function glyphPolylines(name: AchievementGlyphName, size: number): THREE.Vector2[][] {
  const loader = new SVGLoader();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + ACHIEVEMENT_GLYPH_PATHS[name].map((d) => '<path d="' + d + '"/>').join("") + "</svg>";
  const scale = size / 24;
  const lines: THREE.Vector2[][] = [];
  for (const shapePath of loader.parse(svg).paths) {
    for (const sub of shapePath.subPaths) {
      const points = sub.getPoints(10).map((point: THREE.Vector2) => new THREE.Vector2((point.x - 12) * scale, (12 - point.y) * scale));
      const cleaned: THREE.Vector2[] = [];
      for (const point of points) {
        const last = cleaned[cleaned.length - 1];
        if (!last || last.distanceTo(point) > size * 0.004) cleaned.push(point);
      }
      if (cleaned.length === 0 && points[0]) cleaned.push(points[0]);
      lines.push(cleaned);
    }
  }
  return lines;
}

/** Round-capped tubes along the glyph's strokes, lying in the XY plane at z. */
export function glyphTubes(name: AchievementGlyphName, size: number, radius: number, z = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const line of glyphPolylines(name, size)) {
    line.forEach((point) => {
      const joint = new THREE.SphereGeometry(radius, 14, 10);
      joint.translate(point.x, point.y, z);
      parts.push(joint);
    });
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1]!;
      const b = line[index]!;
      const length = a.distanceTo(b);
      if (length < 1e-4) continue;
      const segment = new THREE.CylinderGeometry(radius, radius, length, 14, 1, true);
      const direction = new THREE.Vector3(b.x - a.x, b.y - a.y, 0).normalize();
      segment.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
      segment.translate((a.x + b.x) / 2, (a.y + b.y) / 2, z);
      parts.push(segment);
    }
  }
  const merged = mergeGeometries(parts.map((part) => part.toNonIndexed()));
  parts.forEach((part) => part.dispose());
  return merged ?? new THREE.BufferGeometry();
}

/** The glyph drawn into a square texture, for printing on curved glass. */
export function glyphTexture(name: AchievementGlyphName, px = 256, line = 1.9): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(px / 24, px / 24);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = line;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d of ACHIEVEMENT_GLYPH_PATHS[name]) ctx.stroke(new Path2D(d));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
