import * as THREE from "three";
import type { AchievementArtProps } from "../achievementArt";
import { buildMedal, outline } from "./medal";
import { GOLD } from "./palette";
import { studioScene } from "./studio";

/**
 * A medal you can hold: the same model the images are baked from, drawn live
 * in an achievement's popup. It turns only while held: grab and drag, and on
 * letting go it settles on the nearer face, front or back. Left alone it leans
 * a little toward the pointer wherever it is. Its back carries the
 * achievement's name and the day it was first earned, engraved. Loaded only
 * when a popup opens, so the rest of the app never pulls in three.js.
 */
export type LiveMedalOptions = {
  readonly art: AchievementArtProps;
  /** Lines engraved on the back, or none for a blank back. */
  readonly engraving: readonly string[];
  /** Called once the first frame is on screen, so the still image can step aside. */
  readonly onReady: () => void;
};

export type LiveMedal = { readonly dispose: () => void };

/** Resting turn and tilt, matching the baked image so the swap is seamless. */
const REST_YAW = 0.3;
const REST_PITCH = -0.08;
const TURN = Math.PI * 2;
/** How far it leans toward a pointer at the window's edge, and how far a drag may tilt it. */
const LEAN_YAW = 0.2;
const LEAN_PITCH = 0.14;
const MAX_PITCH = 0.75;

function engravingTexture(lines: readonly string[], fontFamily: string): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const sizes = lines.map((_, index) => (index === 0 ? 112 : 66));
    const gap = 40;
    const height = sizes.reduce((sum, value) => sum + value, 0) + gap * (lines.length - 1);
    let y = size / 2 - height / 2;
    lines.forEach((line, index) => {
      const fontSize = sizes[index]!;
      ctx.font = (index === 0 ? "600 " : "500 ") + fontSize + "px " + fontFamily;
      const width = ctx.measureText(line).width;
      const fit = Math.min(1, 660 / Math.max(1, width));
      ctx.save();
      ctx.translate(size / 2, y + fontSize / 2);
      ctx.scale(fit, fit);
      ctx.fillText(line, 0, 0);
      ctx.restore();
      y += fontSize + gap;
    });
  }
  return new THREE.CanvasTexture(canvas);
}

