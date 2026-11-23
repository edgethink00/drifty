import * as THREE from "three";
import type { AchievementArtProps } from "../achievementArt";
import { fitted, gradient, star4, tone } from "./forms";
import { glyphTubes } from "./glyph3d";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

/**
 * The achievement's mark itself as an object: thick, soft, glossy strokes
 * shading through the achievement's colour, floating with nothing around
 * it, the way a 3D app symbol is shown. Milestones bring gold sparkles.
 * Until earned, the mark is frosted, colourless glass.
 */
export function buildSymbol({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const base = new THREE.Color(BADGE_COLORS[id]);
  const geometry = glyphTubes(state === "concealed" ? "hidden" : id, 1.7, 0.16, 0);
  if (earned) gradient(geometry, tone(base, -0.04, 0.4), tone(base, 0.08, 0.78, 0.85), 0.45);
  const material = earned
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.35, iridescence: 0.25, envMapIntensity: 1.25 })
    : new THREE.MeshPhysicalMaterial({ color: 0xf0f1f3, transmission: 1, thickness: 0.4, roughness: 0.45, ior: 1.45, envMapIntensity: 1 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  if (earned) {
    const sparkle = new THREE.ExtrudeGeometry(star4(0.13), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.015, bevelSegments: 4 });
    const gold = new THREE.MeshPhysicalMaterial({ color: METALS.gold.color, metalness: 1, roughness: 0.12, emissive: 0x7a5a1a, emissiveIntensity: 0.25 });
    const spots: readonly (readonly [number, number, number])[] = [[0.98, 0.86, 1.1], [-0.98, -0.72, 0.8], [1.02, -0.8, 0.7], [-0.92, 0.9, 0.65]];
    spots.slice(0, Math.min(tier, 4)).forEach(([x, y, scale]) => {
      const star = new THREE.Mesh(sparkle, gold);
      star.position.set(x, y, 0.1);
      star.scale.setScalar(scale);
      group.add(star);
    });
  }
  group.rotation.set(-0.1, 0.38, 0);
  const fit = fitted(group, 2.15);
  return { object: fit.object, frame: 1.2, lift: 0.08, shadow: { y: fit.bottom - 0.04, width: 1.7, depth: 0.45, strength: 0.22 } };
}
