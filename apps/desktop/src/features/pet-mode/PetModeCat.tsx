import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { captureSentryException } from "../../lib/observability/sentryClient";
import {
  resolvePetModeEntryDurationMs,
  getPetModeGaitFrameIndex,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_ENTRY_DURATION_MS,
  PET_MODE_GAIT_BASELINE_SHIFT_PX,
  PET_MODE_GAIT_CENTER_SHIFT_PX,
  PET_MODE_GAIT_FRAME_COUNT,
  PET_MODE_LIFE_MOTION_FPS,
  PET_MODE_LIFE_MOTION_FRAME_COUNT,
  PET_MODE_PAW_CONTACT_FRAME,
  PET_MODE_RUN_FRAME_COUNT,
  PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS,
  getPetModeGaitFramesPerSecond,
  getPetModeRunFrameIndex,
} from "./petModeData";
import { publishPetModeHitRegion, stagePetModeHitRegionTransition } from "./petModeHitRegions";
import { PET_MODE_GAZE_BODY_MAX_PX, type PetModeGazeOffset } from "./petModeGaze";
import {
  PET_MODE_HEAD_CLIP_X,
  isPetModeChaseMotionKind,
  petModeChaseCycleMs,
  petModeChaseMotionStyle,
} from "./petModeChaseMotion";
import {
  resolvePetModeSitArtworkId,
  type PetModeSitArtworkId,
} from "./petModeSitVariant";
import { getPetModeRunFrameSource, PET_MODE_RUN_FRAME_SOURCES } from "./petModeRunFrames";

type PetModeCatPhase =
  | "idle"
  | "entry"
  | "walk"
  | "run"
  | "stalk"
  | "bite"
  | "return"
  | "notice"
  | "anger"
  | "paw"
  | "happy"
  | "drowsy"
  | "blink"
  | "stretch"
  | "tail"
  | "sleep"
  | "sit"
  | "drag"
  | "release";