function disposeAll(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = ([] as THREE.Material[]).concat((mesh.material as THREE.Material | THREE.Material[] | undefined) ?? []);
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

/** A spring step: critically damped enough to settle without wobbling twice. */
function spring(position: number, velocity: number, target: number, dt: number, omega = 9, damping = 0.82): [number, number] {
  const acceleration = -omega * omega * (position - target) - 2 * damping * omega * velocity;
  const next = velocity + acceleration * dt;
  return [position + next * dt, next];
}

export function mountLiveMedal(canvas: HTMLCanvasElement, options: LiveMedalOptions): LiveMedal {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studioScene(), 0.02).texture;
  pmrem.dispose();

  const scene = new THREE.Scene();
  scene.environment = environment;
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-3, 5, 4);
  scene.add(key);

  const stage = buildMedal(options.art);
  stage.object.rotation.set(0, 0, 0);
  const pivot = new THREE.Group();
  pivot.add(stage.object);
  scene.add(pivot);

  const { art } = options;
  if (options.engraving.length > 0 && art.state === "earned") {
    const gold = art.tier >= 3;
    const letters = engravingTexture(options.engraving, getComputedStyle(canvas).fontFamily || "sans-serif");
    const back = new THREE.Mesh(
      new THREE.ShapeGeometry(outline(art.group, 0.9), 48),
      new THREE.MeshPhysicalMaterial({
        color: gold ? new THREE.Color(GOLD).multiplyScalar(0.62) : 0x7d848d,
        metalness: 1,
        roughness: 0.62,
        transparent: true,
        alphaMap: letters,
        depthWrite: false,
      }),
    );
    // ShapeGeometry's UVs are its x and y, so map the texture across the outline's box.
    const uv = back.geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let index = 0; index < uv.count; index += 1) uv.setXY(index, uv.getX(index) / 2.2 + 0.5, uv.getY(index) / 2.2 + 0.5);
    back.rotation.y = Math.PI;
    back.position.z = -0.152;
    stage.object.add(back);
  }

  if (stage.shadow) {
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext("2d");
    if (ctx) {
      // An alpha map reads brightness, so the falloff is drawn white to black on an opaque canvas.
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 128, 128);
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.45, "#8c8c8c");
      gradient.addColorStop(1, "#000000");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(stage.shadow.width, stage.shadow.depth),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: new THREE.CanvasTexture(shadowCanvas), transparent: true, opacity: stage.shadow.strength, depthWrite: false }),
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

  const resize = () => {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();

  // Motion state: turn (yaw), tilt (pitch) and raise (scale), each with its speed per second.
  let yaw = REST_YAW;
  let pitch = REST_PITCH;
  let raise = 1;
  let yawSpeed = 0;
  let pitchSpeed = 0;
  let raiseSpeed = 0;
  /** Which face rests toward you: 0 the front, 1 the back. Only a drag changes it. */
  let side = 0;
  let dragging: { id: number; x: number; y: number; time: number } | null = null;
  /** Where the pointer is relative to the medal, -1 to 1 across about half the window each way. */
  let lean = { x: 0, y: 0 };
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  let frameId = 0;
  let last = performance.now();
  let ready = false;
  let disposed = false;

  /** The resting turn on the current face, leaning a little toward the pointer. */
  const restYaw = () => REST_YAW + side * Math.PI + lean.x * LEAN_YAW;
  /** The resting tilt, leaning a little toward the pointer. */
  const restPitch = () => REST_PITCH + lean.y * LEAN_PITCH;
  const nearestTurn = (current: number, rest: number) => rest + Math.round((current - rest) / TURN) * TURN;

  const draw = () => {
    pivot.rotation.set(pitch, yaw, 0);
    pivot.scale.setScalar(raise);
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      options.onReady();
    }
  };

  const tick = (now: number) => {
    frameId = 0;
    if (disposed) return;
    const dt = Math.min(0.034, Math.max(0.001, (now - last) / 1000));
    last = now;
    [raise, raiseSpeed] = spring(raise, raiseSpeed, dragging ? 1.045 : 1, dt, 16, 0.7);
    if (!dragging) {
      // Released, or never held: settle on the face, a following lean slower than a snap back.
      const following = Math.abs(yawSpeed) < 0.6 && Math.abs(yaw - nearestTurn(yaw, restYaw())) < 0.5;
      const omega = following ? 7 : 11;
      [yaw, yawSpeed] = spring(yaw, yawSpeed, nearestTurn(yaw, restYaw()), dt, omega, following ? 1 : 0.74);
      [pitch, pitchSpeed] = spring(pitch, pitchSpeed, restPitch(), dt, following ? 7 : 11, following ? 1 : 0.74);
    }
    draw();
    const moving = Math.abs(raise - (dragging ? 1.045 : 1)) > 0.0005 || Math.abs(raiseSpeed) > 0.001
      || (!dragging && (Math.abs(yaw - nearestTurn(yaw, restYaw())) > 0.0005 || Math.abs(yawSpeed) > 0.001
        || Math.abs(pitch - restPitch()) > 0.0005 || Math.abs(pitchSpeed) > 0.001));
    if (moving) frameId = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (disposed || frameId) return;
    last = performance.now();
    frameId = requestAnimationFrame(tick);
  };

  /** Radians per pixel: dragging across the medal turns it about half a turn. */
  const unit = () => Math.PI / Math.max(80, canvas.clientWidth);
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    yawSpeed = 0;
    pitchSpeed = 0;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "";
    event.preventDefault();
    wake();
  };
  const onDrag = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    const seconds = Math.max(0.004, (event.timeStamp - dragging.time) / 1000);
    yaw += dx * unit();
    // Tilt gives way toward its limit instead of stopping dead.
    const room = 1 - Math.min(1, Math.abs(pitch - REST_PITCH) / MAX_PITCH);
    pitch += dy * unit() * 0.75 * (Math.sign(dy) === Math.sign(pitch - REST_PITCH) ? room : 1);
    yawSpeed = yawSpeed * 0.5 + ((dx * unit()) / seconds) * 0.5;
    pitchSpeed = pitchSpeed * 0.5 + ((dy * unit() * 0.75) / seconds) * 0.5;
    dragging = { ...dragging, x: event.clientX, y: event.clientY, time: event.timeStamp };
    draw();
  };
  const onUp = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    // A pause before letting go means no flick.
    if (event.timeStamp - dragging.time > 80) {
      yawSpeed = 0;
      pitchSpeed = 0;
    }
    dragging = null;
    delete canvas.dataset.dragging;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    // Rest on whichever face the flick carries it to, never more than half a turn on.
    const carry = Math.max(-Math.PI * 0.5, Math.min(Math.PI * 0.5, yawSpeed * 0.12));
    const halfTurns = Math.round((yaw + carry - REST_YAW - lean.x * LEAN_YAW) / Math.PI);
    side = ((halfTurns % 2) + 2) % 2;
    yawSpeed = Math.max(-12, Math.min(12, yawSpeed));
    wake();
  };
  /** Anywhere in the window, the medal leans a little toward the pointer. */
  const onPoint = (event: PointerEvent) => {
    if (calm) return;
    const rect = canvas.getBoundingClientRect();
    const reachX = Math.max(rect.width, window.innerWidth / 2);
    const reachY = Math.max(rect.height, window.innerHeight / 2);
    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    lean = {
      x: clamp((event.clientX - (rect.left + rect.width / 2)) / reachX),
      y: clamp((event.clientY - (rect.top + rect.height / 2)) / reachY),
    };
    if (!dragging) wake();
  };
  const onAway = () => {
    lean = { x: 0, y: 0 };
    wake();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onDrag);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  window.addEventListener("pointermove", onPoint, { passive: true });
  document.documentElement.addEventListener("pointerleave", onAway);
  window.addEventListener("blur", onAway);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => { resize(); draw(); }) : null;
  observer?.observe(canvas);

  draw();

  return {
    dispose() {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      observer?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onDrag);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onPoint);
      document.documentElement.removeEventListener("pointerleave", onAway);
      window.removeEventListener("blur", onAway);
      disposeAll(scene);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
