import * as THREE from "three";

/** Centres an object on the origin and scales it so its larger side spans size. */
export function fitted(object: THREE.Object3D, size: number): { readonly object: THREE.Group; readonly bottom: number } {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const dims = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const scale = size / Math.max(dims.x, dims.y, 1e-3);
  object.position.sub(centre);
  const holder = new THREE.Group();
  holder.add(object);
  holder.scale.setScalar(scale);
  return { object: holder, bottom: (box.min.y - centre.y) * scale };
}

export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A texture painted pixel by pixel; shade returns sRGB 0-255 and alpha. */
export function pixelTexture(width: number, height: number, shade: (u: number, v: number) => readonly [number, number, number, number]): THREE.CanvasTexture {
  return canvasTexture(width, height, (ctx) => {
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b, a] = shade(x / width, y / height);
        const index = (y * width + x) * 4;
        image.data[index] = r;
        image.data[index + 1] = g;
        image.data[index + 2] = b;
        image.data[index + 3] = a;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}

/** The same colour moved round the wheel, at a given sRGB lightness. */
export function tone(base: THREE.Color, hueShift: number, lightness: number, saturation = 1): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);
  return new THREE.Color().setHSL((hsl.h + hueShift + 1) % 1, Math.min(1, hsl.s * saturation), lightness, THREE.SRGBColorSpace);
}

export function rgb(color: THREE.Color): readonly [number, number, number] {
  const hex = color.getHex();
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function mixRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function roundedRect(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

/** A soft box, its depth along z, centred on the origin. */
export function roundedBox(width: number, height: number, depth: number, radius: number): THREE.BufferGeometry {
  const bevel = Math.min(radius, depth / 2 - 0.001);
  const geometry = new THREE.ExtrudeGeometry(roundedRect(width - bevel * 2, height - bevel * 2, Math.max(radius - bevel, 0.001)), {
    depth: Math.max(depth - bevel * 2, 0.001),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 8,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -(depth - bevel * 2) / 2);
  return geometry;
}

export function star4(radius: number, waist = 0.28): THREE.Shape {
  const shape = new THREE.Shape();
  const w = radius * waist;
  shape.moveTo(0, radius);
  shape.quadraticCurveTo(w, w, radius, 0);
  shape.quadraticCurveTo(w, -w, 0, -radius);
  shape.quadraticCurveTo(-w, -w, -radius, 0);
  shape.quadraticCurveTo(-w, w, 0, radius);
  return shape;
}

/** A crescent: the part of one circle outside another, offset, circle. */
export function crescent(radius: number, cut: number, offset: readonly [number, number]): THREE.Shape {
  const outside = (x: number, y: number) => Math.hypot(x - offset[0], y - offset[1]) > cut;
  const steps = 240;
  const outer: THREE.Vector2[] = [];
  let start = 0;
  for (let index = 0; index < steps; index += 1) {
    const a = (index / steps) * Math.PI * 2;
    const b = ((index - 1) / steps) * Math.PI * 2;
    if (outside(Math.cos(a) * radius, Math.sin(a) * radius) && !outside(Math.cos(b) * radius, Math.sin(b) * radius)) start = index;
  }
  for (let step = 0; step < steps; step += 1) {
    const a = ((start + step) / steps) * Math.PI * 2;
    const point = new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius);
    if (!outside(point.x, point.y)) break;
    outer.push(point);
  }
  const inner: THREE.Vector2[] = [];
  for (let index = 0; index < steps; index += 1) {
    const a = (index / steps) * Math.PI * 2;
    const point = new THREE.Vector2(offset[0] + Math.cos(a) * cut, offset[1] + Math.sin(a) * cut);
    if (point.length() < radius) inner.push(point);
  }
  const ordered = orderArc(inner, offset);
  const last = outer[outer.length - 1]!;
  if (ordered.length && last.distanceTo(ordered[0]!) > last.distanceTo(ordered[ordered.length - 1]!)) ordered.reverse();
  return new THREE.Shape([...outer, ...ordered]);
}

function orderArc(points: THREE.Vector2[], centre: readonly [number, number]): THREE.Vector2[] {
  const angles = points.map((point) => ({ point, angle: Math.atan2(point.y - centre[1], point.x - centre[0]) }));
  angles.sort((a, b) => a.angle - b.angle);
  let gapAt = 0;
  let gap = 0;
  angles.forEach((item, index) => {
    const next = angles[(index + 1) % angles.length]!;
    const step = (next.angle - item.angle + Math.PI * 2) % (Math.PI * 2);
    if (step > gap) { gap = step; gapAt = (index + 1) % angles.length; }
  });
  return [...angles.slice(gapAt), ...angles.slice(0, gapAt)].map((item) => item.point);
}

/** Vertex colours running from one colour to another along height (and a little across). */
export function gradient(geometry: THREE.BufferGeometry, from: THREE.Color, to: THREE.Color, across = 0.35): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const y = (position.getY(index) - box.min.y) / Math.max(box.max.y - box.min.y, 1e-3);
    const x = (position.getX(index) - box.min.x) / Math.max(box.max.x - box.min.x, 1e-3);
    color.copy(from).lerp(to, Math.min(1, Math.max(0, y * (1 - across) + x * across)));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], position: readonly [number, number, number] = [0, 0, 0], rotation: readonly [number, number, number] = [0, 0, 0], scale: number | readonly [number, number, number] = 1): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(position[0], position[1], position[2]);
  item.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (typeof scale === "number") item.scale.setScalar(scale);
  else item.scale.set(scale[0], scale[1], scale[2]);
  return item;
}
