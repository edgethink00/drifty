import * as THREE from "three";
import type { AchievementArtProps } from "../achievementArt";
import { ACHIEVEMENT_GLYPH_PATHS } from "../AchievementGlyph";
import { canvasTexture, roundedRect, tone } from "./forms";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

const WIDTH = 1.18;
const HEIGHT = 1.64;

function face(id: AchievementArtProps["id"], earned: boolean, concealed: boolean, tier: number): THREE.CanvasTexture {
  const base = new THREE.Color(BADGE_COLORS[id]);
  const texture = canvasTexture(512, 712, (ctx) => {
    if (earned) {
      const g = ctx.createLinearGradient(0, 0, 512, 712);
      g.addColorStop(0, tone(base, -0.05, 0.34).getStyle());
      g.addColorStop(0.55, tone(base, 0.02, 0.52).getStyle());
      g.addColorStop(1, tone(base, 0.1, 0.72, 0.8).getStyle());
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 712);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 2;
      for (let x = -712; x < 512; x += 9) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 712, 712); ctx.stroke(); }
      const halo = ctx.createRadialGradient(256, 330, 10, 256, 330, 230);
      halo.addColorStop(0, "rgba(255,255,255,0.45)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, 512, 712);
      ctx.save();
      ctx.translate(256 - 130, 330 - 130);
      ctx.scale(260 / 24, 260 / 24);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.1;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const d of ACHIEVEMENT_GLYPH_PATHS[id]) ctx.stroke(new Path2D(d));
      ctx.restore();
      ctx.fillStyle = "#f1d58e";
      for (let index = 0; index < Math.min(Math.max(tier, 1), 6); index += 1) {
        const x = 256 + (index - (Math.min(Math.max(tier, 1), 6) - 1) / 2) * 34;
        ctx.save();
        ctx.translate(x, 612);
        ctx.beginPath();
        ctx.moveTo(0, -11); ctx.quadraticCurveTo(3, -3, 11, 0); ctx.quadraticCurveTo(3, 3, 0, 11); ctx.quadraticCurveTo(-3, 3, -11, 0); ctx.quadraticCurveTo(-3, -3, 0, -11);
        ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.fillStyle = "#d9dadd";
      ctx.fillRect(0, 0, 512, 712);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      for (let r = 14; r < 520; r += 16) { ctx.beginPath(); ctx.arc(256, 356, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.save();
      ctx.translate(256 - 80, 356 - 80);
      ctx.scale(160 / 24, 160 / 24);
      ctx.strokeStyle = "rgba(120,122,128,0.75)";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const d of ACHIEVEMENT_GLYPH_PATHS[concealed ? "hidden" : id]) ctx.stroke(new Path2D(d));
      ctx.restore();
    }
    ctx.strokeStyle = earned ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(22, 22, 468, 668, 30);
    ctx.stroke();
    if (earned) {
      // Holographic foil: diagonal rainbow bands laid lightly over the whole face.
      ctx.globalCompositeOperation = "overlay";
      const foil = ctx.createLinearGradient(0, 0, 512, 712);
      ["#ff6b6b", "#ffd36b", "#7dff9c", "#6bd8ff", "#a36bff", "#ff6bd5", "#ff6b6b"].forEach((stop, index, all) => foil.addColorStop(index / (all.length - 1), stop));
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = foil;
      ctx.fillRect(0, 0, 512, 712);
      ctx.globalAlpha = 0.35;
      for (let y = -712; y < 712; y += 46) {
        const band = ctx.createLinearGradient(0, y, 512, y + 300);
        band.addColorStop(0, "rgba(255,255,255,0)");
        band.addColorStop(0.5, "rgba(255,255,255,0.9)");
        band.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = band;
        ctx.fillRect(0, y, 512, 14);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  });
  texture.repeat.set(1 / WIDTH, 1 / HEIGHT);
  texture.offset.set(0.5, 0.5);
  return texture;
}

/**
 * A holographic collector's card: the achievement's colour under a foil
 * that throws a thin rainbow as it tilts, its mark at the centre and a star
 * printed for each milestone. The edge is silver foil, gold from ten times.
 * Until earned you see only the card's back.
 */
export function buildCard({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const art = face(id, earned, state === "concealed", tier);
  const front = new THREE.MeshPhysicalMaterial(earned
    ? { map: art, emissive: 0xffffff, emissiveMap: art, emissiveIntensity: 0.28, roughness: 0.16, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [200, 1000], envMapIntensity: 1.2 }
    : { map: art, roughness: 0.6 });
  const foil = earned && tier >= 3 ? METALS.gold : METALS.silver;
  const edge = new THREE.MeshPhysicalMaterial({ color: earned ? foil.color : 0xcfd1d5, metalness: 1, roughness: 0.12 });
  const card = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(WIDTH, HEIGHT, 0.1), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 4, curveSegments: 24 }), [front, edge]);
  card.position.z = -0.02;
  const group = new THREE.Group();
  group.add(card);
  group.rotation.set(-0.12, 0.34, 0.1);
  return { object: group, frame: 0.98, lift: 0.08, shadow: { y: -0.9, width: 1.5, depth: 0.4, strength: 0.25 } };
}
