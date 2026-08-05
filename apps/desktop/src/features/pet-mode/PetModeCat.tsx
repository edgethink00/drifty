import { useEffect, useState } from "react";
import {
  getPetModeGaitFramesPerSecond,
  PET_MODE_LIFE_MOTION_FPS,
  PET_MODE_LIFE_MOTION_FRAME_COUNT,
  PET_MODE_PAW_CONTACT_FRAME,
} from "./petModeData";

type PetModeCatPhase =
  | "idle"
  | "walk"
  | "run"
  | "paw"
  | "happy"
  | "blink"
  | "stretch"
  | "tail"
  | "sleep"
  | "drag"
  | "settle";

type WalkFramesFile = {
  readonly frames: readonly string[];
  readonly cycleSeconds: number;
};

const LIFE_MOTION_ASSET_BY_PHASE = {
  stretch: "stretch",
  tail: "tail",
} as const;
const DRAG_SCRUFF_ASSET_BY_POSE = {
  a: "/pet-mode/drag/scruff-a.png?v=gpt-image-20260805",
  b: "/pet-mode/drag/scruff-b.png?v=gpt-image-20260805",
} as const;

export type PetModeDragPose = keyof typeof DRAG_SCRUFF_ASSET_BY_POSE;

type LifeMotionPhase = keyof typeof LIFE_MOTION_ASSET_BY_PHASE;

