import * as THREE from "three";
import type { AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { glyphTexture } from "./glyph3d";
import { opalTexture } from "./drop";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

type Bottle = {
  /** Outer glass profile, radius and height, from the base up to the lip. */
  readonly profile: readonly (readonly [number, number])[];
  readonly fill: number;
  /** Faceted glass instead of round. */
  readonly facets?: number;
  readonly label: number;
};

const BOTTLES: Record<AchievementId, Bottle> = {
  firstFlow: { profile: [[0.5, -0.95], [0.72, -0.7], [0.74, -0.35], [0.52, 0.05], [0.2, 0.3], [0.17, 0.62], [0.2, 0.7]], fill: -0.12, label: -0.38 },
  flow90: { profile: [[0.3, -0.98], [0.36, -0.9], [0.37, 0.5], [0.33, 0.62], [0.2, 0.72], [0.2, 0.86], [0.23, 0.92]], fill: 0.25, label: -0.25 },
  flow180: { profile: [[0.42, -0.98], [0.55, -0.8], [0.56, -0.2], [0.44, 0.08], [0.15, 0.3], [0.12, 0.8], [0.16, 0.9]], fill: -0.05, label: -0.5 },
  focusDay8h: { profile: [[0.7, -0.92], [0.82, -0.82], [0.84, 0.12], [0.76, 0.24], [0.46, 0.3], [0.46, 0.42], [0.5, 0.46]], fill: 0.05, label: -0.36 },
  earlyStart: { profile: [[0.26, -0.98], [0.58, -0.7], [0.66, -0.35], [0.5, 0.1], [0.2, 0.45], [0.14, 0.7], [0.18, 0.78]], fill: -0.2, label: -0.45 },
  nightOwl: { profile: [[0.3, -0.92], [0.66, -0.72], [0.74, -0.38], [0.6, -0.02], [0.2, 0.2], [0.13, 0.7], [0.17, 0.78]], fill: -0.28, label: -0.4 },
  weekendShift: { profile: [[0.34, -0.96], [0.5, -0.8], [0.52, -0.5], [0.34, -0.22], [0.5, 0.04], [0.52, 0.34], [0.3, 0.52], [0.16, 0.62], [0.2, 0.7]], fill: 0.05, label: 0.16 },
  streak7: { profile: [[0.6, -0.97], [0.64, -0.9], [0.64, 0.2], [0.5, 0.38], [0.2, 0.48], [0.18, 0.66], [0.22, 0.72]], fill: 0.02, facets: 7, label: -0.38 },
  streak30: { profile: [[0.55, -0.97], [0.62, -0.85], [0.64, 0.12], [0.36, 0.42], [0.18, 0.5], [0.17, 0.7], [0.21, 0.76]], fill: 0.0, facets: 15, label: -0.38 },
  focus100h: { profile: [[0.66, -0.97], [0.66, -0.9], [0.2, -0.08], [0.12, 0.0], [0.2, 0.08], [0.6, 0.78], [0.6, 0.85]], fill: -0.36, label: 0.2 },
  driftDay: { profile: [[0.52, -0.97], [0.66, -0.75], [0.67, -0.2], [0.56, 0.1], [0.18, 0.36], [0.15, 0.7], [0.19, 0.78]], fill: -0.72, label: -0.38 },
  noDriftDay: { profile: [[0.48, -0.97], [0.52, -0.9], [0.52, 0.25], [0.34, 0.44], [0.14, 0.52], [0.12, 0.66], [0.16, 0.72]], fill: 0.22, facets: 10, label: -0.3 },
  comeback: { profile: [[0.7, -0.97], [0.74, -0.9], [0.5, -0.1], [0.2, 0.42], [0.15, 0.66], [0.19, 0.74]], fill: -0.3, label: -0.6 },
};

const CONCEALED: Bottle = { profile: [[0.32, -0.94], [0.66, -0.72], [0.72, -0.36], [0.56, 0.0], [0.18, 0.24], [0.14, 0.66], [0.18, 0.74]], fill: -1, label: -0.38 };

function smooth(points: readonly (readonly [number, number])[], samples: number): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getSpacedPoints(samples).map((point) => new THREE.Vector2(Math.max(0.001, point.x), point.y));
}

