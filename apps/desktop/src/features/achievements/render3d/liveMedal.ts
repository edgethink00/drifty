import * as THREE from "three";
import type { AchievementArtProps } from "../achievementArt";
import { buildMedal, outline } from "./medal";
import { GOLD } from "./palette";
import { studioScene } from "./studio";

/**
 * A medal you can hold: the same model the images are baked from, drawn live
 * in an achievement's popup. Drag turns it, a flick lets it spin on and come
 * to rest face up or face down, a click turns it over. Its back carries the
 * achievement's name and the day it was first earned, engraved. Loaded only
 * when a popup opens, so the rest of the app never pulls in three.js.
 */
export type LiveMedalOptions = {
  readonly art: AchievementArtProps;
  /** Lines engraved on the back, or none for a blank back. */
  readonly engraving: readonly string[];
  /** A turn as it appears; left out when motion is reduced. */
  readonly spinIn: boolean;
  /** Called once the first frame is on screen, so the still image can step aside. */
  readonly onReady: () => void;
};

export type LiveMedal = { readonly dispose: () => void };

/** Resting turn and tilt, matching the baked image so the swap is seamless. */
const REST_YAW = 0.3;
const REST_PITCH = -0.08;
const TURN = Math.PI * 2;

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

  // Motion state, in radians and radians per second.
  let yaw = REST_YAW;
  let pitch = REST_PITCH;
  let yawSpeed = 0;
  let pitchSpeed = 0;
  /** 0 for face up, 1 for face down: which side a click or a flick leaves showing. */
  let side = 0;
  let coasting = false;
  let dragging: { id: number; x: number; y: number; moved: number; time: number } | null = null;
  let hover: { x: number; y: number } | null = null;
  let entrance: { start: number; from: number } | null = null;
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (options.spinIn && !calm) {
    yaw = REST_YAW - TURN;
    entrance = { start: performance.now(), from: yaw };
  }

  let frameId = 0;
  let last = performance.now();
  let ready = false;
  let disposed = false;

  const restYaw = () => REST_YAW + side * Math.PI + (hover && !calm ? hover.x * 0.32 : 0);
  const restPitch = () => REST_PITCH + (hover && !calm ? hover.y * 0.2 : 0);
  /** The nearest resting turn to the one given, on the side it lands on. */
  const landing = (at: number) => {
    const halfTurns = Math.round((at - REST_YAW) / Math.PI);
    side = ((halfTurns % 2) + 2) % 2;
  };

  const draw = () => {
    pivot.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      options.onReady();
    }
  };

  const tick = (now: number) => {
    frameId = 0;
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    let moving = false;
    if (entrance) {
      const t = Math.min(1, (now - entrance.start) / 1300);
      const eased = 1 - Math.pow(1 - t, 4);
      yaw = entrance.from + (REST_YAW - entrance.from) * eased;
      pitch = REST_PITCH;
      if (t >= 1) entrance = null;
      moving = true;
    } else if (!dragging) {
      if (coasting) {
        yaw += yawSpeed * dt;
        yawSpeed *= Math.exp(-dt / 0.55);
        if (Math.abs(yawSpeed) < 3.2) {
          coasting = false;
          // Land on the next side ahead when still turning, the nearest one when nearly still.
          const ahead = Math.abs(yawSpeed) > 0.8 ? Math.sign(yawSpeed) * Math.PI * 0.45 : 0;
          landing(yaw + ahead);
        }
      }
      if (!coasting) [yaw, yawSpeed] = spring(yaw, yawSpeed, nearestTurn(yaw, restYaw()), dt);
      [pitch, pitchSpeed] = spring(pitch, pitchSpeed, restPitch(), dt);
      moving = coasting
        || Math.abs(yaw - nearestTurn(yaw, restYaw())) > 0.0005 || Math.abs(yawSpeed) > 0.001
        || Math.abs(pitch - restPitch()) > 0.0005 || Math.abs(pitchSpeed) > 0.001;
    }
    draw();
    if (moving) frameId = requestAnimationFrame(tick);
  };
  /** The given resting angle, moved by whole turns to sit nearest the current one. */
  function nearestTurn(current: number, rest: number): number {
    return rest + Math.round((current - rest) / TURN) * TURN;
  }
  const wake = () => {
    if (disposed || frameId) return;
    last = performance.now();
    frameId = requestAnimationFrame(tick);
  };

  const unit = () => TURN / Math.max(120, canvas.clientWidth * 2.2);
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    entrance = null;
    coasting = false;
    yawSpeed = 0;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, time: event.timeStamp };
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "";
    event.preventDefault();
  };
  const onMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    hover = { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: ((event.clientY - rect.top) / rect.height) * 2 - 1 };
    if (!dragging || event.pointerId !== dragging.id) {
      wake();
      return;
    }
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    const seconds = Math.max(0.001, (event.timeStamp - dragging.time) / 1000);
    yaw += dx * unit();
    pitch = Math.max(-0.7, Math.min(0.7, pitch + dy * unit() * 0.6));
    // Keep a smoothed speed for the flick at release.
    yawSpeed = yawSpeed * 0.6 + ((dx * unit()) / seconds) * 0.4;
    dragging = { ...dragging, x: event.clientX, y: event.clientY, moved: dragging.moved + Math.abs(dx) + Math.abs(dy), time: event.timeStamp };
    draw();
  };
  const onUp = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    const click = dragging.moved < 4;
    const stale = event.timeStamp - dragging.time > 90;
    dragging = null;
    delete canvas.dataset.dragging;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (click) {
      // A click turns it over.
      side = 1 - side;
      yawSpeed = 0;
      coasting = false;
    } else if (!stale && Math.abs(yawSpeed) > 3.2) {
      coasting = true;
    } else {
      landing(yaw);
      yawSpeed = stale ? 0 : yawSpeed;
    }
    wake();
  };
  const onLeave = () => {
    hover = null;
    wake();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => { resize(); draw(); }) : null;
  observer?.observe(canvas);

  draw();
  wake();

  return {
    dispose() {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      observer?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      disposeAll(scene);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
