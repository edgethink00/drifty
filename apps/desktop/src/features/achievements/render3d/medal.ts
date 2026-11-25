import * as THREE from "three";
import type { AchievementGroup, AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { DEFAULT_MEDAL_STYLE, type MedalForm, type MedalMetal, type MedalPalette, type MedalStyle } from "../medalStyle";
import { markGeometry } from "./marks";
import { BADGE_COLORS, GOLD } from "./palette";
import type { BadgeStage } from "./studio";

function roundedPolygon(sides: number, radius: number, corner: number, rotation = 0): THREE.Shape {
  const shape = new THREE.Shape();
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * Math.PI * 2;
    return new THREE.Vector2(Math.sin(angle) * radius, Math.cos(angle) * radius);
  });
  points.forEach((point, index) => {
    const previous = points[(index + sides - 1) % sides]!;
    const next = points[(index + 1) % sides]!;
    const into = point.clone().sub(previous).normalize().multiplyScalar(corner);
    const out = next.clone().sub(point).normalize().multiplyScalar(corner);
    const start = point.clone().sub(into);
    const end = point.clone().add(out);
    if (index === 0) shape.moveTo(start.x, start.y);
    else shape.lineTo(start.x, start.y);
    shape.quadraticCurveTo(point.x, point.y, end.x, end.y);
  });
  shape.closePath();
  return shape;
}

function circle(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

export function outline(group: AchievementGroup, scale: number): THREE.Shape {
  switch (group) {
    case "focus": return circle(0.98 * scale);
    case "rhythm": return roundedPolygon(6, 1.06 * scale, 0.22 * scale);
    case "consistency": return roundedPolygon(4, 1.22 * scale, 0.34 * scale, Math.PI / 4);
    default: return roundedPolygon(8, 1.03 * scale, 0.16 * scale, Math.PI / 8);
  }
}

/** Engine-turned guilloché under the enamel, a different pattern for each group. */
export function guilloche(group: AchievementGroup): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    const c = size / 2;
    if (group === "focus") {
      for (let r = 6; r < size * 0.75; r += 7) { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); }
    } else if (group === "rhythm") {
      for (let index = 0; index < 120; index += 1) {
        const angle = (index / 120) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(angle) * size, c + Math.sin(angle) * size); ctx.stroke();
      }
    } else if (group === "consistency") {
      for (let x = -size; x < size * 2; x += 10) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + size, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, size); ctx.lineTo(x + size, 0); ctx.stroke();
      }
    } else {
      for (let y = -20; y < size + 20; y += 9) {
        ctx.beginPath();
        for (let x = 0; x <= size; x += 4) ctx.lineTo(x, y + Math.sin(x / 18) * 6);
        ctx.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.55, 0.55);
  texture.offset.set(0.5, 0.5);
  return texture;
}

/** One colour for each group, for the "group" palette. */
const GROUP_COLORS: Readonly<Record<AchievementGroup, number>> = {
  focus: 0x2f9a8a,
  rhythm: 0xe0a03a,
  consistency: 0x8a63c9,
  unexpected: 0xd8644f,
};

/** The enamel colour of a medal in the chosen palette, derived from its own colour except for "group". */
export function enamelColor(id: AchievementId, group: AchievementGroup, palette: MedalPalette): THREE.Color {
  if (palette === "group") return new THREE.Color(GROUP_COLORS[group]);
  const color = new THREE.Color(BADGE_COLORS[id]);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  switch (palette) {
    case "muted": return color.setHSL(hsl.h, hsl.s * 0.5, Math.min(0.62, hsl.l * 0.88 + 0.05));
    case "pastel": return color.setHSL(hsl.h, Math.min(0.55, hsl.s * 0.7), 0.76);
    case "jewel": return color.setHSL(hsl.h, Math.min(1, hsl.s * 1.25 + 0.1), hsl.l * 0.62);
    default: return color;
  }
}