function radiusAt(profile: THREE.Vector2[], y: number): number {
  for (let index = 1; index < profile.length; index += 1) {
    const a = profile[index - 1]!;
    const b = profile[index]!;
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  return profile[0]?.x ?? 0.4;
}

/**
 * A blown-glass bottle holding a luminous elixir in the achievement's
 * colour, its mark printed on the glass. Corked at first; a silver cap
 * from ten times, gold from fifty. Until earned it is empty frosted glass.
 */
export function buildElixir({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const bottle = state === "concealed" ? CONCEALED : BOTTLES[id];
  const outer = smooth(bottle.profile, 72);
  const bottom = outer[0]!;
  const top = outer[outer.length - 1]!;
  const segments = bottle.facets ?? 96;
  const group = new THREE.Group();

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1,
    thickness: 0.25,
    roughness: earned ? 0.02 : 0.32,
    ior: 1.5,
    specularIntensity: 1,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
    flatShading: Boolean(bottle.facets),
  });
  const shell = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, bottom.y), ...outer], segments), glass);
  group.add(shell);

  if (earned) {
    const color = new THREE.Color(BADGE_COLORS[id]);
    const inner = outer.map((point) => new THREE.Vector2(Math.max(0.001, point.x - 0.045), point.y));
    const fillY = Math.min(bottle.fill, top.y - 0.2);
    const cut = inner.filter((point) => point.y < fillY);
    const surface = radiusAt(inner, fillY);
    const liquidProfile = [new THREE.Vector2(0.001, bottom.y + 0.05), ...cut.map((point) => new THREE.Vector2(point.x, Math.max(point.y, bottom.y + 0.05))), new THREE.Vector2(surface, fillY), new THREE.Vector2(0.001, fillY)];
    // A swirling, softly glowing potion: the same milky play of colour as the drops.
    const swirl = opalTexture(color, id + "-potion");
    const liquid = new THREE.Mesh(
      new THREE.LatheGeometry(liquidProfile, segments),
      new THREE.MeshPhysicalMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.15), map: swirl, emissive: color, emissiveMap: swirl, emissiveIntensity: 0.5 + Math.min(tier, 6) * 0.05, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), flatShading: Boolean(bottle.facets) }),
    );
    group.add(liquid);
    const rnd = (seed: number) => (Math.sin(seed * 91.7 + id.length * 13.1) + 1) / 2;
    for (let index = 0; index < 6; index += 1) {
      const y = bottom.y + 0.15 + rnd(index) * (fillY - bottom.y - 0.25);
      const angle = 0.4 + rnd(index + 10) * 1.2 - 0.6;
      const r = radiusAt(inner, y) * (0.55 + rnd(index + 20) * 0.4);
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.025 + rnd(index + 30) * 0.025, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: color.clone().lerp(new THREE.Color(0xffffff), 0.7), emissiveIntensity: 0.6, roughness: 0.1 }));
      bubble.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
      group.add(bubble);
    }
  }

  const labelHeight = 0.34;
  const labelRadius = radiusAt(outer, bottle.label) + 0.004;
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(labelRadius, labelRadius, labelHeight, 48, 1, true, -0.42, 0.84),
    new THREE.MeshPhysicalMaterial({ color: earned ? 0xffffff : 0x8e9298, map: glyphTexture(state === "concealed" ? "hidden" : id, 256, 2.2), transparent: true, alphaTest: 0.05, roughness: 0.3, metalness: 0, side: THREE.DoubleSide }),
  );
  const labelMaterial = label.material as THREE.MeshPhysicalMaterial;
  labelMaterial.alphaMap = labelMaterial.map;
  label.position.y = bottle.label;
  group.add(label);

  const neck = top.x;
  const stopperMetal = earned && tier >= 5 ? METALS.gold : earned && tier >= 3 ? METALS.silver : null;
  const stopper = new THREE.Mesh(
    new THREE.CylinderGeometry(neck * 1.12, neck * 0.9, 0.22, 48),
    stopperMetal
      ? new THREE.MeshPhysicalMaterial({ color: stopperMetal.color, metalness: 1, roughness: stopperMetal.roughness })
      : new THREE.MeshPhysicalMaterial({ color: earned ? 0xb88a58 : 0x9b9690, roughness: 0.85, sheen: 0.3 }),
  );
  stopper.position.y = top.y + 0.06;
  group.add(stopper);

  group.position.y = -((top.y + 0.17 + bottom.y) / 2);
  group.rotation.y = 0.0;
  return { object: group, frame: 1.1, lift: 0.24, shadow: { y: bottom.y + group.position.y - 0.005, width: 1.9, depth: 0.55, strength: 0.32 } };
}
