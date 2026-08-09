import { useEffect, useState, type CSSProperties } from "react";
import { captureSentryException } from "../../lib/observability/sentryClient";
import {
  getPetModeGaitFramesPerSecond,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DRAG_SETTLE_MS,
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
  | "release";

type WalkFramesFile = {
  readonly frames: readonly string[];
  readonly cycleSeconds: number;
};

const LIFE_MOTION_ASSET_BY_PHASE = {
  stretch: "stretch",
  tail: "tail",
} as const;
const DRAG_SCRUFF_ASSET = "/pet-mode/drag/scruff-b.png?v=gpt-image-20260805";

type LifeMotionPhase = keyof typeof LIFE_MOTION_ASSET_BY_PHASE;

export function PetModeCat({
  phase,
  facing,
  pawFrame,
}: {
  readonly phase: PetModeCatPhase;
  readonly facing: "left" | "right";
  readonly pawFrame: number;
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
      .catch((error: unknown) => {
        // A swallowed rejection here is invisible: the render falls back to a
        // single standing frame, so the cat crosses the screen with frozen
        // legs and nothing is logged anywhere. That shipped once already — a
        // production `connect-src` without `'self'` refused this very request
        // — so the failure has to stay audible even though it is non-fatal.
        //
        // Reported as well as logged: the console is not visible in a packaged
        // build, and this asset is static, so a failure means a policy or
        // packaging fault that no user will ever think to report as anything
        // more specific than "the cat looks broken".
        console.warn("[pet-mode] walk frames failed to load; gait will not animate", error);
        captureSentryException(error, { tags: { surface: "pet-mode", asset: "walk-frames" } });
      });
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
    const image = new Image();
    image.src = DRAG_SCRUFF_ASSET;
    void image.decode?.().catch(() => undefined);
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
  const dragMotionDurations = {
    "--pet-drag-pickup-duration": `${PET_MODE_DRAG_PICKUP_MS}ms`,
    "--pet-drag-release-duration": `${PET_MODE_DRAG_SETTLE_MS}ms`,
  } as CSSProperties;
  return (
    <div className={rootClass} aria-label="Drifty pet cat" data-phase={phase} style={dragMotionDurations}>
      <svg className="pet-mode-cat__filters" width="0" height="0" aria-hidden="true">
        {/* The baked frames are effectively two-tone: body pixels sit near
            luminance 226 and facial detail near 20, with only anti-aliasing in
            between. Recoloring happens in two steps.

            First `feColorMatrix` collapses RGB to a single luminance. The
            generated frames carry small per-channel drift (bodies land on
            232,229,217 in one frame and 231,225,212 in another), and a purely
            per-channel ramp preserves that drift, which showed up as the pet
            changing tone between phases. Flattening to luminance first makes
            every frame enter the ramp at the same value.

            Then the ramp maps ink to fur. It saturates at 225 so the entire
            body range resolves to exactly `--pet-fur`, which is what keeps the
            rasters and the walk/sleep vectors on one identical color.

            Table values carry a ~1e-6 bias. Exact ratios such as 217/255 land
            a hair below their target once evaluated in float (216.9999...),
            and the compositor truncates rather than rounds, so the rasters
            came out one 8-bit step darker than the vectors. The bias is far
            below a quantisation step, so it changes nothing except the side
            of the boundary the value falls on.

            Alpha is untouched throughout, so silhouettes and edges survive. */}
        {/* Ivory runs through the same ramp as every other coat. The generated
            frames carry small per-channel drift, so leaving the default
            unfiltered left the shipped cat rendering in four slightly
            different creams depending on the pose. This maps them all onto the
            canonical `--pet-fur`, at the cost of the default no longer being a
            byte-for-byte passthrough of the source bitmaps. */}
        <filter id="pet-mode-coat-ivory" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0      0      0      1 0"
          />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.09019708 0.09019708 0.09019708 0.15324384 0.21629059 0.27933735 0.34238411 0.40543086 0.46847762 0.53152438 0.59457114 0.65761789 0.72066465 0.78371141 0.84675816 0.90980492 0.90980492 0.90980492" />
            <feFuncG type="table" tableValues="0.09804022 0.09804022 0.09804022 0.15957868 0.22111714 0.28265560 0.34419406 0.40573252 0.46727098 0.52880945 0.59034791 0.65188637 0.71342483 0.77496329 0.83650175 0.89804022 0.89804022 0.89804022" />
            <feFuncB type="table" tableValues="0.08627551 0.08627551 0.08627551 0.14540070 0.20452589 0.26365108 0.32277626 0.38190145 0.44102664 0.50015183 0.55927702 0.61840221 0.67752740 0.73665258 0.79577777 0.85490296 0.85490296 0.85490296" />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
        <filter id="pet-mode-coat-charcoal" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0      0      0      1 0"
          />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.94902061 0.94902061 0.94902061 0.89140371 0.83378682 0.77616993 0.71855304 0.66093614 0.60331925 0.54570236 0.48808546 0.43046857 0.37285168 0.31523479 0.25761789 0.20000100 0.20000100 0.20000100" />
            <feFuncG type="table" tableValues="0.94509904 0.94509904 0.94509904 0.88778381 0.83046857 0.77315334 0.71583810 0.65852287 0.60120764 0.54389240 0.48657717 0.42926194 0.37194670 0.31463147 0.25731623 0.20000100 0.20000100 0.20000100" />
            <feFuncB type="table" tableValues="0.92941276 0.92941276 0.92941276 0.87209753 0.81478230 0.75746706 0.70015183 0.64283660 0.58552136 0.52820613 0.47089089 0.41357566 0.35626043 0.29894519 0.24162996 0.18431473 0.18431473 0.18431473" />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
        {/* Grey sits between the two extremes on purpose. Ivory needs a dark
            desktop and charcoal needs a light one, but a mid-tone coat clears
            roughly 2:1 against dark, light, and mid backdrops alike, so it is
            the only coat that never disappears when the wallpaper changes.
            Same two-step structure: flatten luminance, then ramp ink to fur. */}
        <filter id="pet-mode-coat-grey" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0      0      0      1 0"
          />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.10196178 0.10196178 0.10196178 0.14328908 0.18461638 0.22594368 0.26727098 0.30859829 0.34992559 0.39125289 0.43258019 0.47390749 0.51523479 0.55656209 0.59788939 0.63921669 0.63921669 0.63921669" />
            <feFuncG type="table" tableValues="0.10588335 0.10588335 0.10588335 0.14630568 0.18672800 0.22715032 0.26757264 0.30799497 0.34841729 0.38883961 0.42926194 0.46968426 0.51010658 0.55052890 0.59095123 0.63137355 0.63137355 0.63137355" />
            <feFuncB type="table" tableValues="0.09411865 0.09411865 0.09411865 0.13303267 0.17194670 0.21086073 0.24977476 0.28868878 0.32760281 0.36651684 0.40543086 0.44434489 0.48325892 0.52217295 0.56108697 0.60000100 0.60000100 0.60000100" />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
        {/* The three color coats keep chroma deliberately low. An earlier
            high-saturation attempt read as a costume rather than a cat, so
            these sit in the mid-chroma band: clearly colored, still calm
            enough for a pet meant to stay in the corner of the eye. */}
        <filter id="pet-mode-coat-apricot" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0      0      0      1 0"
          />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.23529512 0.23529512 0.23529512 0.28265560 0.33001608 0.37737657 0.42473705 0.47209753 0.51945801 0.56681850 0.61417898 0.66153946 0.70889994 0.75626043 0.80362091 0.85098139 0.85098139 0.85098139" />
            <feFuncG type="table" tableValues="0.16862845 0.16862845 0.16862845 0.20905077 0.24947310 0.28989542 0.33031774 0.37074006 0.41116239 0.45158471 0.49200703 0.53242936 0.57285168 0.61327400 0.65369632 0.69411865 0.69411865 0.69411865" />
            <feFuncB type="table" tableValues="0.10980492 0.10980492 0.10980492 0.14359074 0.17737657 0.21116239 0.24494821 0.27873403 0.31251985 0.34630568 0.38009150 0.41387732 0.44766314 0.48144896 0.51523479 0.54902061 0.54902061 0.54902061" />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
        <filter id="pet-mode-coat-sage" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0      0      0      1 0"
          />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.10980492 0.10980492 0.10980492 0.14570236 0.18159979 0.21749723 0.25339467 0.28929210 0.32518954 0.36108697 0.39698441 0.43288184 0.46877928 0.50467672 0.54057415 0.57647159 0.57647159 0.57647159" />
            <feFuncG type="table" tableValues="0.14117747 0.14117747 0.14117747 0.18099648 0.22081548 0.26063448 0.30045349 0.34027249 0.38009150 0.41991050 0.45972951 0.49954851 0.53936752 0.57918652 0.61900552 0.65882453 0.65882453 0.65882453" />
            <feFuncB type="table" tableValues="0.10196178 0.10196178 0.10196178 0.13695424 0.17194670 0.20693916 0.24193162 0.27692408 0.31191654 0.34690899 0.38190145 0.41689391 0.45188637 0.48687883 0.52187129 0.55686375 0.55686375 0.55686375" />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
        <filter id="pet-mode-coat-plum" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0.3333 0.3333 0.3333 0 0
                    0      0      0      1 0"
          />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.93725590 0.93725590 0.93725590 0.90196178 0.86666767 0.83137355 0.79607943 0.76078531 0.72549120 0.69019708 0.65490296 0.61960884 0.58431473 0.54902061 0.51372649 0.47843237 0.47843237 0.47843237" />
            <feFuncG type="table" tableValues="0.90196178 0.90196178 0.90196178 0.86123780 0.82051382 0.77978984 0.73906586 0.69834187 0.65761789 0.61689391 0.57616993 0.53544595 0.49472197 0.45399798 0.41327400 0.37255002 0.37255002 0.37255002" />
            <feFuncB type="table" tableValues="0.91764806 0.91764806 0.91764806 0.87933735 0.84102664 0.80271593 0.76440522 0.72609451 0.68778381 0.64947310 0.61116239 0.57285168 0.53454097 0.49623026 0.45791955 0.41960884 0.41960884 0.41960884" />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
      </svg>
      <div className="pet-mode-cat__motion">
        {phase === "paw" ? (
          <img
            className="pet-mode-cat__raster pet-mode-cat__raster--paw"
            src={`/pet-mode/paw/f${String(pawFrame + 1).padStart(3, "0")}.png`}
            alt=""
            draggable={false}
          />
        ) : phase === "drag" ? (
          <>
            <img
              className="pet-mode-cat__raster pet-mode-cat__drag-pending-idle"
              src="/pet-mode/paw/f001.png"
              alt=""
              draggable={false}
            />
            <img
              className="pet-mode-cat__raster pet-mode-cat__raster--drag pet-mode-cat__drag-pending-held"
              src={DRAG_SCRUFF_ASSET}
              alt=""
              draggable={false}
            />
          </>
        ) : phase === "release" ? (
          <>
            <img
              className="pet-mode-cat__raster pet-mode-cat__raster--drag pet-mode-cat__release-held"
              src={DRAG_SCRUFF_ASSET}
              alt=""
              draggable={false}
            />
            <img
              className="pet-mode-cat__raster pet-mode-cat__release-idle"
              src="/pet-mode/paw/f001.png"
              alt=""
              draggable={false}
            />
          </>
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
              {/* These eyes carried no `fill`, so they fell back to SVG's
                  default black. That happened to match the ivory cat's ink and
                  hid the bug, but it ignores `--pet-ink` and left black eyes on
                  a charcoal coat. Bind them to the token like every other
                  facial detail. */}
              <circle cx="120.4" cy="46.2" r="2.2" fill="currentColor" />
              <circle cx="140.3" cy="46.2" r="2.2" fill="currentColor" />
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
      <img
        className="pet-mode-cat__drag-preload"
        src={DRAG_SCRUFF_ASSET}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
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
