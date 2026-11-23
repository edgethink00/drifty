import * as THREE from "three";
import type { AchievementGroup } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { glyphTubes } from "./glyph3d";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

function roundedPolygon(sides: number, radius: number, corner: number, rotation = 0): THREE.Shape {
  const shape = new THREE.Shape();
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * Math.PI * 2;
    return new THREE.Vector2(Math.sin(angle) * radius, Math.cos(angle) * radius);
  });
  points.forEach((point, index) => {
    const previous = points[(index + sides - 1) % sides]!;
    const next = points[(index + 1) % sides]!;
    const into = point.clone().sub(previous).normalize().multiplyScalar(corner);
    const out = next.clone().sub(point).normalize().multiplyScalar(corner);
    const start = point.clone().sub(into);
    const end = point.clone().add(out);
    if (index === 0) shape.moveTo(start.x, start.y);
    else shape.lineTo(start.x, start.y);
    shape.quadraticCurveTo(point.x, point.y, end.x, end.y);
  });
  shape.closePath();
  return shape;
}

function circle(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

function outline(group: AchievementGroup, scale: number): THREE.Shape {
  switch (group) {
    case "focus": return circle(0.98 * scale);
    case "rhythm": return roundedPolygon(6, 1.06 * scale, 0.22 * scale);
    case "consistency": return roundedPolygon(4, 1.22 * scale, 0.34 * scale, Math.PI / 4);
    default: return roundedPolygon(8, 1.03 * scale, 0.16 * scale, Math.PI / 8);
  }
}

/** Engine-turned guilloché under the enamel, a different pattern for each group. */
function guilloche(group: AchievementGroup): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    const c = size / 2;
    if (group === "focus") {
      for (let r = 6; r < size * 0.75; r += 7) { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); }
    } else if (group === "rhythm") {
      for (let index = 0; index < 120; index += 1) {
        const angle = (index / 120) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(angle) * size, c + Math.sin(angle) * size); ctx.stroke();
      }
    } else if (group === "consistency") {
      for (let x = -size; x < size * 2; x += 10) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + size, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, size); ctx.lineTo(x + size, 0); ctx.stroke();
      }
    } else {
      for (let y = -20; y < size + 20; y += 9) {
        ctx.beginPath();
        for (let x = 0; x <= size; x += 4) ctx.lineTo(x, y + Math.sin(x / 18) * 6);
        ctx.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.55, 0.55);
  texture.offset.set(0.5, 0.5);
  return texture;
}

/**
 * A struck metal award: a raised rim, a recessed enamel field in the
 * achievement's colour and the mark standing up from it in polished metal.
 * Silver at first, gold from ten times, with a second inner ring at fifty.
 */
export function buildMedal({ id, group, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const metal = !earned ? METALS.pewter : tier >= 3 ? METALS.gold : METALS.silver;
  const metalMaterial = new THREE.MeshPhysicalMaterial({ color: metal.color, metalness: 1, roughness: metal.roughness * 0.7, clearcoat: earned ? 0.4 : 0, clearcoatRoughness: 0.1 });
  const enamel = new THREE.MeshPhysicalMaterial(earned
    ? { color: BADGE_COLORS[id], emissive: BADGE_COLORS[id], emissiveIntensity: 0.18, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, bumpMap: guilloche(group), bumpScale: 1.4, iridescence: 0.25, iridescenceIOR: 1.3 }
    : { color: 0xc4c7cc, roughness: 0.75 });
  const group3d = new THREE.Group();

  const back = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(group, 1), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 8, curveSegments: 64 }), metalMaterial);
  back.position.z = -0.1;
  group3d.add(back);

  const ring = outline(group, 1);
  ring.holes.push(outline(group, 0.8) as unknown as THREE.Path);
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.035, bevelSegments: 10, curveSegments: 64 }), metalMaterial);
  rim.position.z = 0;
  group3d.add(rim);

  const field = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(group, 0.8), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 4, curveSegments: 64 }), enamel);
  field.position.z = 0.02;
  group3d.add(field);

  if (earned && tier >= 5) {
    const inner = outline(group, 0.74);
    inner.holes.push(outline(group, 0.7) as unknown as THREE.Path);
    const band = new THREE.Mesh(new THREE.ExtrudeGeometry(inner, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.008, bevelSegments: 3, curveSegments: 64 }), metalMaterial);
    band.position.z = 0.06;
    group3d.add(band);
  }

  const mark = new THREE.Mesh(glyphTubes(state === "concealed" ? "hidden" : id, 1.0, 0.068, 0.1), metalMaterial);
  group3d.add(mark);

  group3d.rotation.set(-0.08, 0.36, 0);
  return { object: group3d, frame: 1.3, lift: 0.08, shadow: { y: -1.22, width: 2.2, depth: 0.5, strength: 0.28 } };
}
