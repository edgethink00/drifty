import * as THREE from "three";

/**
 * The photo studio the achievement medals are rendered in. The bake script
 * (scripts/bake-achievement-badges.mjs) renders every medal to an image for
 * lists and cards; an achievement's popup loads the same studio on demand to
 * show its medal live (liveMedal.ts). Nothing else in the app loads three.js.
 */

/** What a badge builder hands the studio: the object, centred on the origin and about 2 units tall. */
export type BadgeStage = {
  readonly object: THREE.Object3D;
  /** Half the visible height at the object, in world units. */
  readonly frame?: number;
  /** Camera height above the object's centre, for a slight look down. */
  readonly lift?: number;
  /** A soft contact shadow under the object, or none. */
  readonly shadow?: { readonly y: number; readonly width: number; readonly depth: number; readonly strength: number } | null;
  /** Where the back face lies on z, for what is engraved there. */
  readonly backFace?: number;
};

let renderer: THREE.WebGLRenderer | null = null;
let environment: THREE.Texture | null = null;
let shadowTexture: THREE.Texture | null = null;
let scratch: CanvasRenderingContext2D | null = null;

/** A product-photography room: dark walls, a big soft key, two rim strips and an overhead panel. */
export function studioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.035, 0.035, 0.04);
  const panel = (width: number, height: number, intensity: number, position: readonly [number, number, number], warmth = 0) => {
    const color = new THREE.Color(intensity * (1 + warmth * 0.08), intensity, intensity * (1 - warmth * 0.1));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.set(position[0], position[1], position[2]);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  panel(7, 4.5, 6, [-5.5, 6, 5], 1);
  panel(5, 5, 1.6, [6.5, 1.5, 6]);
  panel(0.8, 11, 8, [-7.5, 0.5, -2.5]);
  panel(0.8, 11, 7, [7.5, 0.5, -2.5], -1);
  panel(8, 8, 2.2, [0, 9.5, 0]);
  panel(14, 14, 0.35, [0, -7, 0]);
  panel(16, 3, 0.6, [0, -1, -8]);
  return scene;
}

function radialShadow(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.55)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

function studio(): { renderer: THREE.WebGLRenderer; environment: THREE.Texture } {
  if (!renderer || !environment) {
    const created = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    created.toneMapping = THREE.NeutralToneMapping;
    created.outputColorSpace = THREE.SRGBColorSpace;
    created.setPixelRatio(1);
    const pmrem = new THREE.PMREMGenerator(created);
    environment = pmrem.fromScene(studioScene(), 0.02).texture;
    pmrem.dispose();
    renderer = created;
  }
  return { renderer, environment };
}

function disposeTree(object: THREE.Object3D) {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else if (material) material.dispose();
  });
}

/**
 * Renders the stage over black and over white and recovers each pixel's
 * colour and coverage from the two, so the medal and its soft shadow sit on
 * any surface, light or dark, as an ordinary transparent image.
 */
export function renderStage(stage: BadgeStage, px: number): HTMLCanvasElement {
  const { renderer: gl, environment: env } = studio();
  const size = Math.max(16, Math.round(px));
  gl.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.environment = env;
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-3, 5, 4);
  scene.add(key, stage.object);
  if (stage.shadow) {
    shadowTexture ??= radialShadow();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(stage.shadow.width, stage.shadow.depth),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture, transparent: true, opacity: stage.shadow.strength, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = stage.shadow.y;
    scene.add(plane);
  }
  const frame = stage.frame ?? 1.18;
  const fov = 22;
  const distance = frame / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  const lift = stage.lift ?? 0.12;
  camera.position.set(0, Math.sin(lift) * distance, Math.cos(lift) * distance);
  camera.lookAt(0, 0, 0);

  // The backdrop is a mesh, so it passes through the same tone mapping as the medal.
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
  scene.add(backdrop);
  scratch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!scratch) throw new Error("2D canvas unavailable");
  scratch.canvas.width = size;
  scratch.canvas.height = size;
  const shots: Uint8ClampedArray[] = [];
  for (const background of [0x000000, 0xffffff]) {
    (backdrop.material as THREE.MeshBasicMaterial).color.set(background);
    gl.render(scene, camera);
    scratch.clearRect(0, 0, size, size);
    scratch.drawImage(gl.domElement, 0, 0, size, size);
    shots.push(scratch.getImageData(0, 0, size, size).data);
  }
  disposeTree(scene);
  const [black, white] = shots as [Uint8ClampedArray, Uint8ClampedArray];
  const full = (white[0]! + white[1]! + white[2]! - black[0]! - black[1]! - black[2]!) / 3 || 255;
  const image = new ImageData(size, size);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const spread = ((white[index]! - black[index]!) + (white[index + 1]! - black[index + 1]!) + (white[index + 2]! - black[index + 2]!)) / 3;
    const alpha = Math.min(255, Math.max(0, 255 - (spread * 255) / full));
    data[index + 3] = alpha;
    if (alpha > 0) {
      const scale = 255 / alpha;
      data[index] = Math.min(255, black[index]! * scale);
      data[index + 1] = Math.min(255, black[index + 1]! * scale);
      data[index + 2] = Math.min(255, black[index + 2]! * scale);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  return canvas;
}
