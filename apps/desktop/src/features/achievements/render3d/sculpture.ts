import * as THREE from "three";
import type { AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { crescent, fitted, gradient, tone } from "./forms";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

function curveTube(points: (t: number) => THREE.Vector3, radius: number, closed = false, samples = 200): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: samples }, (_, index) => points(index / (closed ? samples : samples - 1))), closed);
  return new THREE.TubeGeometry(curve, samples * 2, radius, 32, closed);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return parts.length === 1 ? parts[0]! : (() => {
    const positions: number[] = [];
    const normals: number[] = [];
    parts.forEach((part) => {
      const flat = part.index ? part.toNonIndexed() : part;
      positions.push(...(flat.attributes.position as THREE.BufferAttribute).array);
      normals.push(...(flat.attributes.normal as THREE.BufferAttribute).array);
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    return merged;
  })();
}

const FORMS: Record<AchievementId, () => THREE.BufferGeometry> = {
  firstFlow: () => new THREE.TorusGeometry(0.62, 0.27, 64, 160),
  flow90: () => new THREE.TorusKnotGeometry(0.55, 0.17, 320, 40, 2, 3),
  flow180: () => new THREE.TorusKnotGeometry(0.56, 0.12, 420, 36, 3, 5),
  focusDay8h: () => curveTube((t) => {
    const a = t * Math.PI * 2;
    const s = 1 + Math.sin(a) ** 2;
    return new THREE.Vector3((0.95 * Math.cos(a)) / s, (0.95 * Math.sin(a) * Math.cos(a)) / s, Math.sin(a) * 0.18);
  }, 0.17, true),
  earlyStart: () => merge([new THREE.TorusGeometry(0.62, 0.2, 48, 120, Math.PI), new THREE.SphereGeometry(0.3, 64, 48).translate(0, 0.1, 0)]),
  nightOwl: () => {
    const shape = crescent(0.78, 0.66, [0.36, 0.2]);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.12, bevelSegments: 14, curveSegments: 64 });
    geometry.center();
    return geometry;
  },
  weekendShift: () => merge([new THREE.TorusGeometry(0.42, 0.13, 48, 120).translate(-0.28, 0, 0), new THREE.TorusGeometry(0.42, 0.13, 48, 120).rotateY(Math.PI / 2).translate(0.28, 0, 0)]),
  streak7: () => merge(Array.from({ length: 7 }, (_, index) => {
    const t = index / 6;
    const r = 0.14 + t * 0.1;
    return new THREE.SphereGeometry(r, 48, 32).translate(-0.8 + t * 1.6, Math.sin(t * Math.PI) * 0.5 - 0.1, 0);
  })),
  streak30: () => curveTube((t) => new THREE.Vector3(Math.cos(t * Math.PI * 12) * 0.5, -0.85 + t * 1.7, Math.sin(t * Math.PI * 12) * 0.5), 0.07, false, 400),
  focus100h: () => new THREE.TorusKnotGeometry(0.56, 0.1, 520, 32, 5, 2),
  driftDay: () => curveTube((t) => new THREE.Vector3(-0.95 + t * 1.9, Math.sin(t * Math.PI * 3) * 0.32, Math.cos(t * Math.PI * 2.2) * 0.3), 0.15),
  noDriftDay: () => new THREE.SphereGeometry(0.76, 128, 96),
  comeback: () => curveTube((t) => {
    const a = t * Math.PI * 5;
    const r = 0.15 + t * 0.58;
    return new THREE.Vector3(Math.cos(a) * r, -0.85 + t * 1.6, Math.sin(a) * r);
  }, 0.1, false, 320),
};

/**
 * A small abstract sculpture for each achievement, in glossy pearlescent
 * glaze that shades from the achievement's colour into its neighbour: a
 * ring for the first focus, knots that grow more involved for longer ones,
 * an infinity loop for the eight-hour day, a rising spiral for the comeback.
 * It stands on a plinth whose rim turns gold from ten times. Until earned
 * it is unglazed plaster.
 */
export function buildSculpture({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const base = new THREE.Color(BADGE_COLORS[id]);
  const geometry = state === "concealed" ? new THREE.IcosahedronGeometry(0.7, 1) : FORMS[id]();
  if (earned) gradient(geometry, tone(base, -0.03, 0.42), tone(base, 0.09, 0.8, 0.8));
  const material = earned
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0.45, iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 520], sheen: 0.4, sheenColor: new THREE.Color(0xffffff), envMapIntensity: 1.2 })
    : new THREE.MeshPhysicalMaterial({ color: 0xebe9e4, roughness: 0.92, sheen: 0.3, sheenColor: new THREE.Color(0xffffff), flatShading: state === "concealed" });
  const form = new THREE.Mesh(geometry, material);
  form.rotation.set(0.35, 0.5, 0.1);
  const formFit = fitted(form, 1.5);
  const sculpture = new THREE.Group();
  formFit.object.position.y = 0.2;
  sculpture.add(formFit.object);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.16, 96), new THREE.MeshPhysicalMaterial({ color: 0xf2f1ee, roughness: 0.35, clearcoat: 0.4 }));
  plinth.position.y = 0.2 + formFit.bottom - 0.1;
  sculpture.add(plinth);
  const rimMetal = earned && tier >= 3 ? METALS.gold : METALS.silver;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.645, 0.018, 12, 160), new THREE.MeshPhysicalMaterial({ color: earned ? rimMetal.color : 0xd2d4d8, metalness: 1, roughness: 0.15 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = plinth.position.y + 0.08;
  sculpture.add(rim);
  const fit = fitted(sculpture, 2.1);
  return { object: fit.object, frame: 1.18, lift: 0.14, shadow: { y: fit.bottom - 0.005, width: 1.9, depth: 0.5, strength: 0.3 } };
}
