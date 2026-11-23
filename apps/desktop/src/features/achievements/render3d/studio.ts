import * as THREE from "three";

/** What a badge builder hands the studio: the object, centred on the origin and about 2 units tall. */
export type BadgeStage = {
  readonly object: THREE.Object3D;
  /** Half the visible height at the object, in world units. */
  readonly frame?: number;
  /** Camera height above the object's centre, for a slight look down. */
  readonly lift?: number;
  /** A soft contact shadow under the object, or none. */
  readonly shadow?: { readonly y: number; readonly width: number; readonly depth: number; readonly strength: number } | null;
};

export type RenderOptions = {
  /** Square output size in device pixels. */
  readonly px: number;
  /** Extra turn about the vertical axis, in radians. */
  readonly turn?: number;
};

let renderer: THREE.WebGLRenderer | null = null;
let environment: THREE.Texture | null = null;
let shadowTexture: THREE.Texture | null = null;
let scratch: CanvasRenderingContext2D | null = null;

/** A product-photography room: dark walls, a big soft key, two rim strips and an overhead panel. */
function studioScene(): THREE.Scene {
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

/** The shared renderer and studio light. Throws where WebGL is unavailable. */
export function studio(): { renderer: THREE.WebGLRenderer; environment: THREE.Texture } {
  if (!renderer || !environment) {
    const created = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    created.toneMapping = THREE.NeutralToneMapping;
    created.toneMappingExposure = 1;
    created.outputColorSpace = THREE.SRGBColorSpace;
    created.localClippingEnabled = true;
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

/** A badge as two layers: what it lets through, multiplied over the surface, and the light it adds on top. */
export type BadgeLayers = { readonly transmit: ImageData; readonly light: ImageData };

/**
 * Renders the stage twice, over black and over white. Over black we see only
 * the light the badge sends out (reflections, glow, opaque colour); the
 * difference to the white render is how much of the surface behind shows
 * through, per colour channel. Shown as a multiply layer and an additive
 * layer, tinted glass tints whatever surface it sits on, in either theme.
 */
export function renderStage(stage: BadgeStage, options: RenderOptions): BadgeLayers {
  const { renderer: gl, environment: env } = studio();
  const px = Math.max(16, Math.round(options.px));
  gl.setSize(px, px, false);
  const scene = new THREE.Scene();
  scene.environment = env;
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const holder = new THREE.Group();
  holder.add(stage.object);
  holder.rotation.y = options.turn ?? 0;
  scene.add(holder);
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

  scratch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!scratch) throw new Error("2D canvas unavailable");
  scratch.canvas.width = px;
  scratch.canvas.height = px;
  // The backdrop is a mesh, so it passes through the same tone mapping as
  // what is seen through glass; clear glass then cancels out exactly.
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
  scene.add(backdrop);
  const shots: Uint8ClampedArray[] = [];
  for (const background of [0x000000, 0xffffff]) {
    (backdrop.material as THREE.MeshBasicMaterial).color.set(background);
    gl.render(scene, camera);
    scratch.clearRect(0, 0, px, px);
    scratch.drawImage(gl.domElement, 0, 0, px, px);
    shots.push(scratch.getImageData(0, 0, px, px).data);
  }
  disposeTree(scene);
  const [black, white] = shots as [Uint8ClampedArray, Uint8ClampedArray];
  const full = [0, 1, 2].map((channel) => (white[channel]! - black[channel]!) || 255);
  const transmit = new ImageData(px, px);
  const light = new ImageData(px, px);
  const t = transmit.data;
  const l = light.data;
  const through = [0, 0, 0];
  for (let index = 0; index < t.length; index += 4) {
    let lowest = 1;
    let brightest = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Math.min(1, Math.max(0, (white[index + channel]! - black[index + channel]!) / full[channel]!));
      through[channel] = value;
      lowest = Math.min(lowest, value);
      brightest = Math.max(brightest, black[index + channel]!);
    }
    // Multiply layer: colour Cs at coverage a multiplies the surface by 1 - a(1 - Cs) = through.
    const cover = 1 - lowest;
    t[index + 3] = Math.round(cover * 255);
    for (let channel = 0; channel < 3; channel += 1) {
      t[index + channel] = cover > 0.002 ? Math.round((1 - (1 - through[channel]!) / cover) * 255) : 255;
    }
    // Additive layer, unpremultiplied for the canvas.
    l[index + 3] = brightest;
    for (let channel = 0; channel < 3; channel += 1) {
      l[index + channel] = brightest > 0 ? Math.min(255, Math.round((black[index + channel]! * 255) / brightest)) : 0;
    }
  }
  return { transmit, light };
}

export async function imageDataToUrl(image: ImageData): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG encoding failed");
  return URL.createObjectURL(blob);
}
