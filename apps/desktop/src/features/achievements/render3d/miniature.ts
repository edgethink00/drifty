import * as THREE from "three";
import type { AchievementId } from "../achievementCatalog";
import type { AchievementArtProps } from "../achievementArt";
import { crescent, fitted, mesh, roundedBox, star4, tone } from "./forms";
import { numeralShapes } from "./numerals";
import { BADGE_COLORS, METALS } from "./palette";
import type { BadgeStage } from "./studio";

type Paint = {
  readonly plastic: (hex: number | THREE.Color, extra?: THREE.MeshPhysicalMaterialParameters) => THREE.Material;
  readonly metal: (hex: number) => THREE.Material;
  readonly light: (hex: number | THREE.Color, strength?: number) => THREE.Material;
  readonly accent: THREE.Color;
};

function paints(earned: boolean, accent: THREE.Color): Paint {
  const clay = new THREE.MeshPhysicalMaterial({ color: 0xe7e5e0, roughness: 0.86, sheen: 0.35, sheenColor: new THREE.Color(0xffffff) });
  return {
    plastic: (hex, extra) => earned ? new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.22, sheen: 0.25, sheenColor: new THREE.Color(0xffffff), ...extra }) : clay,
    metal: (hex) => earned ? new THREE.MeshPhysicalMaterial({ color: hex, metalness: 1, roughness: 0.16 }) : clay,
    light: (hex, strength = 0.9) => earned ? new THREE.MeshPhysicalMaterial({ color: hex, emissive: hex, emissiveIntensity: strength, roughness: 0.4 }) : clay,
    accent,
  };
}

function lathe(points: readonly (readonly [number, number])[], segments = 96): THREE.LatheGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function extrude(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 8, curveSegments: 48 });
  geometry.center();
  return geometry;
}

function triangle(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): THREE.Shape {
  return new THREE.Shape([new THREE.Vector2(a[0], a[1]), new THREE.Vector2(b[0], b[1]), new THREE.Vector2(c[0], c[1])]);
}

type Builder = (paint: Paint) => THREE.Group;

function group(...items: THREE.Object3D[]): THREE.Group {
  const result = new THREE.Group();
  items.forEach((item) => result.add(item));
  return result;
}

const calendar = (figure: string): Builder => (p) => group(
  mesh(roundedBox(1.2, 1.2, 0.42, 0.16), p.plastic(0xf7f5f1)),
  mesh(roundedBox(1.2, 0.34, 0.44, 0.14), p.plastic(p.accent), [0, 0.43, 0]),
  mesh(new THREE.TorusGeometry(0.09, 0.03, 16, 48), p.metal(METALS.silver.color), [-0.3, 0.62, 0], [0, Math.PI / 2, 0]),
  mesh(new THREE.TorusGeometry(0.09, 0.03, 16, 48), p.metal(METALS.silver.color), [0.3, 0.62, 0], [0, Math.PI / 2, 0]),
  mesh(new THREE.ExtrudeGeometry(numeralShapes(figure, 0.5, 0.8), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.015, bevelSegments: 4 }), p.plastic(tone(p.accent, 0, 0.32)), [0, -0.12, 0.2]),
);

