import * as THREE from "three";
import type { AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { fitted, tone } from "./forms";
import { BADGE_COLORS, METALS, seeded } from "./palette";
import type { BadgeStage } from "./studio";

type Marble = { readonly style: "eye" | "swirl"; readonly vanes: number; readonly twist: number; readonly core?: boolean };

const MARBLES: Record<AchievementId, Marble> = {
  firstFlow: { style: "eye", vanes: 2, twist: 0.7 },
  flow90: { style: "eye", vanes: 3, twist: 1.4 },
  flow180: { style: "eye", vanes: 4, twist: 2.2 },
  focusDay8h: { style: "swirl", vanes: 8, twist: 2.4, core: true },
  earlyStart: { style: "swirl", vanes: 3, twist: 1.6, core: true },
  nightOwl: { style: "swirl", vanes: 4, twist: -2.6 },
  weekendShift: { style: "eye", vanes: 2, twist: 3.1 },
  streak7: { style: "swirl", vanes: 7, twist: 1.8 },
  streak30: { style: "swirl", vanes: 12, twist: 2.6 },
  focus100h: { style: "swirl", vanes: 5, twist: 3, core: true },
  driftDay: { style: "swirl", vanes: 3, twist: 5.2 },
  noDriftDay: { style: "eye", vanes: 1, twist: 0 },
  comeback: { style: "swirl", vanes: 3, twist: -3.4 },
};

/** A twisted vane from the marble's axis (or a band near its skin), as a strip of triangles. */
function vane(angle: number, twist: number, inner: number, outer: number, radius: number): THREE.BufferGeometry {
  const rows = 72;
  const cols = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rows; i += 1) {
    const y = -radius * 0.92 + (i / rows) * radius * 1.84;
    const span = Math.sqrt(Math.max(0, 1 - (y / radius) ** 2)) * radius * 0.96;
    const theta = angle + twist * (y / radius);
    for (let j = 0; j <= cols; j += 1) {
      const s = span * (inner + (outer - inner) * (j / cols));
      positions.push(Math.cos(theta) * s, y, Math.sin(theta) * s);
    }
  }
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const a = i * (cols + 1) + j;
      const b = a + cols + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A glass marble with coloured vanes twisted inside it: a cat's eye for
 * unbroken focus, swirls for rhythms and streaks, a glowing core for the
 * long days. Milestones fleck it with gold. Until earned, frosted and empty.
 */
export function buildMarble({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const plan = MARBLES[id];
  const base = new THREE.Color(BADGE_COLORS[id]);
  const radius = 0.86;
  const group = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 128, 96),
    new THREE.MeshPhysicalMaterial({ color: earned ? 0xffffff : 0xf1f2f4, transmission: 1, thickness: 0.25, roughness: earned ? 0 : 0.42, ior: 1.25, dispersion: earned ? 0.4 : 0, clearcoat: 1, clearcoatRoughness: 0, specularIntensity: 1, envMapIntensity: 1.5 }),
  );
  group.add(glass);
  if (earned) {
    const colors = [tone(base, 0, 0.5), new THREE.Color(0xf7f4ee), tone(base, 0.08, 0.66), tone(base, -0.07, 0.42)];
    for (let index = 0; index < plan.vanes; index += 1) {
      const angle = (index / plan.vanes) * Math.PI * 2;
      const [inner, outer] = plan.style === "eye" ? [0, 0.84] : [0.18, 0.8];
      const color = colors[index % colors.length]!;
      group.add(new THREE.Mesh(vane(angle, plan.twist, inner, outer, radius * 0.9), new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.35, side: THREE.DoubleSide })));
    }
    // A pale tint through the glass, so the marble reads as coloured glass even between the vanes.
    group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 0.93, 96, 64), new THREE.MeshPhysicalMaterial({ color: tone(base, 0.02, 0.86, 0.6), roughness: 0.5, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.BackSide })));
    if (plan.core) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 64, 48), new THREE.MeshPhysicalMaterial({ color: tone(base, 0.03, 0.72), emissive: tone(base, 0.03, 0.6), emissiveIntensity: 0.8, roughness: 0.4 }));
      group.add(core);
    }
    const random = seeded(id + "-flecks");
    const flecks = Math.min(tier, 6) * 10;
    const gold = new THREE.MeshPhysicalMaterial({ color: METALS.gold.color, metalness: 1, roughness: 0.15, emissive: 0x6a4a10, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    for (let index = 0; index < flecks; index += 1) {
      const fleck = new THREE.Mesh(new THREE.CircleGeometry(0.018 + random() * 0.018, 6), gold);
      const direction = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      fleck.position.copy(direction.multiplyScalar(0.25 + random() * 0.5));
      fleck.rotation.set(random() * 6, random() * 6, random() * 6);
      group.add(fleck);
    }
  }
  group.rotation.set(0.25, 0.4, 0.15);
  const fit = fitted(group, 1.95);
  return { object: fit.object, frame: 1.15, lift: 0.12, shadow: { y: fit.bottom - 0.01, width: 1.6, depth: 0.42, strength: 0.32 } };
}