type PetModeRestPose = "idle" | "sit";
type PetModeDriftCue = "none" | "sleep-notice" | "sleep-wake";

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
  fastRunBetaEnabled = false,
  entrySequence = 0,
  preserveEntryLanding = false,
  entryTravelDistance,
  entryDurationMs,
  sizeScale = 1,
  frameOverride,
  hitRegionInteractive = false,
  hitRegionCommitRevision = 0,
  gazeOffset = { x: 0, y: 0 },
  publishHitRegion = true,
  decorative = false,
  playfulPaw = false,
  huntAlertVisible = false,
  huntAlertDurationMs = 480,
  dragPickupPose = "idle",
  dragReleasePose = "idle",
  proudWalk = false,
  drowsyWalk = false,
  musicNoteVisible = false,
  quietNotice = false,
  devForceLiveBlink = false,
  driftCue = "none",
  sleepDriftExpression = false,
}: {
  readonly phase: PetModeCatPhase;
  readonly facing: "left" | "right";
  readonly pawFrame: number;
  readonly fastRunBetaEnabled?: boolean;
  readonly entrySequence?: number;
  readonly preserveEntryLanding?: boolean;
  readonly entryTravelDistance?: number;
  readonly entryDurationMs?: number;
  readonly sizeScale?: number;
  readonly frameOverride?: number;
  readonly hitRegionInteractive?: boolean;
  readonly hitRegionCommitRevision?: number;
  readonly gazeOffset?: PetModeGazeOffset;
  readonly publishHitRegion?: boolean;
  readonly decorative?: boolean;
  readonly playfulPaw?: boolean;
  readonly huntAlertVisible?: boolean;
  readonly huntAlertDurationMs?: number;
  readonly dragPickupPose?: PetModeRestPose;
  readonly dragReleasePose?: PetModeRestPose;
  /** Wears the E04 lids while walking home after closing Drifty's window. */
  readonly proudWalk?: boolean;
  /** Heavy half-closed lids while a woken cat walks off a control it was covering. */
  readonly drowsyWalk?: boolean;
  /** Shows the reviewed one-shot good-mood note without replacing the body pose. */
  readonly musicNoteVisible?: boolean;
  /** Hides the drift-notice bang when the same pose is reused as a drop greeting. */
  readonly quietNotice?: boolean;
  /** Deterministic Dev/QA capture hook; production callers leave this false. */
  readonly devForceLiveBlink?: boolean;
  /** Sleep-only drift reaction drawn from the existing vector artwork. */
  readonly driftCue?: PetModeDriftCue;
  /** Holds the annoyed sleeping eyelids for the active drift reaction. */
  readonly sleepDriftExpression?: boolean;
}) {
  const [walkFrames, setWalkFrames] = useState<readonly string[]>([]);
  const [walkFrame, setWalkFrame] = useState(0);
  const walkFrameRef = useRef(0);
  const [runFrame, setRunFrame] = useState(0);
  const [runFramesFailed, setRunFramesFailed] = useState(false);
  const [runFramesReady, setRunFramesReady] = useState(false);
  const [lifeMotionFrame, setLifeMotionFrame] = useState(0);
  const renderedEntrySequenceRef = useRef<number | null>(null);
  const selectedSitVariantId = resolvePetModeSitArtworkId();
  const selectedSitVariant = PET_MODE_SIT_VARIANTS[selectedSitVariantId];
  // The stylesheet already stops secondary CSS animations under reduced
  // motion. The authored run is frame-driven, so its renderer clock needs the
  // same preference explicitly and holds the approved first frame instead.
  const reducedMotion = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const usesRunRaster = phase === "run"
    && fastRunBetaEnabled
    && (decorative || runFramesReady)
    && !runFramesFailed;
  const runUsesVectorFallback = phase === "run" && !usesRunRaster;

  useEffect(() => {
    if (decorative) return;
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
  }, [decorative]);

  useEffect(() => {
    if (decorative || !fastRunBetaEnabled) {
      setRunFramesReady(false);
      return;
    }
    let active = true;
    setRunFramesFailed(false);
    setRunFramesReady(false);
    const images = PET_MODE_RUN_FRAME_SOURCES.map((source) => {
      const image = new Image();
      image.src = source;
      return image;
    });
    void Promise.all(images.map((image) => image.decode?.() ?? Promise.resolve()))
      .then(() => {
        if (active) setRunFramesReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRunFramesFailed(true);
        console.warn("[pet-mode] run frames failed to preload; falling back to vector gait", error);
        captureSentryException(error, { tags: { surface: "pet-mode", asset: "run-frames" } });
      });
    return () => { active = false; };
  }, [decorative, fastRunBetaEnabled]);

  useEffect(() => {
    if (decorative || selectedSitVariant.kind === "vector") return;
    const sources = selectedSitVariant.kind === "live-raster"
      ? [selectedSitVariant.neutralSource, selectedSitVariant.source, selectedSitVariant.eyeSource]
      : [selectedSitVariant.source];
    const images = sources.map((source) => {
      const image = new Image();
      image.src = source;
      return image;
    });
    void Promise.all(images.map((image) => image.decode?.() ?? Promise.resolve()))
      .catch((error: unknown) => {
        console.warn("[pet-mode] sit artwork failed to preload", error);
        captureSentryException(error, { tags: { surface: "pet-mode", asset: "sit-artwork" } });
      });
  }, [decorative, selectedSitVariant, selectedSitVariantId]);

  useEffect(() => {
    if (decorative) return;
    for (const motion of Object.values(LIFE_MOTION_ASSET_BY_PHASE)) {
      for (let frame = 1; frame <= PET_MODE_LIFE_MOTION_FRAME_COUNT; frame += 1) {
        const image = new Image();
        image.src = `/pet-mode/life-motion/${motion}/f${String(frame).padStart(3, "0")}.png`;
        void image.decode?.().catch(() => undefined);
      }
    }
  }, [decorative]);

  useEffect(() => {
    if (decorative) return;
    // The F12 frames are deliberately high-resolution source crops. Decode the
    // whole reviewed range before it can be requested by an intervention so a
    // src swap never produces a white/transparent decode flash mid-reach.
    for (let frame = 1; frame <= PET_MODE_PAW_CONTACT_FRAME + 1; frame += 1) {
      const image = new Image();
      image.src = `/pet-mode/paw/f${String(frame).padStart(3, "0")}.png`;
      void image.decode?.().catch(() => undefined);
    }
  }, [decorative]);

  useEffect(() => {
    if (decorative) return;
    // Drag feedback has to be available on the very first grab. Waiting for
    // the phase swap to request this bitmap creates a one-frame empty pet while
    // the native window has already started following the pointer.
    const image = new Image();
    image.src = DRAG_SCRUFF_ASSET;
    void image.decode?.().catch(() => undefined);
  }, [decorative]);

  useEffect(() => {
    const moving = phase === "entry"
      || phase === "walk"
      || runUsesVectorFallback
      || phase === "stalk"
      || phase === "return";
    if (!moving || walkFrames.length === 0) return undefined;
    // Native emits `motion: entry` before its one-frame WebView handoff, and
    // entrySequence restarts this renderer clock on that event. Both sides then
    // use the same duration and distance-based travel progress; the final frame
    // clamp absorbs the remaining compositor-frame skew before `entry_complete`.
    const motion = phase === "run"
      ? "run"
      : phase === "return"
        ? "return"
        : phase === "stalk"
          ? "stalk"
          : phase === "walk"
            ? "walk"
            : "entry";
    const resolvedEntryDurationMs = resolvePetModeEntryDurationMs(
      entryTravelDistance,
      entryDurationMs,
    );
    // Entry is synchronized to native's own travel clock. Later motion phases
    // continue from the silhouette already on screen so stalk -> bite ->
    // return never snaps back to the first gait drawing.
    const startingFrame = motion === "entry" ? 0 : walkFrameRef.current;
    if (motion === "entry") {
      walkFrameRef.current = 0;
      setWalkFrame(0);
    }
    const startedAt = performance.now();
    let displayedFrame = startingFrame;
    let animationFrameId = 0;
    let stagingReleaseFrameId = 0;
    let stagingFrame = false;
    let disposed = false;
    const render = (now: number) => {
      // The prototype advances gait in its requestAnimationFrame loop. Do the
      // same here: at run speed it may skip source indices, but it never queues
      // several full-silhouette React updates between display refreshes.
      const timelineFrame = getPetModeGaitFrameIndex(
        motion,
        now - startedAt,
        walkFrames.length,
        motion === "entry"
          ? {
            travelDistance: entryTravelDistance,
            durationMs: resolvedEntryDurationMs,
            sizeScale,
          }
          : undefined,
      );
      const nextFrame = motion === "entry"
        ? timelineFrame
        : (startingFrame + timelineFrame) % walkFrames.length;
      if (nextFrame !== displayedFrame && !stagingFrame) {
        const commitFrame = () => {
          if (disposed) return;
          displayedFrame = nextFrame;
          walkFrameRef.current = nextFrame;
          setWalkFrame(nextFrame);
          stagingReleaseFrameId = window.requestAnimationFrame(() => {
            stagingFrame = false;
          });
        };
        if (hitRegionInteractive) {
          stagingFrame = true;
          void stagePetModeHitRegionTransition({
            regionId: `transition:gait:${nextFrame}`,
            mirrored: facing === "left",
          }).then(commitFrame, () => {
            if (disposed) return;
            stagingReleaseFrameId = window.requestAnimationFrame(() => {
              stagingFrame = false;
            });
          });
        } else {
          commitFrame();
        }
      }
      animationFrameId = window.requestAnimationFrame(render);
    };
    animationFrameId = window.requestAnimationFrame(render);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameId);
      window.cancelAnimationFrame(stagingReleaseFrameId);
    };
  }, [entryDurationMs, entrySequence, entryTravelDistance, facing, fastRunBetaEnabled, hitRegionInteractive, phase, runFramesFailed, runFramesReady, sizeScale, walkFrames.length]);

  useEffect(() => {
    if (
      phase !== "run"
      || !fastRunBetaEnabled
      || !runFramesReady
      || runFramesFailed
      || frameOverride !== undefined
      || reducedMotion
    ) {
      if (phase === "run") setRunFrame(0);
      return undefined;
    }
    setRunFrame(0);
    const startedAt = performance.now();
    let displayedFrame = 0;
    let animationFrameId = 0;
    let stagingReleaseFrameId = 0;
    let stagingFrame = false;
    let disposed = false;
    const render = (now: number) => {
      const nextFrame = getPetModeRunFrameIndex(now - startedAt);
      if (nextFrame !== displayedFrame && !stagingFrame) {
        const commitFrame = () => {
          if (disposed) return;
          displayedFrame = nextFrame;
          setRunFrame(nextFrame);
          stagingReleaseFrameId = window.requestAnimationFrame(() => {
            stagingFrame = false;
          });
        };
        if (hitRegionInteractive) {
          stagingFrame = true;
          void stagePetModeHitRegionTransition({
            regionId: `transition:run-gait:${nextFrame}`,
            mirrored: facing === "left",
          }).then(commitFrame, () => {
            if (disposed) return;
            stagingReleaseFrameId = window.requestAnimationFrame(() => {
              stagingFrame = false;
            });
          });
        } else {
          commitFrame();
        }
      }
      animationFrameId = window.requestAnimationFrame(render);
    };
    animationFrameId = window.requestAnimationFrame(render);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameId);
      window.cancelAnimationFrame(stagingReleaseFrameId);
    };
  }, [facing, fastRunBetaEnabled, frameOverride, hitRegionInteractive, phase, reducedMotion, runFramesFailed, runFramesReady]);

  useEffect(() => {
    if (!isLifeMotionPhase(phase)) return undefined;
    setLifeMotionFrame(0);
    const startedAt = performance.now();
    let displayedFrame = 0;
    let animationFrameId = 0;
    let stagingReleaseFrameId = 0;
    let stagingFrame = false;
    let disposed = false;
    const render = (now: number) => {
      const nextFrame = Math.min(
        PET_MODE_LIFE_MOTION_FRAME_COUNT - 1,
        Math.floor((now - startedAt) * PET_MODE_LIFE_MOTION_FPS / 1000),
      );
      if (nextFrame !== displayedFrame && !stagingFrame) {
        const commitFrame = () => {
          if (disposed) return;
          displayedFrame = nextFrame;
          setLifeMotionFrame(nextFrame);
          stagingReleaseFrameId = window.requestAnimationFrame(() => {
            stagingFrame = false;
          });
        };
        if (hitRegionInteractive) {
          stagingFrame = true;
          void stagePetModeHitRegionTransition({
            regionId: `transition:${phase}:${nextFrame}`,
            mirrored: facing === "left",
          }).then(commitFrame, () => {
            if (disposed) return;
            stagingReleaseFrameId = window.requestAnimationFrame(() => {
              stagingFrame = false;
            });
          });
        } else {
          commitFrame();
        }
      }
      if (nextFrame < PET_MODE_LIFE_MOTION_FRAME_COUNT - 1) {
        animationFrameId = window.requestAnimationFrame(render);
      }
    };
    animationFrameId = window.requestAnimationFrame(render);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameId);
      window.cancelAnimationFrame(stagingReleaseFrameId);
    };
  }, [facing, hitRegionInteractive, phase]);

  const mirrored = facing === "left";
  const registerWalkVector = useCallback((node: SVGSVGElement | null) => {
    if (node && phase === "entry") renderedEntrySequenceRef.current = entrySequence;
  }, [entrySequence, phase]);
  // Only hold a vector that was actually painted during this entry. On a cold
  // asset load, completing on the raster and swapping to the vector later is
  // a second, visible landing transition.
  const holdsRenderedEntryVector = phase === "idle"
    && preserveEntryLanding
    && walkFrames.length > 0
    && renderedEntrySequenceRef.current === entrySequence;
  const sitVariant = phase === "sit" ? selectedSitVariant : null;
  const usesSourceLockedSit = sitVariant?.kind === "reference-raster";
  const usesLiveD = selectedSitVariant.kind === "live-raster";
  const hasLiveDSitGaze = phase === "sit" && usesLiveD && (gazeOffset.x !== 0 || gazeOffset.y !== 0);
  const hasLiveDNeutralSit = phase === "sit" && usesLiveD && !hasLiveDSitGaze;
  const rootClass = `pet-mode-cat pet-mode-cat--${phase}${mirrored ? " is-mirrored" : ""}${drowsyWalk ? " is-sleepwalking" : ""}${holdsRenderedEntryVector ? " is-entry-landed" : ""}${usesSourceLockedSit ? " is-source-locked-sit" : ""}${hasLiveDNeutralSit ? " is-d-live-neutral" : ""}${hasLiveDSitGaze ? " is-d-live-gazing" : ""}${playfulPaw ? " is-playful-paw" : ""}${huntAlertVisible ? " has-hunt-alert" : ""}${musicNoteVisible ? " has-music-note" : ""}${quietNotice ? " is-quiet-notice" : ""}${sleepDriftExpression || driftCue !== "none" ? " has-sleep-drift-expression" : ""}${driftCue !== "none" ? ` has-sleep-drift-cue is-${driftCue}` : ""}`;
  const usesSeparatedFace = phase === "blink"
    || phase === "happy"
    || phase === "drowsy";
  const usesIdleGaze = (phase === "idle" || phase === "blink" || phase === "happy")
    && !holdsRenderedEntryVector;
  const usesNoticeGaze = phase === "notice";
  const lifeMotionAsset = isLifeMotionPhase(phase)
    ? LIFE_MOTION_ASSET_BY_PHASE[phase]
    : null;
  const chaseMotionPhase = isPetModeChaseMotionKind(phase)
    && (phase !== "run" || runUsesVectorFallback)
    ? phase
    : null;
  const motionGeometry = {
    "--pet-drag-pickup-duration": `${PET_MODE_DRAG_PICKUP_MS}ms`,
    "--pet-drag-release-duration": `${PET_MODE_DRAG_SETTLE_MS}ms`,
    "--pet-entry-duration": `${entryDurationMs ?? PET_MODE_ENTRY_DURATION_MS}ms`,
    "--pet-hunt-alert-duration": `${huntAlertDurationMs}ms`,
    "--pet-anger-duration": `${PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS}ms`,
    "--pet-gait-baseline-shift": `${PET_MODE_GAIT_BASELINE_SHIFT_PX}px`,
    "--pet-gait-center-shift": `${PET_MODE_GAIT_CENTER_SHIFT_PX}px`,
    "--pet-gaze-x": `${gazeOffset.x.toFixed(2)}px`,
    "--pet-gaze-y": `${gazeOffset.y.toFixed(2)}px`,
    "--pet-gaze-body-x": `${(gazeOffset.x * (PET_MODE_GAZE_BODY_MAX_PX / 1.52)).toFixed(2)}px`,
    "--pet-gaze-body-y": `${(gazeOffset.y * ((PET_MODE_GAZE_BODY_MAX_PX * 0.35) / (1.52 * 0.78))).toFixed(2)}px`,
    ...petModeChaseMotionStyle(
      chaseMotionPhase,
      {
        // Share the leg cycle's duration so the body drops on the frames where
        // a diagonal pair actually lands. A free-running body clock drifts
        // against the legs and the cat ends up bouncing while airborne.
        cycleMs: chaseMotionPhase && chaseMotionPhase !== "bite"
          ? petModeChaseCycleMs(
            getPetModeGaitFramesPerSecond(chaseMotionPhase),
            PET_MODE_GAIT_FRAME_COUNT,
          )
          : 0,
        // The return leg carries the cursor back the way the cat came, so it
        // travels against its facing and has to lean the other way.
        direction: phase === "return" ? -1 : 1,
        reducedMotion,
      },
    ),
  } as CSSProperties;
  const renderedWalkFrame = frameOverride ?? walkFrame;
  const runFrameCandidate = frameOverride ?? runFrame;
  const requestedRunFrame = Number.isFinite(runFrameCandidate) ? runFrameCandidate : 0;
  const renderedRunFrame = (
    (Math.trunc(requestedRunFrame) % PET_MODE_RUN_FRAME_COUNT) + PET_MODE_RUN_FRAME_COUNT
  ) % PET_MODE_RUN_FRAME_COUNT;
  const renderedLifeMotionFrame = frameOverride ?? lifeMotionFrame;
  const walkFramePath = walkFrames[renderedWalkFrame];
  const runFramePath = getPetModeRunFrameSource(renderedRunFrame);
  // The head is drawn a second time on top of the complete body rather than
  // cut out of it. The silhouette has no waist to seam on - a scanline sweep
  // falls monotonically from 94 units at x=100 to 17 at the muzzle - so the
  // overlap itself is the seam. Both layers are the same flat fur colour and
  // the clip starts deep inside the shoulder, so body pixels cover the join
  // whichever way the head turns and no gap can open. That is what makes this
  // safe where AP-06's rotated limb was not: nothing is added or redrawn.
  const walkVectorBody = (
    <>
      <defs>
        {/* Clipped in viewBox units, well behind the neck pivot at x=104, so
            the rotated copy always carries a wide band of shoulder with it. */}
        <clipPath id="pet-mode-head-clip">
          <rect x={PET_MODE_HEAD_CLIP_X} y="0" width={150 - PET_MODE_HEAD_CLIP_X} height="120" />
        </clipPath>
      </defs>
      <g className="pet-mode-cat__body-motion">
        <path d={walkFramePath} fill="currentColor" />
        <g className="pet-mode-cat__head-motion" clipPath="url(#pet-mode-head-clip)">
          <path d={walkFramePath} fill="currentColor" />
          <PetModeWalkFace
            biting={phase === "bite" || phase === "return"}
            gazing={gazeOffset.x !== 0 || gazeOffset.y !== 0}
            proud={proudWalk}
            drowsy={drowsyWalk}
          />
        </g>
      </g>
    </>
  );
  const regionId = usesRunRaster
    ? `run-gait:${renderedRunFrame}`
    : holdsRenderedEntryVector || phase === "entry" || phase === "walk" || phase === "run" || phase === "stalk" || phase === "bite" || phase === "return"
    ? (walkFrames.length > 0 ? `gait:${renderedWalkFrame}` : "idle")
    : phase === "paw"
      ? `paw:${pawFrame}`
      : phase === "stretch" || phase === "tail"
        ? `${phase}:${renderedLifeMotionFrame}`
        : phase === "happy"
          ? "happy"
          : phase === "drowsy"
            ? "drowsy"
          : phase === "drag"
            ? `drag:${dragPickupPose}${usesLiveD && dragPickupPose === "sit" ? ":d-lifted-tail-live" : ""}`
            : phase === "release"
              ? `release:${dragReleasePose}${usesLiveD && dragReleasePose === "sit" ? ":d-lifted-tail-live" : ""}`
              : phase === "sit"
                ? `sit${usesLiveD ? ":d-lifted-tail-live" : ""}`
                : phase === "sleep"
                  ? phase
                : "idle";

  useLayoutEffect(() => {
    if (decorative || !publishHitRegion) return;
    // Publish from the component that owns the rendered frame. Parent/child
    // layout-effect ordering otherwise lets a parent briefly publish the prior
    // frame id during the same commit.
    void publishPetModeHitRegion({
      regionId,
      mirrored,
      interactive: hitRegionInteractive,
    });
  }, [decorative, hitRegionCommitRevision, hitRegionInteractive, mirrored, publishHitRegion, regionId]);

  return (
    <div className={rootClass} aria-hidden={decorative ? true : undefined} aria-label={decorative ? undefined : "Drifty pet cat"} data-phase={phase} data-region-id={regionId} data-sit-artwork={selectedSitVariantId} style={motionGeometry}>
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
            <span className="pet-mode-cat__drag-pending-rest">
              <PetModeRestPoseArtwork pose={dragPickupPose} sitVariantId={selectedSitVariantId} gazeOffset={gazeOffset} reducedMotion={reducedMotion} devForceLiveBlink={devForceLiveBlink} />
            </span>
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
            <span className="pet-mode-cat__release-rest">
              <PetModeRestPoseArtwork pose={dragReleasePose} sitVariantId={selectedSitVariantId} gazeOffset={gazeOffset} reducedMotion={reducedMotion} devForceLiveBlink={devForceLiveBlink} />
            </span>
          </>
        ) : lifeMotionAsset ? (
          <img
            className="pet-mode-cat__raster pet-mode-cat__raster--life-motion"
            src={`/pet-mode/life-motion/${lifeMotionAsset}/f${String(renderedLifeMotionFrame + 1).padStart(3, "0")}.png`}
            alt=""
            draggable={false}
          />
        ) : phase === "sleep" ? (
          <PetModeSleepPose irritated={sleepDriftExpression || driftCue !== "none"} />
        ) : phase === "sit" ? (
          <PetModeSitPose sitVariantId={selectedSitVariantId} gazeOffset={gazeOffset} reducedMotion={reducedMotion} devForceLiveBlink={devForceLiveBlink} />
        ) : usesRunRaster ? (
          <img
            className="pet-mode-cat__raster pet-mode-cat__raster--run"
            src={runFramePath}
            alt=""
            draggable={false}
          />
        ) : holdsRenderedEntryVector ? (
          <svg
            ref={registerWalkVector}
            className="pet-mode-cat__vector pet-mode-cat__landed-vector"
            viewBox="0 0 150 120"
            aria-hidden="true"
          >
            {walkVectorBody}
          </svg>
        ) : (phase === "entry" || phase === "walk" || phase === "run" || phase === "stalk" || phase === "bite" || phase === "return") && walkFrames.length > 0 ? (
          <svg ref={registerWalkVector} className="pet-mode-cat__vector" viewBox="0 0 150 120" aria-hidden="true">
            {walkVectorBody}
          </svg>
        ) : usesIdleGaze || usesNoticeGaze ? (
          <>
            <img className="pet-mode-cat__raster" src="/pet-mode/gaze/idle-no-pupils.png" alt="" draggable={false} />
            <span className="pet-mode-cat__idle-pupils" aria-hidden="true">
              <img className="pet-mode-cat__pupil pet-mode-cat__pupil--left" src="/pet-mode/gaze/pupil-L.png" alt="" draggable={false} />
              <img className="pet-mode-cat__pupil pet-mode-cat__pupil--right" src="/pet-mode/gaze/pupil-R.png" alt="" draggable={false} />
            </span>
          </>
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
      <span className="pet-mode-cat__alert" aria-hidden="true">!</span>
      {/* V06 Music note: traced from the approved review-board vector. It is
          independent of phase so the original stretch/tail artwork stays
          untouched underneath the rare accent. */}
      <svg className="pet-mode-cat__music-note" viewBox="0 0 797 581" aria-hidden="true">
        <g className="pet-mode-cat__music-note-glyph">
          <ellipse cx="732" cy="159" rx="17" ry="14" transform="rotate(-18 732 159)" />
          <path d="M747 154 V111 L777 120" />
        </g>
      </svg>
      {/* The anger mark is a traced comic vein cluster, not a glyph, so it
          cannot ride the text-based marks above. It shares their placement and
          dark halo but needs its own drawn geometry. */}
      <svg className="pet-mode-cat__anger" viewBox="0 0 797 581" aria-hidden="true">
        <g className="pet-mode-cat__anger-glyph">
          <path d="M736.8 103.4 L737.2 103.6 L741.4 111.5 L743.8 115.1 L746.1 117.5 L749.5 119.8 L751.2 120.4 L754.7 120.4 L758.3 119.2 L763.1 116.6 L770.2 110.8 L775.5 116.8 L775.5 117.2 L767.8 123.4 L764.8 125.3 L760.4 127.3 L754.7 128.7 L751.2 128.7 L746.4 127.5 L743.3 125.8 L740.8 123.9 L736.8 119.6 L733.6 114.7 L729.7 107.2 L736.8 103.4 Z M716.3 113.2 L722.3 120.6 L726.1 127.2 L727.4 131.1 L728.0 134.4 L727.6 139.6 L725.7 144.5 L724.0 147.0 L721.0 150.2 L715.3 154.3 L706.5 159.0 L702.7 151.6 L710.2 147.7 L714.2 145.1 L717.8 141.5 L719.1 139.2 L719.7 137.3 L719.5 133.4 L717.5 128.3 L713.9 123.0 L710.1 118.7 L711.0 117.5 L716.3 113.2 Z M781.4 130.6 L781.7 130.6 L785.3 138.0 L778.3 141.5 L773.8 144.5 L770.8 147.3 L769.5 149.2 L768.5 151.5 L768.3 154.9 L769.8 159.8 L773.2 165.2 L777.9 170.9 L777.0 172.1 L771.7 176.4 L765.5 168.6 L761.7 161.9 L760.6 158.3 L760.0 154.5 L760.6 149.2 L761.4 147.0 L763.3 143.5 L767.2 139.2 L773.2 134.9 L781.4 130.6 Z M732.7 160.9 L737.4 160.9 L740.6 161.7 L743.3 162.8 L746.8 165.2 L749.9 168.3 L752.3 171.5 L758.3 182.2 L751.0 186.2 L747.6 179.6 L743.6 173.8 L740.6 170.9 L737.0 169.2 L733.0 169.2 L728.7 170.7 L724.4 173.3 L717.8 178.8 L712.5 172.6 L716.6 168.8 L722.9 164.5 L727.6 162.3 L732.7 160.9 Z" />
        </g>
      </svg>
    </div>
  );
}