const BUILDERS: Record<AchievementId, Builder> = {
  firstFlow: (p) => group(
    mesh(lathe([[0, -0.9], [0.36, -0.9], [0.46, -0.32], [0.52, -0.3], [0.52, -0.16], [0.44, -0.16], [0, -0.16]]), p.plastic(0xd9825b)),
    mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.04, 64), p.plastic(0x6b4a33, { roughness: 0.9 }), [0, -0.2, 0]),
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.03, 0.05, 0), new THREE.Vector3(-0.02, 0.32, 0)]), 32, 0.04, 12), p.plastic(tone(p.accent, 0, 0.38))),
    mesh(new THREE.SphereGeometry(1, 48, 32), p.plastic(p.accent), [-0.22, 0.4, 0], [0, 0, 0.55], [0.3, 0.09, 0.17]),
    mesh(new THREE.SphereGeometry(1, 48, 32), p.plastic(tone(p.accent, 0.04, 0.6)), [0.24, 0.46, 0], [0, 0, -0.6], [0.34, 0.1, 0.19]),
  ),
  flow90: (p) => group(
    mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.3, 96), p.plastic(p.accent), [0, 0, 0], [Math.PI / 2, 0, 0]),
    mesh(new THREE.TorusGeometry(0.66, 0.07, 24, 96), p.metal(METALS.silver.color), [0, 0, 0.12]),
    mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.02, 96), p.plastic(0xfbfaf7), [0, 0, 0.16], [Math.PI / 2, 0, 0]),
    mesh(new THREE.CircleGeometry(0.5, 64, -Math.PI / 2, Math.PI), p.plastic(tone(p.accent, 0.03, 0.72)), [0, 0, 0.176]),
    mesh(new THREE.BoxGeometry(0.045, 0.44, 0.03), p.plastic(0x2a2a2a), [0, 0.2, 0.2]),
    mesh(new THREE.SphereGeometry(0.06, 24, 16), p.metal(METALS.silver.color), [0, 0, 0.2]),
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 32), p.metal(METALS.silver.color), [0, 0.76, 0]),
    mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 32), p.plastic(p.accent), [0, 0.88, 0]),
  ),
  flow180: (p) => group(
    mesh(new THREE.ConeGeometry(0.82, 1.4, 64), p.plastic(p.accent), [0.12, 0, 0]),
    mesh(new THREE.ConeGeometry(0.3, 0.52, 64), p.plastic(0xffffff), [0.12, 0.45, 0]),
    mesh(new THREE.ConeGeometry(0.56, 0.9, 64), p.plastic(tone(p.accent, 0.05, 0.66)), [-0.52, -0.25, 0.2]),
    mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 12), p.metal(METALS.silver.color), [0.12, 0.88, 0]),
    mesh(new THREE.BoxGeometry(0.26, 0.15, 0.02), p.plastic(0xf2b33d), [0.25, 1.01, 0]),
  ),
  focusDay8h: (p) => {
    const rays = Array.from({ length: 8 }, (_, index) => {
      const a = (index / 8) * Math.PI * 2;
      return mesh(new THREE.ConeGeometry(0.11, 0.3, 32), p.light(tone(p.accent, 0.02, 0.62), 0.5), [Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0], [0, 0, a - Math.PI / 2]);
    });
    return group(mesh(new THREE.SphereGeometry(0.52, 64, 48), p.light(p.accent, 0.55)), ...rays);
  },
  earlyStart: (p) => group(
    mesh(lathe([[0, -0.6], [0.4, -0.6], [0.45, -0.55], [0.48, 0.22], [0.43, 0.22], [0.4, -0.48], [0, -0.48]]), p.plastic(p.accent)),
    mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 64), p.plastic(0x5b3826, { roughness: 0.2 }), [0, 0.12, 0]),
    mesh(new THREE.TorusGeometry(0.2, 0.06, 16, 48, Math.PI * 1.2), p.plastic(p.accent), [0.5, -0.15, 0], [0, 0, -Math.PI * 0.6]),
    mesh(lathe([[0, -0.68], [0.72, -0.66], [0.76, -0.6], [0.6, -0.6], [0, -0.62]]), p.plastic(0xf7f5f1)),
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.1, 0.3, 0), new THREE.Vector3(-0.2, 0.5, 0), new THREE.Vector3(-0.05, 0.7, 0), new THREE.Vector3(-0.15, 0.9, 0)]), 40, 0.035, 10), p.plastic(0xffffff)),
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, 0.3, 0), new THREE.Vector3(0.22, 0.48, 0), new THREE.Vector3(0.08, 0.64, 0), new THREE.Vector3(0.16, 0.8, 0)]), 40, 0.03, 10), p.plastic(0xffffff)),
  ),
  nightOwl: (p) => group(
    mesh(extrude(crescent(0.78, 0.66, [0.38, 0.22]), 0.1, 0.16), p.plastic(0xf6dc8e), [-0.12, 0, 0]),
    mesh(extrude(star4(0.22, 0.32), 0.04, 0.04), p.light(p.accent, 0.35), [0.55, 0.55, 0]),
    mesh(extrude(star4(0.13, 0.32), 0.03, 0.03), p.light(tone(p.accent, 0.05, 0.7), 0.35), [0.72, 0.1, 0.05]),
  ),
  weekendShift: (p) => group(
    mesh(roundedBox(1.4, 0.95, 0.42, 0.14), p.plastic(p.accent)),
    mesh(new THREE.TorusGeometry(0.22, 0.05, 16, 48, Math.PI), p.plastic(tone(p.accent, 0, 0.32)), [0, 0.47, 0]),
    mesh(roundedBox(1.42, 0.08, 0.44, 0.03), p.plastic(tone(p.accent, 0, 0.36)), [0, 0.12, 0]),
    mesh(roundedBox(0.16, 0.12, 0.08, 0.03), p.metal(METALS.gold.color), [-0.38, 0.12, 0.22]),
    mesh(roundedBox(0.16, 0.12, 0.08, 0.03), p.metal(METALS.gold.color), [0.38, 0.12, 0.22]),
  ),
  streak7: calendar("7"),
  streak30: calendar("30"),
  focus100h: (p) => group(
    mesh(lathe([[0, -0.05], [0.2, -0.05], [0.42, 0.08], [0.55, 0.35], [0.6, 0.7], [0.55, 0.7], [0.5, 0.36], [0.38, 0.12], [0, 0.06]]), p.metal(METALS.gold.color)),
    mesh(new THREE.TorusGeometry(0.2, 0.045, 16, 48, Math.PI * 1.1), p.metal(METALS.gold.color), [-0.6, 0.42, 0], [0, 0, Math.PI * 0.45]),
    mesh(new THREE.TorusGeometry(0.2, 0.045, 16, 48, Math.PI * 1.1), p.metal(METALS.gold.color), [0.6, 0.42, 0], [0, 0, -Math.PI * 0.45 + Math.PI]),
    mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.4, 32), p.metal(METALS.gold.color), [0, -0.25, 0]),
    mesh(roundedBox(0.7, 0.32, 0.5, 0.06), p.plastic(0x3a3632), [0, -0.6, 0]),
    mesh(roundedBox(0.4, 0.12, 0.02, 0.02), p.metal(METALS.gold.color), [0, -0.6, 0.26]),
  ),
  driftDay: (p) => {
    const water = new THREE.CircleGeometry(1, 96);
    const position = water.attributes.position as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) position.setZ(index, Math.sin(position.getX(index) * 7) * 0.03 + Math.cos(position.getY(index) * 6) * 0.03);
    water.computeVertexNormals();
    const hull = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.75, 0.2), new THREE.Vector2(0.75, 0.2), new THREE.Vector2(0.45, -0.2), new THREE.Vector2(-0.45, -0.2)]), { depth: 0.36, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
    hull.center();
    return group(
      mesh(water, p.plastic(0x7cc4dd, { roughness: 0.15, clearcoat: 1 }), [0, -0.32, 0], [-Math.PI / 2, 0, 0], [1, 0.6, 1]),
      mesh(hull, p.plastic(p.accent), [0, -0.12, 0], [0, 0, -0.18]),
      mesh(extrude(triangle([0, 0], [0.5, 0], [0, 0.75]), 0.02, 0.015), p.plastic(0xfbfaf7), [0.08, 0.38, 0], [0, 0, -0.18]),
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 12), p.plastic(0x6b4a33), [-0.04, 0.3, 0], [0, 0, -0.18]),
    );
  },
  noDriftDay: (p) => {
    const rings = [0.74, 0.56, 0.38, 0.2].map((radius, index) => mesh(new THREE.CylinderGeometry(radius, radius, 0.12 + index * 0.02, 96), p.plastic(index % 2 === 0 ? p.accent : new THREE.Color(0xfbfaf7)), [0, 0, index * 0.012], [Math.PI / 2, 0, 0]));
    const dart = group(
      mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 16), p.plastic(0x3a3632), [0, 0.3, 0]),
      mesh(new THREE.ConeGeometry(0.05, 0.14, 16), p.metal(METALS.silver.color), [0, -0.05, 0], [Math.PI, 0, 0]),
      mesh(extrude(triangle([0, 0], [0.16, -0.06], [0, 0.22]), 0.01, 0.01), p.metal(METALS.gold.color), [0.07, 0.55, 0]),
      mesh(extrude(triangle([0, 0], [-0.16, -0.06], [0, 0.22]), 0.01, 0.01), p.metal(METALS.gold.color), [-0.07, 0.55, 0]),
    );
    dart.position.set(0.02, 0.05, 0.12);
    dart.rotation.set(-0.9, 0, -0.5);
    return group(...rings, dart);
  },
  comeback: (p) => {
    const fin = (angle: number) => {
      const holder = new THREE.Group();
      holder.rotation.y = angle;
      holder.add(mesh(extrude(triangle([0, 0], [0.26, -0.18], [0, 0.32]), 0.03, 0.02), p.plastic(p.accent), [0.26, -0.42, 0]));
      return holder;
    };
    const rocket = group(
      mesh(lathe([[0, -0.6], [0.2, -0.6], [0.28, -0.3], [0.3, 0.1], [0.24, 0.42], [0.12, 0.62], [0, 0.7]]), p.plastic(0xfbfaf7)),
      mesh(lathe([[0, 0.38], [0.255, 0.38], [0.23, 0.46], [0.12, 0.64], [0, 0.72]]), p.plastic(p.accent)),
      mesh(new THREE.TorusGeometry(0.11, 0.03, 16, 48), p.metal(METALS.silver.color), [0, 0.08, 0.28]),
      mesh(new THREE.CircleGeometry(0.1, 32), p.plastic(0x8fd3e6, { roughness: 0.05, clearcoat: 1 }), [0, 0.08, 0.29]),
      fin(0), fin((Math.PI * 2) / 3), fin((Math.PI * 4) / 3),
      mesh(new THREE.ConeGeometry(0.16, 0.42, 32), p.light(0xffa64d, 1.1), [0, -0.82, 0], [Math.PI, 0, 0]),
    );
    rocket.rotation.z = -0.5;
    return rocket;
  },
};

