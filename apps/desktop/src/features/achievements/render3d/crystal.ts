import * as THREE from "three";
import type { AchievementArtProps } from "../achievementArt";
import { glyphTubes } from "./glyph3d";
import { guilloche } from "./medal";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

/**
 * A watch-crystal medal: a coloured, engine-turned dial with the mark on it,
 * under a domed glass crystal that magnifies it, held in a polished bezel.
 * Silver bezel, gold from ten times.
 */
export function buildCrystal({ id, group, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const color = new THREE.Color(earned ? BADGE_COLORS[id] : 0xb4b8be);
  const metal = !earned ? METALS.pewter : tier >= 3 ? METALS.gold : METALS.silver;
  const metalMaterial = new THREE.MeshPhysicalMaterial({ color: metal.color, metalness: 1, roughness: metal.roughness * 0.55 });
  const group3d = new THREE.Group();

  const dial = new THREE.Mesh(
    new THREE.CylinderGeometry(0.86, 0.86, 0.06, 96),
    new THREE.MeshPhysicalMaterial(earned
      ? { color, emissive: color, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.2, clearcoat: 1, bumpMap: guilloche(group), bumpScale: 1.6 }
      : { color, roughness: 0.7 }),
  );
  dial.rotation.x = Math.PI / 2;
  dial.position.z = -0.1;
  group3d.add(dial);

  const mark = new THREE.Mesh(
    glyphTubes(state === "concealed" ? "hidden" : id, 0.9, 0.05, 0),
    new THREE.MeshPhysicalMaterial(earned ? { color: 0xffffff, metalness: 1, roughness: 0.12 } : { color: 0x8c9096, roughness: 0.5 }),
  );
  mark.scale.z = 0.5;
  mark.position.z = -0.05;
  group3d.add(mark);

  const domeProfile = Array.from({ length: 33 }, (_, index) => {
    const angle = (index / 32) * (Math.PI / 2);
    return new THREE.Vector2(Math.sin(angle) * 0.88, Math.cos(angle) * 0.5 - 0.06);
  });
  domeProfile.push(new THREE.Vector2(0.88, -0.07), new THREE.Vector2(0.001, -0.07));
  const dome = new THREE.Mesh(
    new THREE.LatheGeometry(domeProfile, 128),
    new THREE.MeshPhysicalMaterial({ color: earned ? color.clone().lerp(new THREE.Color(0xffffff), 0.9) : 0xffffff, transmission: 1, thickness: 1.1, roughness: earned ? 0 : 0.35, ior: 1.75, dispersion: earned ? 1.6 : 0, iridescence: earned ? 0.25 : 0, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2 }),
  );
  dome.rotation.x = Math.PI / 2;
  group3d.add(dome);

  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.085, 32, 160), metalMaterial);
  bezel.scale.z = 1.6;
  bezel.position.z = -0.04;
  group3d.add(bezel);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.94, 0.16, 128), metalMaterial);
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.2;
  group3d.add(back);

  group3d.rotation.set(-0.12, 0.38, 0);
  return { object: group3d, frame: 1.24, lift: 0.08, shadow: { y: -1.14, width: 2.2, depth: 0.5, strength: 0.28 } };
}
