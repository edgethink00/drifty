import * as THREE from "three";
import type { AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { glyphTubes } from "./glyph3d";
import { outline } from "./medal";
import { numeralShapes } from "./numerals";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

/** The figure each award carries, as the Apple Watch awards carry theirs. */
const FIGURES: Record<AchievementId, string> = {
  firstFlow: "25",
  flow90: "90",
  flow180: "3",
  focusDay8h: "8",
  earlyStart: "5",
  nightOwl: "2",
  weekendShift: "2",
  streak7: "7",
  streak30: "30",
  focus100h: "100",
  driftDay: "50",
  noDriftDay: "0",
  comeback: "4",
};

/**
 * A figure award: a glossy plate in the achievement's colour, edged in
 * polished metal, with its number standing up from it in metal, set in the
 * app's own typeface. Silver, then gold from ten times.
 */
export function buildAward({ id, group, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const color = new THREE.Color(earned ? BADGE_COLORS[id] : 0xb9bcc2);
  const metal = !earned ? METALS.pewter : tier >= 3 ? METALS.gold : METALS.silver;
  const metalMaterial = new THREE.MeshPhysicalMaterial({ color: metal.color, metalness: 1, roughness: metal.roughness * 0.6, clearcoat: earned ? 0.5 : 0 });
  const face = new THREE.MeshPhysicalMaterial(earned
    ? { color, emissive: color, emissiveIntensity: 0.12, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.3, iridescenceIOR: 1.25 }
    : { color, roughness: 0.65 });
  const group3d = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline(group, 1), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.07, bevelSegments: 10, curveSegments: 72 }),
    [face, metalMaterial],
  );
  plate.position.z = -0.16;
  group3d.add(plate);

  const figure = state === "concealed" ? "?" : FIGURES[id];
  const wide = figure.length >= 3 ? 1.3 : figure.length === 2 ? 1.12 : 0.7;
  const numeral = new THREE.Mesh(
    new THREE.ExtrudeGeometry(numeralShapes(figure, figure.length >= 3 ? 0.62 : 0.78, wide), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.03, bevelSegments: 6, curveSegments: 16 }),
    metalMaterial,
  );
  numeral.position.set(0, -0.1, 0.07);
  group3d.add(numeral);
  if (state !== "concealed") {
    const mark = new THREE.Mesh(glyphTubes(id, 0.3, 0.026, 0), metalMaterial);
    mark.position.set(0, 0.52, 0.1);
    group3d.add(mark);
  }
  group3d.rotation.set(-0.1, 0.34, 0);
  return { object: group3d, frame: 1.3, lift: 0.08, shadow: { y: -1.22, width: 2.2, depth: 0.5, strength: 0.28 } };
}
