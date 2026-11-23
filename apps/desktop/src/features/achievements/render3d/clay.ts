import * as THREE from "three";
import type { AchievementArtProps } from "../achievementArt";
import { glyphTubes } from "./glyph3d";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

function squircle(size: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const half = size / 2;
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.bezierCurveTo(half - radius * 0.2, -half, half, -half + radius * 0.2, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.bezierCurveTo(half, half - radius * 0.2, half - radius * 0.2, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.bezierCurveTo(-half + radius * 0.2, half, -half, half - radius * 0.2, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.bezierCurveTo(-half, -half + radius * 0.2, -half + radius * 0.2, -half, -half + radius, -half);
  return shape;
}

/**
 * Glazed porcelain: a soft, pillowy tile in a pale tint of the achievement's
 * colour, the mark raised from it in the same glaze. From ten times the mark
 * is laid in gold leaf. Until earned it is unglazed white bisque.
 */
export function buildClay({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const color = earned ? new THREE.Color(BADGE_COLORS[id]).lerp(new THREE.Color(0xffffff), 0.3) : new THREE.Color(0xe4e4e2);
  const glaze = new THREE.MeshPhysicalMaterial(earned
    ? { color, roughness: 0.42, clearcoat: 0.85, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5 }
    : { color, roughness: 0.92 });
  const group = new THREE.Group();
  const tile = new THREE.Mesh(
    new THREE.ExtrudeGeometry(squircle(1.36, 0.46), { depth: 0.14, bevelEnabled: true, bevelThickness: 0.24, bevelSize: 0.2, bevelSegments: 18, curveSegments: 48 }),
    glaze,
  );
  tile.position.z = -0.3;
  group.add(tile);
  const gold = earned && tier >= 3;
  const mark = new THREE.Mesh(
    glyphTubes(state === "concealed" ? "hidden" : id, 0.98, 0.075, 0),
    gold ? new THREE.MeshPhysicalMaterial({ color: METALS.gold.color, metalness: 1, roughness: 0.22 }) : glaze,
  );
  mark.scale.z = 0.7;
  mark.position.z = 0.1;
  group.add(mark);
  group.rotation.set(-0.08, 0.26, 0);
  return { object: group, frame: 1.2, lift: 0.1, shadow: { y: -1.06, width: 2.1, depth: 0.55, strength: 0.24 } };
}