function PetModeRestPoseArtwork({
  pose,
  sitVariantId,
  gazeOffset,
  reducedMotion = false,
  devForceLiveBlink = false,
}: {
  readonly pose: PetModeRestPose;
  readonly sitVariantId: PetModeSitArtworkId;
  readonly gazeOffset: PetModeGazeOffset;
  readonly reducedMotion?: boolean;
  readonly devForceLiveBlink?: boolean;
}) {
  if (pose === "sit") return <PetModeSitPose sitVariantId={sitVariantId} gazeOffset={gazeOffset} reducedMotion={reducedMotion} devForceLiveBlink={devForceLiveBlink} />;
  return (
    <img
      className="pet-mode-cat__raster"
      src="/pet-mode/paw/f001.png"
      alt=""
      draggable={false}
    />
  );
}

function isLifeMotionPhase(phase: PetModeCatPhase): phase is LifeMotionPhase {
  return phase === "stretch" || phase === "tail";
}

function PetModeExpression({ phase }: { readonly phase: PetModeCatPhase }) {
  const happy = phase === "happy";
  const drowsy = phase === "drowsy";
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
        ) : drowsy ? (
          <g className="pet-mode-cat__eyes pet-mode-cat__eyes--drowsy">
            <path d="M570 248 Q581.3 262 593 248 M670 238 Q679.7 252 689.5 238" />
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

const PET_MODE_SIT_FACE_TRANSFORM = "translate(-12.84 -0.3)";

/* ── Sit-pose variant registry (R0.12 character-bible artwork) ──────────────────
   Live D is the reviewed production sit. The former shipped vector remains an
   explicit fallback, while D/E/B reference frames stay available in the Dev
   lab as source-locked raster cutouts. This is deliberate: a
   traced SVG necessarily changes the source antialiasing and tiny silhouette
   decisions, while these assets reproduce the reviewed frame pixel-for-pixel
   when composited on its reference background. */

interface PetModeSitVectorVariant {
  readonly kind: "vector";
  readonly label: string;
  readonly bodyPath: string;
  readonly faceTransform: string;
}

interface PetModeSitReferenceRasterVariant {
  readonly kind: "reference-raster";
  readonly label: string;
  /** Exact R0.12 frame, with only its #11110f canvas made transparent. */
  readonly source: string;
  /** Original-canvas baseline aligned to the shipped sit pose's feet. */
  readonly baselineOffsetY: number;
}

interface PetModeSitLiveRasterVariant {
  readonly kind: "live-raster";
  readonly label: string;
  /** Approved complete D frame; live rendering applies the shared coat ramp. */
  readonly neutralSource: string;
  /** Source-derived body without eye pixels for gaze and blink states. */
  readonly source: string;
  /** Approved-source open eyes, independently movable for live gaze and blink. */
  readonly eyeSource: string;
  readonly baselineOffsetY: number;
  /** Eye midpoint measured on D's 150 × 120 display coordinate system. */
  readonly gazeAnchor: { readonly x: number; readonly y: number };
  /** D's face has less safe eye travel than the shipped vector face. */
  readonly gazeScale: number;
}

type PetModeSitVariant = PetModeSitVectorVariant | PetModeSitReferenceRasterVariant | PetModeSitLiveRasterVariant;

const PET_MODE_SIT_VARIANTS: Record<PetModeSitArtworkId, PetModeSitVariant> = {
  shipped: {
    kind: "vector",
    label: "Shipped vector",
    bodyPath:
      "M93.3 19.0C94.0 19.3 95.9 19.6 97.2 20.8C98.5 22.0 99.9 24.8 101.1 26.1C102.3 27.5 103.1 28.3 104.3 28.7C105.5 29.0 106.5 29.5 108.2 28.2C110.0 26.9 113.0 22.2 114.6 20.8C116.3 19.5 117.2 20.3 118.1 20.4C119.0 20.4 117.6 18.0 119.7 21.1C121.8 24.2 128.0 34.2 130.3 38.5C132.6 42.9 132.7 43.7 133.3 46.8C133.8 49.9 134.1 53.8 133.7 56.9C133.3 60.0 132.1 62.8 131.0 65.0C129.8 67.2 129.1 67.8 126.8 69.8C124.6 71.7 119.6 74.5 117.6 76.5C115.7 78.4 116.1 77.6 115.3 81.1C114.6 84.5 113.3 92.4 113.0 96.9C112.8 101.4 113.8 105.1 113.7 107.5C113.6 109.8 113.3 109.8 112.3 110.7C111.4 111.6 109.5 112.3 108.2 112.5C106.9 112.8 105.6 112.5 104.5 112.1C103.5 111.7 102.7 111.1 102.0 110.2C101.3 109.3 100.4 106.8 100.4 106.8C100.4 106.8 99.5 109.4 99.0 110.2C98.5 111.1 98.3 111.2 97.6 111.6C96.9 112.0 95.9 112.4 94.9 112.5C93.9 112.7 92.9 112.7 91.9 112.5C90.9 112.4 90.1 112.5 89.1 111.6C88.2 110.8 86.1 107.5 86.1 107.5C86.1 107.5 85.7 109.6 85.0 110.5C84.3 111.3 85.5 112.1 82.0 112.5C78.5 113.0 69.4 113.2 64.5 113.0C59.7 112.8 56.3 112.1 53.5 111.4C50.7 110.6 51.0 109.2 48.0 108.6C44.9 108.0 38.9 108.5 35.6 107.9C32.3 107.4 30.7 106.5 28.7 105.6C26.7 104.7 25.5 104.1 23.9 102.7C22.2 101.2 20.1 99.0 18.8 96.9C17.5 94.8 16.7 92.5 16.3 90.2C15.8 88.0 15.9 85.5 16.0 83.6C16.2 81.7 16.7 80.5 17.4 79.2C18.1 78.0 18.9 76.9 20.2 76.2C21.4 75.6 23.6 75.5 24.8 75.5C25.9 75.6 26.2 76.1 26.9 76.7C27.5 77.3 28.2 77.7 28.5 79.2C28.7 80.7 28.0 83.5 28.2 85.4C28.5 87.3 28.9 89.0 30.1 90.5C31.2 91.9 33.1 93.1 34.9 93.9C36.7 94.7 39.5 96.8 40.4 95.1C41.3 93.4 40.1 86.7 40.2 84.0C40.3 81.4 40.3 81.8 40.9 79.7C41.5 77.5 42.6 73.8 43.6 71.4C44.7 69.0 45.6 67.5 47.1 65.4C48.6 63.4 50.9 61.0 52.6 59.4C54.3 57.9 55.2 57.3 57.2 56.2C59.2 55.1 61.6 54.0 64.3 53.0C67.0 52.1 70.8 51.7 73.0 50.7C75.3 49.8 75.3 51.6 77.4 47.5C79.6 43.4 83.7 31.3 85.7 26.8C87.7 22.4 88.2 22.5 89.1 21.3C90.0 20.1 90.3 20.0 91.0 19.7C91.6 19.3 92.7 19.3 93.0 19.2C93.4 19.1 92.6 18.7 93.3 19.0Z",
    faceTransform: PET_MODE_SIT_FACE_TRANSFORM,
  },
  "d-lifted-tail-live": {
    kind: "live-raster",
    label: "D — Lifted Tail (live)",
    neutralSource: "/pet-mode/sit-reference/d-lifted-tail-live.png",
    source: "/pet-mode/sit-reference/d-lifted-tail-live-no-eyes.png",
    eyeSource: "/pet-mode/sit-reference/d-lifted-tail-eyes.png",
    baselineOffsetY: 3,
    gazeAnchor: { x: 126.75 / 150, y: 44.625 / 120 },
    gazeScale: 0.4,
  },
  "d-lifted-tail": {
    kind: "reference-raster",
    label: "D — Lifted Tail (exact reference)",
    source: "/pet-mode/sit-reference/d-lifted-tail.png",
    baselineOffsetY: 3,
  },
  "e-clean-front": {
    kind: "reference-raster",
    label: "E — Clean Front (exact reference)",
    source: "/pet-mode/sit-reference/e-clean-front.png",
    baselineOffsetY: 4.8,
  },
  "b-low-rise": {
    kind: "reference-raster",
    label: "B — Low Rise (exact reference)",
    source: "/pet-mode/sit-reference/b-low-rise.png",
    baselineOffsetY: 7.3,
  },
};

/** The live-D raster does not share the former vector fallback's face placement. */
function resolvePetModeSitGazeAnchor(): { readonly x: number; readonly y: number } | undefined {
  const variant = PET_MODE_SIT_VARIANTS[resolvePetModeSitArtworkId()];
  return variant.kind === "live-raster" ? variant.gazeAnchor : undefined;
}

function PetModeWalkFace({
  transform,
  animatedBlink = false,
  gazing = false,
  biting = false,
  proud = false,
  drowsy = false,
}: {
  readonly transform?: string;
  readonly animatedBlink?: boolean;
  readonly gazing?: boolean;
  readonly biting?: boolean;
  readonly proud?: boolean;
  readonly drowsy?: boolean;
}) {
  return (
    <g className="pet-mode-cat__face" transform={transform}>
      {/* Keep one canonical copy of the shipped walk face. The sitting pose
          translates this entire group without redrawing or rescaling it. */}
      {drowsy ? (
        /* Sleepwalk: the same drowsy lids the petting sequence shows before
           sleep (PetModeExpression's eyes--drowsy), scaled from the 797-wide
           expression face to the walk face so the cat wakes with the eyes the
           user already knows. */
        <path
          className="pet-mode-cat__walk-eyes--drowsy"
          d="M118.3 45.0 Q120.4 47.6 122.5 45.0 M138.2 45.0 Q140.3 47.6 142.4 45.0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : proud ? (
        /* E04: the lids curve down over the eyes. Quiet satisfaction reads as
           the opposite arc of an excited smile, which is why the walk-away at
           the end of a session uses this instead of the happy face. */
        <path
          className="pet-mode-cat__walk-eyes--proud"
          d="M117.8 45.0 Q120.4 48.8 123.0 45.0 M137.7 45.0 Q140.3 48.8 142.9 45.0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : (
      <g className={gazing ? "pet-mode-cat__vector-eyes--gaze" : undefined}>
        <circle className={`${animatedBlink ? "pet-mode-cat__sit-eye-open" : ""}${gazing ? " pet-mode-cat__vector-eye--gaze" : ""}`.trim() || undefined} cx="120.4" cy="46.2" r="2.2" fill="currentColor" />
        <circle className={`${animatedBlink ? "pet-mode-cat__sit-eye-open" : ""}${gazing ? " pet-mode-cat__vector-eye--gaze" : ""}`.trim() || undefined} cx="140.3" cy="46.2" r="2.2" fill="currentColor" />
      </g>
      )}
      {animatedBlink && !proud && !drowsy ? (
        <path
          className="pet-mode-cat__sit-eye-closed"
          d="M117.8 46.2 Q120.4 48.6 123 46.2 M137.7 46.2 Q140.3 48.6 142.9 46.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : null}
      <path
        className={biting ? "pet-mode-cat__walk-mouth pet-mode-cat__walk-mouth--bite" : "pet-mode-cat__walk-mouth"}
        d="M127.6 50.2 Q129.6 52.8 131.6 50.5 Q133.6 52.8 135.7 50.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </g>
  );
}

function PetModeSitPose({
  sitVariantId,
  gazeOffset,
  reducedMotion = false,
  devForceLiveBlink = false,
}: {
  readonly sitVariantId: PetModeSitArtworkId;
  readonly gazeOffset: PetModeGazeOffset;
  readonly reducedMotion?: boolean;
  readonly devForceLiveBlink?: boolean;
}) {
  const variant = PET_MODE_SIT_VARIANTS[sitVariantId];
  const liveVariant = variant.kind === "live-raster";
  const [liveBlinking, setLiveBlinking] = useState(false);

  useEffect(() => {
    if (!liveVariant || reducedMotion) {
      setLiveBlinking(false);
      return undefined;
    }

    let closeTimer: number | undefined;
    let repeatBlink: number | undefined;
    const startBlink = () => {
      setLiveBlinking(true);
      closeTimer = window.setTimeout(() => setLiveBlinking(false), 180);
    };
    const firstBlink = window.setTimeout(() => {
      startBlink();
      repeatBlink = window.setInterval(startBlink, 6_400);
    }, 6_100);

    return () => {
      window.clearTimeout(firstBlink);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
      if (repeatBlink !== undefined) window.clearInterval(repeatBlink);
    };
  }, [liveVariant, reducedMotion]);

  if (variant.kind === "reference-raster") {
    return (
      <img
        className="pet-mode-cat__raster pet-mode-cat__sit-pose pet-mode-cat__sit-reference"
        src={variant.source}
        alt=""
        draggable={false}
        style={{ "--pet-sit-reference-offset-y": `${variant.baselineOffsetY}px` } as CSSProperties}
      />
    );
  }

  if (variant.kind === "live-raster") {
    const gazing = gazeOffset.x !== 0 || gazeOffset.y !== 0;
    const blinking = devForceLiveBlink || liveBlinking;
    const usesLiveLayers = gazing || blinking;
    const liveEyeStyle = {
      "--pet-d-live-gaze-x": `${(gazeOffset.x * variant.gazeScale).toFixed(2)}px`,
      "--pet-d-live-gaze-y": `${(gazeOffset.y * variant.gazeScale).toFixed(2)}px`,
      "--pet-sit-reference-offset-y": `${variant.baselineOffsetY}px`,
    } as CSSProperties;
    return (
      <>
        <img
          className={`pet-mode-cat__raster pet-mode-cat__sit-pose pet-mode-cat__sit-live pet-mode-cat__d-live-neutral${usesLiveLayers ? " is-hidden" : ""}`}
          src={variant.neutralSource}
          alt=""
          draggable={false}
          style={{ "--pet-sit-reference-offset-y": `${variant.baselineOffsetY}px` } as CSSProperties}
        />
        <img
          className={`pet-mode-cat__raster pet-mode-cat__sit-pose pet-mode-cat__sit-live pet-mode-cat__d-live-body${usesLiveLayers ? " is-visible" : ""}`}
          src={variant.source}
          alt=""
          draggable={false}
          style={{ "--pet-sit-reference-offset-y": `${variant.baselineOffsetY}px` } as CSSProperties}
        />
        {/* The open eyes are extracted from the approved D still. The complete
            neutral bitmap carries the approved geometry through the same coat
            pipeline as every standing frame; the separated layers are exposed
            only for gaze and blink. */}
        <span className={`pet-mode-cat__d-live-eyes${gazing ? " pet-mode-cat__vector-eye--gaze" : ""}${blinking ? " is-blinking" : ""}${usesLiveLayers ? " is-visible" : ""}`} aria-hidden="true" style={liveEyeStyle}>
          <img className="pet-mode-cat__d-live-eyes-art" src={variant.eyeSource} alt="" draggable={false} />
          <span className="pet-mode-cat__d-live-blink-eye pet-mode-cat__d-live-blink-eye--rear">
            <img className="pet-mode-cat__d-live-eyes-art" src={variant.eyeSource} alt="" draggable={false} />
          </span>
          <span className="pet-mode-cat__d-live-blink-eye pet-mode-cat__d-live-blink-eye--front">
            <img className="pet-mode-cat__d-live-eyes-art" src={variant.eyeSource} alt="" draggable={false} />
          </span>
        </span>
      </>
    );
  }

  const gazing = gazeOffset.x !== 0 || gazeOffset.y !== 0;
  return (
    <svg className="pet-mode-cat__vector pet-mode-cat__sit-pose" viewBox="0 0 150 120" aria-hidden="true" style={{ "--pet-gaze-x": `${gazeOffset.x.toFixed(2)}px`, "--pet-gaze-y": `${gazeOffset.y.toFixed(2)}px` } as CSSProperties}>
      <path fill="currentColor" d={variant.bodyPath} />
      <PetModeWalkFace transform={variant.faceTransform} animatedBlink gazing={gazing} />
    </svg>
  );
}

function PetModeSleepPose({ irritated = false }: { readonly irritated?: boolean }) {
  return (
    <svg className="pet-mode-cat__vector pet-mode-cat__sleep-pose" viewBox="0 0 150 120" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.5 81.3c0-27.2 19.8-46.7 48.4-46.7h10c20.8 0 39.5 7.1 51.1 18.3 4.6-2.6 8.4-1.8 9.8 3.2 3.7 12.6 3.6 27.7-3.6 39.9-6.9 11.6-21.2 14-37.6 13.7-8.1-.1-11.8-1.8-18.9.9-7.3 2.8-17.6 1.5-25.4.9-21.2-1.7-33.8-11.9-33.8-30.2Z"
      />
      <g className="pet-mode-cat__face">
        <path className="pet-mode-cat__sleep-eye pet-mode-cat__sleep-eye--closed-front" d="M83.9 92.2 Q87.9 95.4 91.9 92.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        {irritated ? (
          <g className="pet-mode-cat__sleep-eyes--squint">
            <path
              d="M84.8 91.7 Q88.2 94.1 91.4 93.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M114.6 93.4 Q117.8 94.1 121.2 91.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </g>
        ) : null}
        <path className="pet-mode-cat__sleep-eye pet-mode-cat__sleep-eye--closed-rear" d="M113.7 92.2 Q117.7 95.4 121.7 92.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M98.9 95.1 Q100.9 97.7 102.9 95.4 Q104.9 97.7 106.9 95.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export {
  resolvePetModeSitGazeAnchor,
};
export type { PetModeCatPhase, PetModeDriftCue, PetModeRestPose };
