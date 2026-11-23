import * as THREE from "three";
import type { AchievementArtProps } from "../achievementArt";
import { glyphTubes } from "./glyph3d";
import { outline } from "./medal";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

/**
 * A puck of anodized aluminium, the way a Mac is finished: brushed colour
 * on the faces, a diamond-cut chamfer that catches the light, and the mark
 * laser-etched into the face. The chamfer turns gold from ten times.
 */
export function buildAnodized({ id, group, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const color = new THREE.Color(earned ? BADGE_COLORS[id] : 0xb4b8be).lerp(new THREE.Color(0xffffff), earned ? 0.12 : 0);
  const anodized = new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: earned ? 0.34 : 0.55, anisotropy: 0.6, anisotropyRotation: Math.PI / 2, clearcoat: earned ? 0.25 : 0, clearcoatRoughness: 0.2 });
  const chamferMetal = earned && tier >= 3 ? METALS.gold : METALS.silver;
  const chamfer = new THREE.MeshPhysicalMaterial({ color: earned ? chamferMetal.color : 0xc9ccd1, metalness: 1, roughness: 0.06 });
  const group3d = new THREE.Group();
  const puck = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline(group, 1.02), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1, curveSegments: 96 }),
    [anodized, chamfer],
  );
  puck.position.z = -0.32;
  group3d.add(puck);
  const etch = new THREE.Mesh(
    glyphTubes(state === "concealed" ? "hidden" : id, 1.0, 0.05, 0),
    new THREE.MeshPhysicalMaterial({ color: earned ? color.clone().lerp(new THREE.Color(0xffffff), 0.75) : 0xe3e5e8, metalness: 1, roughness: 0.42 }),
  );
  etch.scale.z = 0.22;
  etch.position.z = 0.04;
  group3d.add(etch);
  group3d.rotation.set(-0.14, 0.4, 0);
  return { object: group3d, frame: 1.3, lift: 0.1, shadow: { y: -1.2, width: 2.2, depth: 0.5, strength: 0.28 } };
}
