import * as THREE from "three";
import type { AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { canvasTexture, fitted, mixRgb, pixelTexture, rgb, tone } from "./forms";
import { BADGE_COLORS, seeded } from "./palette";
import type { BadgeStage } from "./studio";

type Surface = "bands" | "rock" | "ocean" | "star" | "ice";
type Planet = {
  readonly surface: Surface;
  readonly rings?: number;
  readonly tilt?: number;
  readonly twin?: boolean;
  readonly comet?: boolean;
  readonly orbit?: boolean;
  readonly sunrise?: boolean;
  readonly crescent?: boolean;
  readonly spot?: boolean;
};

const PLANETS: Record<AchievementId, Planet> = {
  firstFlow: { surface: "ocean" },
  flow90: { surface: "bands", tilt: 0.2 },
  flow180: { surface: "bands", spot: true, tilt: -0.15 },
  focusDay8h: { surface: "star" },
  earlyStart: { surface: "rock", sunrise: true },
  nightOwl: { surface: "rock", crescent: true },
  weekendShift: { surface: "bands", twin: true },
  streak7: { surface: "bands", rings: 7, tilt: 0.4 },
  streak30: { surface: "bands", rings: 24, tilt: -0.32 },
  focus100h: { surface: "bands", rings: 12, tilt: 0.28 },
  driftDay: { surface: "ice", comet: true, tilt: 0 },
  noDriftDay: { surface: "ice" },
  comeback: { surface: "rock", orbit: true },
};

function surfaceTexture(surface: Surface, base: THREE.Color, seed: string, spot: boolean): THREE.CanvasTexture {
  const random = seeded(seed);
  const phases = Array.from({ length: 6 }, () => random() * Math.PI * 2);
  const dark = rgb(tone(base, 0, 0.36));
  const mid = rgb(tone(base, 0.02, 0.55));
  const light = rgb(tone(base, 0.06, 0.78, 0.7));
  const other = rgb(tone(base, -0.06, 0.62, 0.85));
  if (surface === "bands") {
    const frequency = 7 + random() * 6;
    return pixelTexture(512, 256, (u, v) => {
      const warp = Math.sin(u * Math.PI * 4 + phases[0]!) * 0.012 + Math.sin(u * Math.PI * 10 + v * 9 + phases[1]!) * 0.006;
      const band = Math.sin((v + warp) * frequency * Math.PI + phases[2]!) * 0.5 + 0.5;
      const broad = Math.sin((v + warp * 0.5) * 3.1 * Math.PI + phases[3]!) * 0.5 + 0.5;
      let color = mixRgb(mixRgb(dark, mid, band), mixRgb(light, other, band), broad * 0.8);
      if (spot) {
        const dx = (u - 0.62) / 0.07;
        const dy = (v - 0.6) / 0.04;
        const r = dx * dx + dy * dy;
        if (r < 1) color = mixRgb(color, light, (1 - r) * 0.9);
        else if (r < 1.6) color = mixRgb(color, dark, (1.6 - r) * 0.5);
      }
      return [color[0], color[1], color[2], 255];
    });
  }
  if (surface === "star") {
    return canvasTexture(512, 256, (ctx) => {
      ctx.fillStyle = tone(base, 0, 0.6).getStyle();
      ctx.fillRect(0, 0, 512, 256);
      for (let index = 0; index < 900; index += 1) {
        const r = 2 + random() * 7;
        ctx.globalAlpha = 0.25 + random() * 0.35;
        ctx.fillStyle = random() > 0.5 ? tone(base, 0.03, 0.82, 0.9).getStyle() : tone(base, -0.03, 0.48).getStyle();
        ctx.beginPath();
        ctx.arc(random() * 512, random() * 256, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }
  if (surface === "ocean") {
    const ocean = tone(new THREE.Color(0x2e86c1), 0, 0.42);
    return canvasTexture(512, 256, (ctx) => {
      ctx.fillStyle = ocean.getStyle();
      ctx.fillRect(0, 0, 512, 256);
      for (let cluster = 0; cluster < 7; cluster += 1) {
        const cx = random() * 512;
        const cy = 40 + random() * 176;
        for (let index = 0; index < 22; index += 1) {
          ctx.fillStyle = (index % 3 === 0 ? tone(base, 0.04, 0.6) : tone(base, 0, 0.46)).getStyle();
          ctx.beginPath();
          ctx.arc(cx + (random() - 0.5) * 90, cy + (random() - 0.5) * 50, 6 + random() * 18, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineCap = "round";
      for (let index = 0; index < 14; index += 1) {
        ctx.lineWidth = 2 + random() * 4;
        const y = random() * 256;
        const x = random() * 512;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 30, y - 8, x + 60, y + 8, x + 70 + random() * 60, y);
        ctx.stroke();
      }
    });
  }
  if (surface === "ice") {
    return pixelTexture(512, 256, (u, v) => {
      const swirl = Math.sin(u * Math.PI * 6 + Math.sin(v * 12 + phases[0]!) * 1.6 + phases[1]!) * 0.5 + 0.5;
      const veil = Math.sin(v * Math.PI * 5 + u * 4 + phases[2]!) * 0.5 + 0.5;
      const color = mixRgb(mixRgb(light, [250, 252, 255], 0.55), mid, swirl * 0.25 + veil * 0.15);
      return [color[0], color[1], color[2], 255];
    });
  }
  return canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = tone(base, 0, 0.5, 0.55).getStyle();
    ctx.fillRect(0, 0, 512, 256);
    for (let index = 0; index < 160; index += 1) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = (random() > 0.5 ? tone(base, 0.02, 0.62, 0.5) : tone(base, -0.02, 0.4, 0.6)).getStyle();
      ctx.beginPath();
      ctx.arc(random() * 512, random() * 256, 10 + random() * 40, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let index = 0; index < 26; index += 1) {
      const x = random() * 512;
      const y = 20 + random() * 216;
      const r = 3 + random() * 14;
      ctx.fillStyle = tone(base, 0, 0.36, 0.5).getStyle();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = tone(base, 0, 0.72, 0.4).getStyle();
      ctx.lineWidth = Math.max(1, r * 0.25);
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI * 0.9, Math.PI * 1.7);
      ctx.stroke();
    }
  });
}

function ringTexture(base: THREE.Color, count: number, seed: string): THREE.CanvasTexture {
  const random = seeded(seed + "-ring");
  const inner = 0.64;
  const bands = Array.from({ length: count }, () => ({ alpha: 0.35 + random() * 0.6, light: 0.5 + random() * 0.35 }));
  return pixelTexture(512, 512, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (d < inner || d > 1) return [0, 0, 0, 0];
    const t = (d - inner) / (1 - inner);
    const band = bands[Math.min(count - 1, Math.floor(t * count))]!;
    const edge = Math.min(t, 1 - t) * 8;
    const color = rgb(tone(base, 0.03, band.light, 0.55));
    return [color[0], color[1], color[2], Math.round(255 * band.alpha * Math.min(1, edge))];
  });
}

function glow(radius: number, color: THREE.Color, opacity: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.BackSide }));
}