export function PetModeCat({
  phase,
  facing,
  pawFrame,
  dragPose,
}: {
  readonly phase: PetModeCatPhase;
  readonly facing: "left" | "right";
  readonly pawFrame: number;
  readonly dragPose: PetModeDragPose;
}) {
  const [walkFrames, setWalkFrames] = useState<readonly string[]>([]);
  const [walkFrame, setWalkFrame] = useState(0);
  const [lifeMotionFrame, setLifeMotionFrame] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch("/pet-mode/walk-frames-v2.json")
      .then((response) => response.json() as Promise<WalkFramesFile>)
      .then((payload) => {
        if (active && Array.isArray(payload.frames)) setWalkFrames(payload.frames);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    for (const motion of Object.values(LIFE_MOTION_ASSET_BY_PHASE)) {
      for (let frame = 1; frame <= PET_MODE_LIFE_MOTION_FRAME_COUNT; frame += 1) {
        const image = new Image();
        image.src = `/pet-mode/life-motion/${motion}/f${String(frame).padStart(3, "0")}.png`;
        void image.decode?.().catch(() => undefined);
      }
    }
  }, []);

  useEffect(() => {
    // The F12 frames are deliberately high-resolution source crops. Decode the
    // whole reviewed range before it can be requested by an intervention so a
    // src swap never produces a white/transparent decode flash mid-reach.
    for (let frame = 1; frame <= PET_MODE_PAW_CONTACT_FRAME + 1; frame += 1) {
      const image = new Image();
      image.src = `/pet-mode/paw/f${String(frame).padStart(3, "0")}.png`;
      void image.decode?.().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    // Drag feedback has to be available on the very first grab. Waiting for
    // the phase swap to request this bitmap creates a one-frame empty pet while
    // the native window has already started following the pointer.
    for (const asset of Object.values(DRAG_SCRUFF_ASSET_BY_POSE)) {
      const image = new Image();
      image.src = asset;
      void image.decode?.().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const moving = phase === "walk" || phase === "run";
    if (!moving || walkFrames.length === 0) return undefined;
    setWalkFrame(0);
    const framesPerSecond = getPetModeGaitFramesPerSecond(phase === "run" ? "run" : "walk");
    const startedAt = performance.now();
    let displayedFrame = 0;
    let animationFrameId = 0;
    const render = (now: number) => {
      // The prototype advances gait in its requestAnimationFrame loop. Do the
      // same here: at run speed it may skip source indices, but it never queues
      // several full-silhouette React updates between display refreshes.
      const nextFrame = Math.floor((now - startedAt) * framesPerSecond / 1000) % walkFrames.length;
      if (nextFrame !== displayedFrame) {
        displayedFrame = nextFrame;
        setWalkFrame(nextFrame);
      }
      animationFrameId = window.requestAnimationFrame(render);
    };
    animationFrameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [phase, walkFrames.length]);

  useEffect(() => {
    if (!isLifeMotionPhase(phase)) return undefined;
    setLifeMotionFrame(0);
    const startedAt = performance.now();
    let displayedFrame = 0;
    let animationFrameId = 0;
    const render = (now: number) => {
      const nextFrame = Math.min(
        PET_MODE_LIFE_MOTION_FRAME_COUNT - 1,
        Math.floor((now - startedAt) * PET_MODE_LIFE_MOTION_FPS / 1000),
      );
      if (nextFrame !== displayedFrame) {
        displayedFrame = nextFrame;
        setLifeMotionFrame(nextFrame);
      }
      if (nextFrame < PET_MODE_LIFE_MOTION_FRAME_COUNT - 1) {
        animationFrameId = window.requestAnimationFrame(render);
      }
    };
    animationFrameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [phase]);

  const mirrored = facing === "left";
  const rootClass = `pet-mode-cat pet-mode-cat--${phase}${mirrored ? " is-mirrored" : ""}`;
  const usesSeparatedFace = phase === "blink"
    || phase === "happy";
  const lifeMotionAsset = isLifeMotionPhase(phase)
    ? LIFE_MOTION_ASSET_BY_PHASE[phase]
    : null;

  return (
    <div className={rootClass} aria-label="Drifty pet cat" data-phase={phase}>
      <div className="pet-mode-cat__motion">
        {phase === "paw" ? (
          <img
            className="pet-mode-cat__raster pet-mode-cat__raster--paw"
            src={`/pet-mode/paw/f${String(pawFrame + 1).padStart(3, "0")}.png`}
            alt=""
            draggable={false}
          />
        ) : phase === "drag" ? (
          <img
            className="pet-mode-cat__raster pet-mode-cat__raster--drag"
            src={DRAG_SCRUFF_ASSET_BY_POSE[dragPose]}
            alt=""
            draggable={false}
          />
        ) : phase === "settle" ? (
          <img
            className="pet-mode-cat__raster pet-mode-cat__drag-idle"
            src="/pet-mode/paw/f001.png"
            alt=""
            draggable={false}
          />
        ) : lifeMotionAsset ? (
          <img
            className="pet-mode-cat__raster pet-mode-cat__raster--life-motion"
            src={`/pet-mode/life-motion/${lifeMotionAsset}/f${String(lifeMotionFrame + 1).padStart(3, "0")}.png`}
            alt=""
            draggable={false}
          />
        ) : phase === "sleep" ? (
          <PetModeSleepPose />
        ) : (phase === "walk" || phase === "run") && walkFrames.length > 0 ? (
          <svg className="pet-mode-cat__vector" viewBox="0 0 150 120" aria-hidden="true">
            <path d={walkFrames[walkFrame]} fill="currentColor" />
            <g className="pet-mode-cat__face">
              <circle cx="120.4" cy="46.2" r="2.2" />
              <circle cx="140.3" cy="46.2" r="2.2" />
              <path d="M127.6 50.2 Q129.6 52.8 131.6 50.5 Q133.6 52.8 135.7 50.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </g>
          </svg>
        ) : (
          <img
            className="pet-mode-cat__raster"
            src="/pet-mode/paw/f001.png"
            alt=""
            draggable={false}
          />
        )}
        {usesSeparatedFace ? <span className="pet-mode-cat__face-erase" aria-hidden="true" /> : null}
      </div>
      {usesSeparatedFace ? <PetModeExpression phase={phase} /> : null}
      <span className="pet-mode-cat__toy" aria-hidden="true" />
      <span className="pet-mode-cat__shadow" aria-hidden="true" />
      <span className="pet-mode-cat__heart" aria-hidden="true">♥</span>
      <span className="pet-mode-cat__zzz" aria-hidden="true">z</span>
    </div>
  );
}

function isLifeMotionPhase(phase: PetModeCatPhase): phase is LifeMotionPhase {
  return phase === "stretch" || phase === "tail";
}

function PetModeExpression({ phase }: { readonly phase: PetModeCatPhase }) {
  const happy = phase === "happy";
  return (
    <svg className="pet-mode-cat__expression" viewBox="0 0 797 581" aria-hidden="true">
      <g className="pet-mode-cat__expression-face">
        {phase === "blink" ? (
          <>
            <g className="pet-mode-cat__eyes pet-mode-cat__eyes--blink">
              <ellipse className="pet-mode-cat__blink-eye" cx="581.3" cy="254.7" rx="11.8" ry="12.8" />
              <ellipse className="pet-mode-cat__blink-eye" cx="679.7" cy="244.1" rx="10" ry="12.4" />
            </g>
            <g className="pet-mode-cat__eyes pet-mode-cat__blink-lid">
              <path d="M569.5 254.5 Q581.3 258 593.1 254.5 M669.7 244 Q679.7 247.5 689.7 244" />
            </g>
          </>
        ) : happy ? (
          <g className="pet-mode-cat__eyes pet-mode-cat__eyes--happy">
            <path d="M570 259 Q581.3 240 593 259 M670 249 Q679.7 230 689.5 249" />
          </g>
        ) : (
          <g className="pet-mode-cat__eyes pet-mode-cat__eyes--open">
            <ellipse cx="581.3" cy="254.7" rx="11.8" ry="12.8" />
            <ellipse cx="679.7" cy="244.1" rx="10" ry="12.4" />
          </g>
        )}
        <path
          className="pet-mode-cat__expression-mouth"
          d="M616 263 Q616 279 626.5 280 Q634.5 280 636.2 263 Q638 280 646.5 280 Q656 279 656 261"
        />
      </g>
    </svg>
  );
}

function PetModeSleepPose() {
  return (
    <svg className="pet-mode-cat__vector pet-mode-cat__sleep-pose" viewBox="0 0 150 120" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.5 81.3c0-27.2 19.8-46.7 48.4-46.7h10c20.8 0 39.5 7.1 51.1 18.3 4.6-2.6 8.4-1.8 9.8 3.2 3.7 12.6 3.6 27.7-3.6 39.9-6.9 11.6-21.2 14-37.6 13.7-8.1-.1-11.8-1.8-18.9.9-7.3 2.8-17.6 1.5-25.4.9-21.2-1.7-33.8-11.9-33.8-30.2Z"
      />
      <g className="pet-mode-cat__face">
        <path d="M83.9 92.2 Q87.9 95.4 91.9 92.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M113.7 92.2 Q117.7 95.4 121.7 92.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M98.9 95.1 Q100.9 97.7 102.9 95.4 Q104.9 97.7 106.9 95.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export type { PetModeCatPhase };