/** The rim's metal: silver at first and gold from ten times, in the chosen finish. */
function metalMaterial(metal: MedalMetal, gold: boolean): THREE.MeshPhysicalMaterial {
  const spec: Readonly<Record<MedalMetal, { silver: number; gold: number; roughness: number; clearcoat: number }>> = {
    polished: { silver: 0xbcc2ca, gold: GOLD, roughness: 0.22, clearcoat: 0.4 },
    satin: { silver: 0xb4b9c0, gold: 0xdcbb6c, roughness: 0.55, clearcoat: 0 },
    rose: { silver: 0xc4c8ce, gold: 0xe4a58e, roughness: 0.2, clearcoat: 0.4 },
    gunmetal: { silver: 0x4b5058, gold: GOLD, roughness: 0.3, clearcoat: 0.3 },
    platinum: { silver: 0xe4e6e8, gold: 0xead7a6, roughness: 0.18, clearcoat: 0.5 },
  };
  const chosen = spec[metal];
  const roughness = metal === "polished" ? (gold ? 0.16 : 0.28) : chosen.roughness;
  return new THREE.MeshPhysicalMaterial({ color: gold ? chosen.gold : chosen.silver, metalness: 1, roughness, clearcoat: chosen.clearcoat, clearcoatRoughness: 0.12 });
}

/** The proportions of each form: the backing plate, the rim, the enamel field and where the mark sits on it. */
type FormSpec = {
  readonly backDepth: number;
  readonly backBevel: number;
  readonly backSegments: number;
  /** The rim's inner edge, as a share of the outline; null for a form without a raised rim. */
  readonly rimInner: number | null;
  readonly rimDepth: number;
  readonly field: number;
  readonly fieldZ: number;
  readonly fieldDepth: number;
  readonly fieldBevel: number;
  readonly fieldBevelSize: number;
  readonly fieldSegments: number;
};

const FORMS: Readonly<Record<MedalForm, FormSpec>> = {
  struck: { backDepth: 0.1, backBevel: 0.05, backSegments: 8, rimInner: 0.8, rimDepth: 0.12, field: 0.8, fieldZ: 0.02, fieldDepth: 0.04, fieldBevel: 0.015, fieldBevelSize: 0.015, fieldSegments: 4 },
  coin: { backDepth: 0.24, backBevel: 0.07, backSegments: 10, rimInner: 0.88, rimDepth: 0.1, field: 0.88, fieldZ: 0.06, fieldDepth: 0.03, fieldBevel: 0.01, fieldBevelSize: 0.01, fieldSegments: 3 },
  dome: { backDepth: 0.1, backBevel: 0.05, backSegments: 8, rimInner: 0.84, rimDepth: 0.08, field: 0.78, fieldZ: 0.02, fieldDepth: 0.02, fieldBevel: 0.16, fieldBevelSize: 0.1, fieldSegments: 14 },
  pin: { backDepth: 0.04, backBevel: 0.025, backSegments: 6, rimInner: 0.93, rimDepth: 0.05, field: 0.93, fieldZ: 0.0, fieldDepth: 0.03, fieldBevel: 0.006, fieldBevelSize: 0.006, fieldSegments: 2 },
  plate: { backDepth: 0.12, backBevel: 0.1, backSegments: 1, rimInner: null, rimDepth: 0, field: 0.8, fieldZ: 0.075, fieldDepth: 0.02, fieldBevel: 0.008, fieldBevelSize: 0.008, fieldSegments: 2 },
};

/**
 * Drifty's achievement badge: a struck metal award with a raised rim, an
 * engine-turned enamel field in the achievement's colour and the mark
 * standing up from it in thick white glaze, so it reads at any size. The rim
 * is silver at first, gold from ten times, with an inner gold ring from
 * fifty. Until earned it is an unstruck blank in matte grey. The dev review
 * can vary its form, palette, metal and mark (medalStyle.ts); the default is
 * the medal as shipped.
 */