function giftBox(paint: Paint): THREE.Group {
  return group(
    mesh(roundedBox(1.1, 0.9, 1.1, 0.08), paint.plastic(0xe0e0e0)),
    mesh(roundedBox(1.2, 0.24, 1.2, 0.06), paint.plastic(0xe0e0e0), [0, 0.5, 0]),
    mesh(new THREE.TorusGeometry(0.16, 0.05, 16, 48), paint.plastic(0xe0e0e0), [-0.14, 0.72, 0], [0, 0, 0.6], [1, 0.8, 1]),
    mesh(new THREE.TorusGeometry(0.16, 0.05, 16, 48), paint.plastic(0xe0e0e0), [0.14, 0.72, 0], [0, 0, -0.6], [1, 0.8, 1]),
  );
}

/**
 * A small painted object for each achievement, the way 3D emoji are made:
 * a seedling for the first focus, a stopwatch, a summit, a sun for the
 * full day, the first coffee, a crescent moon, a briefcase for the weekend,
 * calendars, a trophy, a paper boat adrift, a dart in the bullseye and a
 * rocket for the comeback. They stand on a plinth whose rim turns gold from
 * ten times. Until earned they are unpainted clay; hidden ones are a
 * wrapped gift.
 */
export function buildMiniature({ id, state, tier }: AchievementArtProps): BadgeStage {
  const earned = state === "earned";
  const paint = paints(earned, new THREE.Color(BADGE_COLORS[id]));
  const object = state === "concealed" ? giftBox(paints(false, new THREE.Color(0xe0e0e0))) : BUILDERS[id](paint);
  object.rotation.y += 0.32;
  object.rotation.x += 0.08;
  const objectFit = fitted(object, 1.5);
  const scene = new THREE.Group();
  objectFit.object.position.y = 0.18;
  scene.add(objectFit.object);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.7, 0.14, 96), new THREE.MeshPhysicalMaterial({ color: earned ? 0xf4f2ee : 0xe2e0dc, roughness: 0.35, clearcoat: 0.4 }));
  plinth.position.y = 0.18 + objectFit.bottom - 0.08;
  const rimMetal = earned && tier >= 3 ? METALS.gold : METALS.silver;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.685, 0.018, 12, 160), new THREE.MeshPhysicalMaterial({ color: earned ? rimMetal.color : 0xd2d4d8, metalness: 1, roughness: 0.15 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = plinth.position.y + 0.07;
  scene.add(plinth, rim);
  const fit = fitted(scene, 2.1);
  return { object: fit.object, frame: 1.16, lift: 0.16, shadow: { y: fit.bottom - 0.005, width: 1.9, depth: 0.5, strength: 0.3 } };
}
