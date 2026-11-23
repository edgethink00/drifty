import * as THREE from "three";
import type { AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { BADGE_COLORS, seeded } from "./palette";
import type { BadgeStage } from "./studio";

type Form = { readonly kind: "drop" | "orb" | "egg" | "pebble" | "twin" | "stack"; readonly point?: number; readonly flip?: boolean; readonly wobble?: number };

const FORMS: Record<AchievementId, Form> = {
  firstFlow: { kind: "drop", point: 1.2 },
  flow90: { kind: "drop", point: 2 },
  flow180: { kind: "drop", point: 3 },
  focusDay8h: { kind: "orb" },
  earlyStart: { kind: "egg" },
  nightOwl: { kind: "orb", wobble: 0.02 },
  weekendShift: { kind: "twin" },
  streak7: { kind: "pebble" },
  streak30: { kind: "pebble", wobble: 0.025 },
  focus100h: { kind: "stack" },
  driftDay: { kind: "orb", wobble: 0.07 },
  noDriftDay: { kind: "orb" },
  comeback: { kind: "drop", point: 1.6, flip: true },
};

function lathe(profile: (t: number) => readonly [number, number], segments = 128): THREE.BufferGeometry {
  const points = Array.from({ length: 97 }, (_, index) => {
    const [r, y] = profile((index / 96) * Math.PI);
    return new THREE.Vector2(Math.max(0, r), y);
  }).reverse();
  return new THREE.LatheGeometry(points, segments);
}

function wobble(geometry: THREE.BufferGeometry, seed: string, amount: number): THREE.BufferGeometry {
  if (amount <= 0) return geometry;
  const random = seeded(seed);
  const waves = Array.from({ length: 3 }, () => ({ axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), frequency: 1 + random(), phase: random() * 6.28 }));
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    let scale = 1;
    for (const wave of waves) scale += Math.sin(point.dot(wave.axis) * wave.frequency * Math.PI + wave.phase) * amount;
    point.multiplyScalar(scale);
    position.setXYZ(index, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function shapes(form: Form, seed: string): { geometry: THREE.BufferGeometry; position: readonly [number, number, number]; scale: number }[] {
  switch (form.kind) {
    case "drop": {
      const m = form.point ?? 1.5;
      const geometry = lathe((t) => [Math.sin(t) * Math.pow(Math.sin(t / 2), m) * 1.05, Math.cos(t)]);
      if (form.flip) geometry.rotateX(Math.PI);
      return [{ geometry: wobble(geometry, seed, form.wobble ?? 0), position: [0, 0, 0], scale: 0.92 }];
    }
    case "egg":
      return [{ geometry: lathe((t) => [Math.sin(t) * (0.74 + 0.1 * Math.cos(t)), Math.cos(t)]), position: [0, 0, 0], scale: 0.9 }];
    case "pebble": {
      const geometry = wobble(new THREE.SphereGeometry(1, 128, 96), seed, form.wobble ?? 0.012);
      geometry.scale(1, 0.6, 0.86);
      return [{ geometry, position: [0, -0.18, 0], scale: 0.92 }];
    }
    case "twin":
      return [
        { geometry: new THREE.SphereGeometry(0.56, 96, 72), position: [-0.38, -0.2, 0], scale: 1 },
        { geometry: new THREE.SphereGeometry(0.46, 96, 72), position: [0.44, -0.3, 0.12], scale: 1 },
      ];
    case "stack":
      return [
        { geometry: new THREE.SphereGeometry(0.5, 96, 72), position: [0, -0.48, 0], scale: 1 },
        { geometry: new THREE.SphereGeometry(0.42, 96, 72), position: [0, 0.32, 0], scale: 1 },
      ];
    default:
      return [{ geometry: wobble(new THREE.SphereGeometry(0.8, 128, 96), seed, form.wobble ?? 0), position: [0, -0.06, 0], scale: 1 }];
  }
}

/**
 * A milky, opal-like play of colour for the drop's inner body: soft clouds
 * in the achievement's hue and its two neighbours, with pale veils between.
 */
export function opalTexture(base: THREE.Color, seed: string): THREE.CanvasTexture {
  const random = seeded(seed + "-opal");
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const tone = (shift: number, light: number, sat = 0.75) => new THREE.Color().setHSL((hsl.h + shift + 1) % 1, Math.min(1, hsl.s * sat + 0.12), light).getStyle();
  if (ctx) {
    ctx.fillStyle = tone(0, 0.62, 0.65);
    ctx.fillRect(0, 0, size, size);
    const blobs: [number, number][] = [[0, 0.55], [0.09, 0.66], [-0.08, 0.5], [0.16, 0.74], [0, 0.82], [-0.14, 0.6]];
    for (let index = 0; index < 22; index += 1) {
      const [shift, light] = blobs[index % blobs.length]!;
      const x = random() * size;
      const y = random() * size;
      const r = size * (0.12 + random() * 0.3);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, tone(shift, light, index % 3 === 0 ? 0.95 : 0.7));
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 0.55 + random() * 0.35;
      ctx.fillStyle = gradient;
      for (const dx of [-size, 0, size]) {
        ctx.save();
        ctx.translate(dx, 0);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineCap = "round";
    for (let index = 0; index < 5; index += 1) {
      ctx.lineWidth = 6 + random() * 14;
      ctx.beginPath();
      const y = random() * size;
      ctx.moveTo(-20, y);
      for (let x = 0; x <= size + 20; x += 32) ctx.lineTo(x, y + Math.sin(x / 70 + index) * 40 + (random() - 0.5) * 16);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/**
 * A drop of elixir, liquid glass tinted in the achievement's colour that
 * splits light into a thin rainbow at its edges, lit from within. Each
 * achievement has its own form: drops for unbroken focus, a still sphere
 * for the day without drift, two drops for the weekend. Milestones gather
 * small drops beside it. Until earned it is clouded and colourless.
 */
export function buildDrop({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const form: Form = state === "concealed" ? { kind: "orb" } : FORMS[id];
  const color = new THREE.Color(earned ? BADGE_COLORS[id] : 0xc7cacf);
  const glass = new THREE.MeshPhysicalMaterial({
    color: earned ? color.clone().lerp(new THREE.Color(0xffffff), 0.8) : 0xffffff,
    transmission: 1,
    thickness: 0.9,
    roughness: earned ? 0.02 : 0.38,
    ior: 1.42,
    dispersion: earned ? 3 : 0,
    iridescence: earned ? 0.7 : 0,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [200, 560],
    attenuationColor: color,
    attenuationDistance: earned ? 1.4 : 2,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    specularIntensity: 1,
    envMapIntensity: 1.35,
  });
  const opal = earned ? opalTexture(color, id) : null;
  const bodyMaterial = opal ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: opal, emissive: 0xffffff, emissiveMap: opal, emissiveIntensity: 0.55, roughness: 0.5, sheen: 1, sheenColor: new THREE.Color(0xffffff) }) : null;
  const group = new THREE.Group();
  const parts = shapes(form, id);
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry, glass);
    mesh.position.set(...part.position);
    mesh.scale.setScalar(part.scale);
    group.add(mesh);
    if (bodyMaterial) {
      // A milky, glowing body inside the glass, so the drop carries its own light on a dark surface.
      // Opaque, so the glass's transmission pass sees it and bends it.
      const body = new THREE.Mesh(part.geometry, bodyMaterial);
      body.position.set(part.position[0], part.position[1] - 0.05, part.position[2] - 0.08);
      body.scale.setScalar(part.scale * 0.78);
      body.rotation.y = 0.8;
      group.add(body);
    }
  }
  if (bodyMaterial) {
    const random = seeded(id + "-beads");
    for (let index = 0; index < Math.min(Math.max(tier - 1, 0), 5); index += 1) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.1 + random() * 0.05, 48, 32), bodyMaterial);
      const angle = 0.6 + index * 0.42;
      bead.position.set(Math.cos(angle) * 0.98, -0.78 + random() * 0.08, Math.sin(angle) * 0.35);
      group.add(bead);
    }
  }
  return { object: group, frame: 1.12, lift: 0.14, shadow: { y: -0.96, width: 1.9, depth: 0.5, strength: 0.3 } };
}
