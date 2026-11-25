import * as THREE from "three";
import type { AchievementGroup, AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { reliefMark } from "./marks";
import { BADGE_COLORS, ROSE_GOLD, SILVER } from "./palette";
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

export function outline(group: AchievementGroup, scale: number): THREE.Shape {
  switch (group) {
    case "focus": return circle(0.98 * scale);
    case "rhythm": return roundedPolygon(6, 1.06 * scale, 0.22 * scale);
    case "consistency": return roundedPolygon(4, 1.22 * scale, 0.34 * scale, Math.PI / 4);
    default: return roundedPolygon(8, 1.03 * scale, 0.16 * scale, Math.PI / 8);
  }
}

/** Engine-turned guilloché under the enamel, a different pattern for each group. */
export function guilloche(group: AchievementGroup): THREE.CanvasTexture {
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

/** The enamel colour: the achievement's own colour, muted (half the saturation, a touch lighter, never past 62% light). */
export function enamelColor(id: AchievementId): THREE.Color {
  const color = new THREE.Color(BADGE_COLORS[id]);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return color.setHSL(hsl.h, hsl.s * 0.5, Math.min(0.62, hsl.l * 0.88 + 0.05));
}

/** The coin's metal: silver at first, rose gold from ten times. */
function metalMaterial(roseGold: boolean): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: roseGold ? ROSE_GOLD : SILVER, metalness: 1, roughness: 0.2, clearcoat: 0.4, clearcoatRoughness: 0.12 });
}

/** The coin's proportions: a thick backing plate, a narrow raised rim, the enamel field set into it. */
const COIN = { backDepth: 0.24, backBevel: 0.07, rimInner: 0.88, rimDepth: 0.1, field: 0.88, fieldZ: 0.06, fieldDepth: 0.03, fieldBevel: 0.01 } as const;

/**
 * Drifty's achievement medal (owner choice 2026-11-26): a thick coin with a
 * narrow raised rim, an engine-turned enamel field in the achievement's muted
 * colour, and its pictogram raised in relief from the field in the rim's
 * metal. The metal is silver at first and rose gold from ten times, with an
 * inner rose-gold band from fifty. Until earned it is an unstruck blank in
 * matte grey.
 */
export function buildMedal({ id, group, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const roseGold = earned && tier >= 3;
  const metal = earned ? metalMaterial(roseGold) : new THREE.MeshPhysicalMaterial({ color: 0xb6bac0, metalness: 0.45, roughness: 0.62 });
  const color = enamelColor(id);
  const enamel = new THREE.MeshPhysicalMaterial(earned
    ? { color, emissive: color, emissiveIntensity: 0.16, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, bumpMap: guilloche(group), bumpScale: 0.9, iridescence: 0.2, iridescenceIOR: 1.3 }
    : { color: 0xd0d3d7, roughness: 0.82 });
  const group3d = new THREE.Group();

  const back = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(group, 1), { depth: COIN.backDepth, bevelEnabled: true, bevelThickness: COIN.backBevel, bevelSize: COIN.backBevel, bevelSegments: 10, curveSegments: 64 }), metal);
  back.position.z = -COIN.backDepth;
  group3d.add(back);

  const ring = outline(group, 1);
  ring.holes.push(outline(group, COIN.rimInner) as unknown as THREE.Path);
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: COIN.rimDepth, bevelEnabled: true, bevelThickness: COIN.rimDepth * 0.5, bevelSize: (1 - COIN.rimInner) * 0.18, bevelSegments: 10, curveSegments: 64 }), metal);
  group3d.add(rim);

  const field = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(group, COIN.field), { depth: COIN.fieldDepth, bevelEnabled: true, bevelThickness: COIN.fieldBevel, bevelSize: COIN.fieldBevel, bevelSegments: 3, curveSegments: 64 }), enamel);
  field.position.z = COIN.fieldZ;
  group3d.add(field);
  const fieldTop = COIN.fieldZ + COIN.fieldDepth + COIN.fieldBevel;

  if (earned && tier >= 5) {
    const inner = outline(group, COIN.field - 0.06);
    inner.holes.push(outline(group, COIN.field - 0.1) as unknown as THREE.Path);
    const band = new THREE.Mesh(new THREE.ExtrudeGeometry(inner, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.008, bevelSegments: 3, curveSegments: 64 }), metal);
    band.position.z = fieldTop - 0.015;
    group3d.add(band);
  }

  // The pictogram stands from the field in the rim's metal; lower and matte on a blank.
  const markMaterial = earned ? metalMaterial(roseGold) : new THREE.MeshPhysicalMaterial({ color: 0xe6e8eb, roughness: 0.7 });
  const mark = new THREE.Mesh(reliefMark(state === "concealed" ? "hidden" : id, 1.02 * (COIN.field / 0.8)), markMaterial);
  mark.scale.z = earned ? 1 : 0.6;
  mark.position.z = fieldTop - 0.004;
  group3d.add(mark);

  group3d.rotation.set(-0.08, 0.3, 0);
  return {
    object: group3d,
    frame: 1.3,
    lift: 0.08,
    shadow: { y: -1.22, width: 2.2, depth: 0.5, strength: 0.28 },
    backFace: -(COIN.backDepth + COIN.backBevel) - 0.002,
    engraveColor: metal.color.clone().multiplyScalar(0.55).getHex(),
  };
}