export function buildMedal({ id, group, state, tier }: AchievementArtProps, style: MedalStyle = DEFAULT_MEDAL_STYLE): BadgeStage {
  const earned = state === "earned";
  const gold = earned && tier >= 3;
  const form = FORMS[style.form];
  const metal = earned ? metalMaterial(style.metal, gold) : new THREE.MeshPhysicalMaterial({ color: 0xb6bac0, metalness: 0.45, roughness: 0.62 });
  const color = enamelColor(id, group, style.palette);
  const enamel = new THREE.MeshPhysicalMaterial(earned
    ? {
      color, emissive: color, emissiveIntensity: 0.16, roughness: style.form === "dome" ? 0.08 : 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03,
      bumpMap: style.form === "dome" ? null : guilloche(group), bumpScale: 0.9, iridescence: style.form === "dome" ? 0.35 : 0.2, iridescenceIOR: 1.3,
    }
    : { color: 0xd0d3d7, roughness: 0.82 });
  const group3d = new THREE.Group();

  const back = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(group, 1), { depth: form.backDepth, bevelEnabled: true, bevelThickness: form.backBevel, bevelSize: form.backBevel, bevelSegments: form.backSegments, curveSegments: 64 }), metal);
  back.position.z = -form.backDepth;
  group3d.add(back);

  if (form.rimInner !== null) {
    const ring = outline(group, 1);
    ring.holes.push(outline(group, form.rimInner) as unknown as THREE.Path);
    const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: form.rimDepth, bevelEnabled: true, bevelThickness: form.rimDepth * 0.5, bevelSize: Math.min(0.035, (1 - form.rimInner) * 0.18), bevelSegments: 10, curveSegments: 64 }), metal);
    group3d.add(rim);
  }

  const field = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(group, form.field), { depth: form.fieldDepth, bevelEnabled: true, bevelThickness: form.fieldBevel, bevelSize: form.fieldBevelSize, bevelSegments: form.fieldSegments, curveSegments: 64 }), enamel);
  field.position.z = form.fieldZ;
  group3d.add(field);
  const fieldTop = form.fieldZ + form.fieldDepth + form.fieldBevel;

  if (earned && tier >= 5) {
    const inner = outline(group, form.field - 0.06);
    inner.holes.push(outline(group, form.field - 0.1) as unknown as THREE.Path);
    const band = new THREE.Mesh(new THREE.ExtrudeGeometry(inner, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.008, bevelSegments: 3, curveSegments: 64 }), metal);
    band.position.z = fieldTop - 0.015;
    group3d.add(band);
  }

  // The mark: raised in white glaze, raised in the rim's metal, raised in a deeper shade of the enamel,
  // cut into the field (a dark inlay barely above it) or printed flat in ink.
  const markMaterial = !earned
    ? new THREE.MeshPhysicalMaterial({ color: 0xe6e8eb, roughness: 0.7 })
    : style.mark === "metal" ? metalMaterial(style.metal, gold)
      : style.mark === "tone" ? new THREE.MeshPhysicalMaterial({ color: color.clone().multiplyScalar(0.62), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 })
        : style.mark === "engraved" ? new THREE.MeshPhysicalMaterial({ color: color.clone().multiplyScalar(0.38), roughness: 0.65 })
          : style.mark === "ink" ? new THREE.MeshPhysicalMaterial({ color: 0x222220, roughness: 0.9 })
            : new THREE.MeshPhysicalMaterial({ color: 0xfbf9f5, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), emissive: 0xffffff, emissiveIntensity: 0.06 });
  const flat = earned && (style.mark === "engraved" || style.mark === "ink");
  const { geometry: markShape, standing } = markGeometry(style.art, state === "concealed" ? "hidden" : id, 1.02 * (form.field / 0.8), earned);
  const mark = new THREE.Mesh(markShape, markMaterial);
  if (standing) {
    // A relief stands from the field: lower when unstruck, barely raised when cut or printed.
    mark.scale.z = !earned ? 0.6 : flat ? 0.18 : 1;
    mark.position.z = fieldTop - 0.004;
  } else {
    // Tubes lie half sunk in the field.
    mark.scale.z = !earned ? 0.5 : flat ? 0.12 : 1;
    mark.position.z = !earned ? fieldTop - 0.005 : flat ? fieldTop + 0.002 : fieldTop + 0.025;
  }
  group3d.add(mark);

  group3d.rotation.set(-0.08, 0.3, 0);
  return {
    object: group3d,
    frame: 1.3,
    lift: 0.08,
    shadow: { y: -1.22, width: 2.2, depth: 0.5, strength: 0.28 },
    backFace: -(form.backDepth + form.backBevel) - 0.002,
  };
}