function sphere(radius: number, surface: Surface, base: THREE.Color, seed: string, earned: boolean, spot = false): THREE.Mesh {
  const map = surfaceTexture(earned ? surface : surface === "star" ? "rock" : surface, base, seed, spot);
  const star = earned && surface === "star";
  const material = new THREE.MeshPhysicalMaterial({
    map: star ? null : map,
    color: star ? 0x000000 : 0xffffff,
    emissive: star ? 0xffffff : 0x000000,
    emissiveMap: star ? map : null,
    emissiveIntensity: star ? 1.25 : 0,
    roughness: surface === "ice" ? 0.18 : surface === "ocean" ? 0.4 : 0.78,
    clearcoat: surface === "ice" || surface === "ocean" ? 1 : 0,
    bumpMap: surface === "rock" ? map : null,
    bumpScale: 3,
    envMapIntensity: 0.35,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), material);
}

/**
 * A small world for each achievement, lit like a photograph from orbit:
 * banded giants for long focus, a star for the full day, a sunrise over a
 * planet for the early start, a comet for the day adrift. Ringed worlds for
 * streaks. Milestones add moons. Until earned, a grey world in shadow.
 */
export function buildPlanet({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const plan: Planet = state === "concealed" ? { surface: "rock" } : PLANETS[id];
  const base = earned ? new THREE.Color(BADGE_COLORS[id]) : new THREE.Color(0x8e9096);
  const world = new THREE.Group();
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = plan.tilt ?? 0;
  world.add(tiltGroup);

  const sun = new THREE.DirectionalLight(0xfff4e6, plan.crescent ? 3.2 : 2.4);
  sun.position.set(plan.crescent ? 3 : plan.sunrise ? 1.5 : -2.6, plan.crescent ? 0.6 : plan.sunrise ? 1.4 : 1.8, plan.crescent ? -1.6 : plan.sunrise ? -2.5 : 2.2);
  world.add(sun);

  if (plan.twin) {
    const a = sphere(0.52, plan.surface, base, id, earned);
    a.position.set(-0.4, 0.14, 0);
    const b = sphere(0.36, plan.surface, tone(base, 0.06, 0.6), id + "b", earned);
    b.position.set(0.56, -0.28, 0.25);
    tiltGroup.add(a, b);
  } else if (plan.comet) {
    // A planet slipped off its orbit: the dashed path it should keep, and the world drifting away from it.
    const orbit = new THREE.Group();
    orbit.rotation.set(Math.PI / 2 - 0.35, 0, -0.18);
    const dashes = 36;
    for (let index = 0; index < dashes; index += 1) {
      const start = (index / dashes) * Math.PI * 2;
      orbit.add(new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.012, 8, 12, (Math.PI * 2) / dashes / 2), new THREE.MeshBasicMaterial({ color: earned ? tone(base, 0.04, 0.6, 0.6) : new THREE.Color(0xb0b2b6) })).rotateZ(start));
    }
    orbit.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshBasicMaterial({ color: earned ? tone(new THREE.Color(0xffc46b), 0, 0.75) : new THREE.Color(0xb0b2b6) })));
    tiltGroup.add(orbit);
    const drifter = sphere(0.36, "ice", base, id, earned);
    drifter.position.set(0.62, 0.62, 0.3);
    tiltGroup.add(drifter, glow(0.4, tone(base, 0.04, 0.82, 0.6), earned ? 0.22 : 0.06).translateX(0.62).translateY(0.62).translateZ(0.3));
    const trail = new THREE.CatmullRomCurve3([new THREE.Vector3(0.62, -0.45, 0.4), new THREE.Vector3(0.95, 0.0, 0.4), new THREE.Vector3(0.78, 0.38, 0.32)]);
    tiltGroup.add(new THREE.Mesh(new THREE.TubeGeometry(trail, 48, 0.014, 8), new THREE.MeshBasicMaterial({ color: earned ? tone(base, 0.04, 0.7, 0.6) : new THREE.Color(0xb8babe), transparent: true, opacity: 0.7 })));
  } else {
    const radius = plan.rings ? 0.56 : plan.orbit ? 0.58 : 0.74;
    const body = sphere(radius, plan.surface, base, id, earned, plan.spot);
    tiltGroup.add(body);
    if (plan.surface === "star" && earned) {
      tiltGroup.add(glow(radius * 1.16, tone(base, 0.02, 0.75), 0.35), glow(radius * 1.42, tone(base, 0.03, 0.85), 0.14));
    } else if (plan.surface !== "rock" || plan.sunrise) {
      tiltGroup.add(glow(radius * 1.05, tone(base, 0.04, 0.82, 0.6), earned ? 0.22 : 0.06));
    }
    if (plan.rings) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.32, radius * 2.15, 192, 1), new THREE.MeshStandardMaterial({ map: ringTexture(base, plan.rings, id), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.7, envMapIntensity: 0.6 }));
      ring.rotation.x = -Math.PI / 2 + 0.3;
      tiltGroup.add(ring);
    }
    if (plan.sunrise) {
      const star = new THREE.Mesh(new THREE.SphereGeometry(0.3, 48, 32), new THREE.MeshBasicMaterial({ color: earned ? tone(new THREE.Color(0xffc46b), 0, 0.82) : new THREE.Color(0xb0b2b6) }));
      star.position.set(0.5, 0.52, -0.9);
      world.add(star, glow(0.5, earned ? tone(new THREE.Color(0xffb35c), 0, 0.78) : new THREE.Color(0xc4c6ca), earned ? 0.35 : 0.1).translateX(0.5).translateY(0.52).translateZ(-0.9));
    }
    if (plan.orbit) {
      const orbit = new THREE.Group();
      orbit.rotation.set(Math.PI / 2 - 0.32, 0, 0.22);
      orbit.add(new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.008, 8, 256), new THREE.MeshBasicMaterial({ color: earned ? tone(base, 0.04, 0.85, 0.5) : new THREE.Color(0xc0c2c6), transparent: true, opacity: 0.55 })));
      orbit.add(new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.022, 12, 128, 1.6), new THREE.MeshBasicMaterial({ color: earned ? tone(base, 0.04, 0.7) : new THREE.Color(0xa8aaae) })));
      const moon = sphere(0.13, "ice", tone(base, 0.05, 0.8), id + "m", earned);
      moon.position.set(Math.cos(1.6) * 1.05, Math.sin(1.6) * 1.05, 0);
      orbit.add(moon);
      tiltGroup.add(orbit);
    }
  }

  if (earned) {
    const random = seeded(id + "-moons");
    for (let index = 0; index < Math.min(Math.max(tier - 1, 0), 4); index += 1) {
      const moon = sphere(0.07 + random() * 0.05, "rock", new THREE.Color(0xb8b4ae), id + "-moon" + index, true);
      const angle = -0.6 + index * 0.75;
      moon.position.set(Math.cos(angle) * 1.0, Math.sin(angle) * 0.55 - 0.2, 0.4);
      world.add(moon);
    }
  }
  world.rotation.y = 0.2;
  const fit = fitted(world, 2.2);
  return { object: fit.object, frame: 1.2, lift: 0.1, key: plan.crescent ? 0.02 : 0.35, shadow: null };
}
