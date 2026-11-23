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
 * An app icon in glass: a rounded tile glazed in the achievement's colour,
 * with the mark laid on it in thick clear glass that bends the colour
 * beneath it. Gold edging from ten times. Until earned the tile is
 * unglazed grey.
 */
export function buildEmblem({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const color = new THREE.Color(earned ? BADGE_COLORS[id] : 0xc9ccd1);
  const group = new THREE.Group();
  const tile = new THREE.Mesh(
    new THREE.ExtrudeGeometry(squircle(1.62, 0.5), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 14, curveSegments: 48 }),
    new THREE.MeshPhysicalMaterial(earned
      ? { color, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0.5, sheenColor: color.clone().lerp(new THREE.Color(0xffffff), 0.6), sheenRoughness: 0.4 }
      : { color, roughness: 0.7 }),
  );
  tile.position.z = -0.22;
  group.add(tile);

  const mark = new THREE.Mesh(
    glyphTubes(state === "concealed" ? "hidden" : id, 1.06, 0.085, 0.06),
    new THREE.MeshPhysicalMaterial(earned
      ? { color: 0xffffff, emissive: color.clone().lerp(new THREE.Color(0xffffff), 0.85), emissiveIntensity: 0.25, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 }
      : { color: 0x8c9096, roughness: 0.5 }),
  );
  group.add(mark);

  if (earned && tier >= 3) {
    const outer = squircle(1.9, 0.62);
    outer.holes.push(squircle(1.8, 0.58) as unknown as THREE.Path);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 5, curveSegments: 48 }), new THREE.MeshPhysicalMaterial({ color: METALS.gold.color, metalness: 1, roughness: METALS.gold.roughness }));
    frame.position.z = -0.25;
    group.add(frame);
  }

  group.rotation.set(-0.16, 0.38, 0.02);
  return { object: group, frame: 1.24, lift: 0.1, shadow: { y: -1.12, width: 2.2, depth: 0.55, strength: 0.26 } };
}
