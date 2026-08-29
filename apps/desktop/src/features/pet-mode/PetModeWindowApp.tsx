import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { triggerNativeEndOfDayReviewAction } from "../companion/watcherBridge";
import { PetModeCat, type PetModeCatPhase, type PetModeRestPose } from "./PetModeCat";
import {
  alignNativePetContact,
  beginNativePetDrag,
  cancelNativePetMotion,
  exitNativePetScreen,
  listenToNativePetDragEnd,
  listenToNativePetDragProbe,
  listenToNativePetDragStart,
  listenToNativePetModeEvent,
  listenToNativePetModeLabStateRequest,
  moveNativePetToTarget,
  rememberNativePetPosition,
  resolveNativePetDrop,
  type PetDropPlan,
  type PetModeNativeDragResult,
  reportNativePetContact,
  reportNativePetDragError,
  reportNativePetModeLabState,
  reportNativePetPointer,
  returnNativePetFromOuting,
  returnNativePetHome,
  roamNativePet,
  sampleNativePetCursor,
  setNativePetPresence,
  stalkNativePetCursor,
  returnWithNativePetCursor,
  triggerNativePetVisibilityAction,
} from "./petModeBridge";
import { openNativePetModeMenu } from "./petModeNativeMenu";
import { preloadPetModeHitRegions, stagePetModeHitRegionTransition } from "./petModeHitRegions";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";
import {
  PET_MODE_AWAY_MS,
  PET_MODE_BLINK_DURATION_MS,
  PET_MODE_BLINK_INTERVAL_MAX_MS,
  PET_MODE_BLINK_INTERVAL_MIN_MS,
  PET_MODE_COAT_STORAGE_KEY,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DROP_LIFE_PREVIEW_STORAGE_KEY,
  PET_MODE_SHAKE_FLOOR_DROP_STORAGE_KEY,
  PET_MODE_ENTRY_FALLBACK_GRACE_MS,
  getPetModeDefaultEntryTravelDistance,
  getPetModeWindowSize,
  resolvePetModeEntryDurationMs,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_MUSIC_NOTE_DURATION_MS,
  PET_MODE_EXPERIMENTS_STORAGE_KEY,
  PET_MODE_PET_STREAK_TO_SLEEP,
  PET_MODE_PET_STREAK_WINDOW_MS,
  PET_MODE_POST_DROP_LOOK_DURATION_MS,
  PET_MODE_PAW_CONTACT_FRAME,
  PET_MODE_PAW_FPS,
  PET_MODE_PAW_TIMELINE,
  PET_MODE_PRESENT_MS,
  PET_MODE_STORAGE_KEY,
  PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
  PET_MODE_SIZE_STORAGE_KEY,
  PET_MODE_GUIDES_STORAGE_KEY,
  PET_MODE_SIT_MAX_MS,
  PET_MODE_SIT_MIN_MS,
  PET_MODE_SLEEP_MAX_MS,
  PET_MODE_SLEEP_MIN_MS,
  PET_MODE_SLEEP_WAKE_ANGER_CHANCE,
  PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS,
  PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  getPetModeNextActionInterval,
  pickPetModeLifeAction,
  pickPetModePostDropReaction,
  resolveInitialPetModeCoat,
  resolveInitialPetModeHiddenUntil,
  resolveInitialPetModeSize,
  resolvePetModePresent,
  shouldShowPetModeMusicNote,
  type PetModeInterventionTarget,
  type PetModeLabAction,
  type PetModeLifeAction,
  type PetModePostDropReaction,
  type PetModePreviewAction,
  type PetModeSnapshot,
  type PetModeCoat,
  type PetModeSize,
} from "./petModeData";
import {
  PET_MODE_GAZE_SAMPLE_MS,
  dampPetModeGazeOffset,
  petModeGazePoseForPhase,
  resolvePetModeGazeOffset,
  type PetModeGazeOffset,
} from "./petModeGaze";
import { isPetModeChaseMotionKind } from "./petModeChaseMotion";
import {
  EMPTY_PET_MODE_DRIFT_HUNT_STATE,
  PET_MODE_DRIFT_HUNT_ALERT_MS,
  PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY,
  PET_MODE_DRIFT_NOTICE_MS,
  PET_MODE_DRIFT_STALK_SETTLE_MS,
  advancePetModeDriftHunt,
  resolvePetModeDriftHuntSettings,
  type PetModeDriftHuntSettings,
  type PetModeDriftHuntState,
} from "./petModeDriftHunt";
import "./petMode.css";

const LAB_LIFE_ACTIONS = ["walk", "stretch", "tail_flick"] as const;
type LifeAction = Exclude<PetModePreviewAction, "cursor_hunt_single" | "cursor_hunt_chase">;

function expressiveInteractionsEnabled(): boolean {
  return window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1"
    && window.localStorage.getItem(PET_MODE_EXPERIMENTS_STORAGE_KEY) === "1";
}

function dropLifePreviewEnabled(): boolean {
  return window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1"
    && window.localStorage.getItem(PET_MODE_DROP_LIFE_PREVIEW_STORAGE_KEY) === "1";
}

function shakeFloorDropEnabled(): boolean {
  return window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1"
    && window.localStorage.getItem(PET_MODE_SHAKE_FLOOR_DROP_STORAGE_KEY) === "1";
}

function guaranteedOutcomesEnabled(): boolean {
  return expressiveInteractionsEnabled()
    && window.localStorage.getItem(PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY) === "1";
}

export function PetModeWindowApp() {
  // The native window is created hidden and normally has time to mount before
  // the main app restores the persisted setting. Starting in the matching pose
  // also covers the cold-start race where the native entry event arrives before
  // this webview listener is attached.
  const [initialAppearance] = useState(() => {
    const reducedMotion = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const enabled = resolvePetModePresent();
    const entersOnLaunch = enabled && !reducedMotion;
    return {
      enabled,
      phase: entersOnLaunch ? "entry" as const : "idle" as const,
      facing: entersOnLaunch ? "left" as const : "right" as const,
    };
  });
  const initialPhase: PetModeCatPhase = initialAppearance.phase;
  const [phase, setPhase] = useState<PetModeCatPhase>(initialPhase);
  const [dragPickupPose, setDragPickupPose] = useState<PetModeRestPose>("idle");
  const [dragReleasePose, setDragReleasePose] = useState<PetModeRestPose>("idle");
  const [facing, setFacing] = useState<"left" | "right">(initialAppearance.facing);
  const [entrySequence, setEntrySequence] = useState(0);
  const [entryTravelDistance, setEntryTravelDistance] = useState<number | undefined>(undefined);
  const [entryDurationMs, setEntryDurationMs] = useState(() => {
    const { width } = getPetModeWindowSize(resolveInitialPetModeSize());
    return resolvePetModeEntryDurationMs(getPetModeDefaultEntryTravelDistance(width));
  });
  const [petModeSize, setPetModeSize] = useState(resolveInitialPetModeSize);
  const [preserveEntryLanding, setPreserveEntryLanding] = useState(false);
  const [petModeEnabled, setPetModeEnabled] = useState(initialAppearance.enabled);
  const [petVisible, setPetVisible] = useState(true);
  const [hitRegionTransitionCount, setHitRegionTransitionCount] = useState(0);
  const [hitRegionCommitRevision, setHitRegionCommitRevision] = useState(0);
  const [autonomousCycle, setAutonomousCycle] = useState(0);
  const [dropLifePreviewRevision, setDropLifePreviewRevision] = useState(0);
  const [pawFrame, setPawFrame] = useState(0);
  // Only the return from a successful Drifty-window close wears the proud
  // lids; every approach and every other walk keeps the shipped neutral face.
  const [proudWalk, setProudWalk] = useState(false);
  const [musicNoteVisible, setMusicNoteVisible] = useState(false);
  const [snapshot, setSnapshot] = useState<PetModeSnapshot | null>(null);
  const [labLifeLoopEnabled, setLabLifeLoopEnabled] = useState(false);
  const [dragProbe, setDragProbe] = useState<PetDropPlan | null>(null);
  // A right-click menu is anchored to the cat's current position, so the cat
  // has to stand still for as long as the menu is up.
  const [menuHolding, setMenuHolding] = useState(false);
  const [gazeOffset, setGazeOffset] = useState<PetModeGazeOffset>({ x: 0, y: 0 });
  const [manualGazeActive, setManualGazeActive] = useState(false);
  const [huntAlertVisible, setHuntAlertVisible] = useState(false);
  const [huntAlertDurationMs, setHuntAlertDurationMs] = useState(PET_MODE_DRIFT_HUNT_ALERT_MS);
  const [guidesEnabled, setGuidesEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(PET_MODE_GUIDES_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const actionTokenRef = useRef(0);
  const musicNoteTimerRef = useRef<number | null>(null);
  const phaseRef = useRef<PetModeCatPhase>(initialPhase);
  const renderedPhaseRef = useRef<PetModeCatPhase>(initialPhase);
  const facingRef = useRef<"left" | "right">(initialAppearance.facing);
  const renderedFacingRef = useRef<"left" | "right">(initialAppearance.facing);
  const poseTransitionRef = useRef(0);
  const facingTransitionRef = useRef(0);
  const activeLabActionRef = useRef<PetModeLabAction | null>(null);
  const activeLabActionRevisionRef = useRef(0);
  // `intervention` is also used by product-triggered nudges. This separate bit
  // lets focus preserve deliberate Lab previews without allowing an automatic
  // nudge to retain motion ownership.
  const automaticInterventionRef = useRef(false);
  const menuOpenRef = useRef(false);
  const labLifeLoopEnabledRef = useRef(false);
  const petModeEnabledRef = useRef(initialAppearance.enabled);
  const autonomousCycleRef = useRef(0);
  // This tracks temporary outing visibility, not the product toggle. Feature
  // enablement has its own ref so Lab previews can still reveal the panel.
  const visibleRef = useRef(true);
  const sleepTouchRef = useRef(0);
  // Consecutive pets and when the last one landed, for the settle-to-sleep run.
  const petStreakRef = useRef(0);
  const lastPetAtRef = useRef(0);
  // The previous autonomous action is the scheduler's short-term context.
  // `null` means the pet has not completed an autonomous action yet.
  const previousAutonomousActionRef = useRef<PetModeLifeAction | null>(null);
  const manualDragRef = useRef(false);
  const manualReleaseTokenRef = useRef<number | null>(null);
  const manualDropReactionRef = useRef<PetModePostDropReaction | null>(null);
  const previousPostDropReactionRef = useRef<PetModePostDropReaction | null>(null);
  const dragReleasePoseRef = useRef<PetModeRestPose>("idle");
  const hitTargetRef = useRef<HTMLButtonElement | null>(null);
  const contactAnchorRef = useRef<HTMLSpanElement | null>(null);
  const gazeEngagedRef = useRef(false);
  const focusRestingRef = useRef(false);
  const focusRestAppliedRef = useRef(false);
  const driftHuntRef = useRef<PetModeDriftHuntState>(EMPTY_PET_MODE_DRIFT_HUNT_STATE);
  const huntAlertTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (huntAlertTimerRef.current !== null) window.clearTimeout(huntAlertTimerRef.current);
  }, []);

  const playMusicNote = useCallback(() => {
    if (musicNoteTimerRef.current !== null) {
      window.clearTimeout(musicNoteTimerRef.current);
    }
    setMusicNoteVisible(true);
    musicNoteTimerRef.current = window.setTimeout(() => {
      musicNoteTimerRef.current = null;
      setMusicNoteVisible(false);
    }, PET_MODE_MUSIC_NOTE_DURATION_MS);
  }, []);

  const stopMusicNote = useCallback(() => {
    if (musicNoteTimerRef.current !== null) {
      window.clearTimeout(musicNoteTimerRef.current);
      musicNoteTimerRef.current = null;
    }
    setMusicNoteVisible(false);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== null
        && event.key !== DEV_MODE_STORAGE_KEY
        && event.key !== PET_MODE_EXPERIMENTS_STORAGE_KEY
      ) return;
      if (expressiveInteractionsEnabled()) return;
      petStreakRef.current = 0;
      lastPetAtRef.current = 0;
      setProudWalk(false);
      stopMusicNote();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [stopMusicNote]);

  useEffect(() => () => {
    if (musicNoteTimerRef.current !== null) {
      window.clearTimeout(musicNoteTimerRef.current);
    }
  }, []);

  const reportLabState = useCallback((nextPhase = phaseRef.current) => {
    void reportNativePetModeLabState({
      phase: nextPhase,
      activeAction: activeLabActionRef.current,
      lifeLoopEnabled: labLifeLoopEnabledRef.current,
      facing: facingRef.current,
    }).catch(() => undefined);
  }, []);

  const beginHitRegionTransition = useCallback(() => {
    setHitRegionTransitionCount((count) => count + 1);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      setHitRegionTransitionCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const commitPhase = useCallback((nextPhase: PetModeCatPhase) => {
    phaseRef.current = nextPhase;
    reportLabState(nextPhase);
    const transition = ++poseTransitionRef.current;
    const commit = () => {
      if (transition === poseTransitionRef.current && phaseRef.current === nextPhase) {
        renderedPhaseRef.current = nextPhase;
        setPhase(nextPhase);
        setHitRegionCommitRevision((revision) => revision + 1);
      }
    };
    const reject = () => {
      if (transition !== poseTransitionRef.current || phaseRef.current !== nextPhase) return;
      phaseRef.current = renderedPhaseRef.current;
      reportLabState(renderedPhaseRef.current);
    };
    if (!petModeEnabledRef.current || !visibleRef.current) {
      commit();
      return;
    }
    const finishTransition = beginHitRegionTransition();
    void stagePetModeHitRegionTransition({
      regionId: `transition:${nextPhase}`,
      mirrored: facingRef.current === "left",
    }).then(commit, reject).finally(finishTransition);
  }, [beginHitRegionTransition, reportLabState]);

  const commitFacing = useCallback((nextFacing: "left" | "right") => {
    facingRef.current = nextFacing;
    const transition = ++facingTransitionRef.current;
    const commit = () => {
      if (transition === facingTransitionRef.current && facingRef.current === nextFacing) {
        renderedFacingRef.current = nextFacing;
        setFacing(nextFacing);
        setHitRegionCommitRevision((revision) => revision + 1);
        reportLabState();
      }
    };
    const reject = () => {
      if (transition !== facingTransitionRef.current || facingRef.current !== nextFacing) return;
      facingRef.current = renderedFacingRef.current;
      reportLabState();
    };
    if (!petModeEnabledRef.current || !visibleRef.current) {
      commit();
      return;
    }
    const finishTransition = beginHitRegionTransition();
    void stagePetModeHitRegionTransition({
      regionId: `transition:facing:${nextFacing}`,
      mirrored: nextFacing === "left",
    }).then(commit, reject).finally(finishTransition);
  }, [beginHitRegionTransition, reportLabState]);

  const commitVisibility = useCallback((visible: boolean) => {
    visibleRef.current = visible;
    setPetVisible(visible);
  }, []);

  useEffect(() => {
    if (phase !== "idle" && phase !== "entry") setPreserveEntryLanding(false);
  }, [phase]);

  const setActiveLabAction = useCallback((action: PetModeLabAction | null) => {
    const revision = ++activeLabActionRevisionRef.current;
    activeLabActionRef.current = action;
    reportLabState();
    return revision;
  }, [reportLabState]);

  const clearActiveLabAction = useCallback((revision: number) => {
    if (activeLabActionRevisionRef.current !== revision) return;
    activeLabActionRevisionRef.current += 1;
    activeLabActionRef.current = null;
    reportLabState();
  }, [reportLabState]);

  const setLifeLoopEnabled = useCallback((enabled: boolean) => {
    labLifeLoopEnabledRef.current = enabled;
    setLabLifeLoopEnabled(enabled);
    reportLabState();
  }, [reportLabState]);

  const restartAutonomousCycle = useCallback(() => {
    // Show Pet begins a new residence period. Invalidate callbacks from the
    // previous on/off cycle synchronously, then let both autonomous schedulers
    // arm their full intervals from this boundary.
    previousAutonomousActionRef.current = null;
    const nextCycle = autonomousCycleRef.current + 1;
    autonomousCycleRef.current = nextCycle;
    setAutonomousCycle(nextCycle);
  }, []);

  const updateDragReleasePose = useCallback((nextPose: PetModeRestPose) => {
    dragReleasePoseRef.current = nextPose;
    setDragReleasePose(nextPose);
  }, []);

  const finishManualDrag = useCallback((result?: PetModeNativeDragResult, rememberPosition = true) => {
    if (
      !manualDragRef.current
      && phaseRef.current !== "drag"
    ) return;
    manualDragRef.current = false;
    setDragProbe(null);
    const releaseToken = ++actionTokenRef.current;
    manualReleaseTokenRef.current = releaseToken;
    const previewEnabled = dropLifePreviewEnabled();
    const reducedMotion = prefersReducedMotion();
    const forceFloorDrop = !reducedMotion
      && result?.shakeDetected === true
      && shakeFloorDropEnabled();
    const reaction = previewEnabled && !reducedMotion
      ? pickPetModePostDropReaction(Math.random(), previousPostDropReactionRef.current)
      : "stay";
    manualDropReactionRef.current = previewEnabled ? reaction : null;
    // Shipped focus drops keep the current held-to-sit handoff. In the preview,
    // the two expressive branches land on four paws first, play once, then use
    // the focus-derived resting pose again.
    const releasePose: PetModeRestPose = focusRestingRef.current && reaction === "stay"
      ? "sit"
      : "idle";
    dragReleasePoseRef.current = releasePose;

    void (async () => {
      try {
        if (!reducedMotion) {
          flushSync(() => {
            updateDragReleasePose(releasePose);
            commitPhase("release");
          });
          // Native may settle immediately (hop) or animate to a nearby ledge
          // (catch). Keep the visual handoff alive for at least its authored
          // duration, while never holding its last frame after native is done.
          await Promise.all([
            resolveNativePetDrop(forceFloorDrop).catch(() => null),
            delay(PET_MODE_DRAG_SETTLE_MS),
          ]);
          if (releaseToken !== actionTokenRef.current) return;
        }

        if (releaseToken !== actionTokenRef.current) return;
        if (!previewEnabled) {
          // The preview-off branch deliberately mirrors the shipped release
          // path: settle into the focus-derived rest pose, save placement in
          // the background, and do not re-arm unrelated autonomous clocks.
          const finalPose = dragReleasePoseRef.current;
          focusRestAppliedRef.current = finalPose === "sit";
          commitPhase(finalPose);
          if (rememberPosition) {
            void rememberNativePetPosition().catch((error) => {
              void reportNativePetDragError(error).catch(() => undefined);
            });
          }
          return;
        }
        commitPhase(dragReleasePoseRef.current);
        if (rememberPosition) {
          // Capture the user's chosen home before a reaction walk changes the
          // native panel position. The rest pose is already painted, so waiting
          // for this bookkeeping cannot strand the held/release silhouette.
          await rememberNativePetPosition().catch((error) => {
            void reportNativePetDragError(error).catch(() => undefined);
          });
        }
        if (releaseToken !== actionTokenRef.current) return;
        // Only a reaction that reached its settled starting pose participates
        // in the next-drop repeat guard. A cancelled fall was never seen.
        previousPostDropReactionRef.current = reaction;

        if (reaction === "walk") {
          focusRestAppliedRef.current = false;
          commitPhase("walk");
          await roamNativePet(true);
        } else if (reaction === "look_tail") {
          focusRestAppliedRef.current = false;
          const sample = await sampleNativePetCursor();
          if (releaseToken !== actionTokenRef.current) return;
          if (sample?.visible) {
            commitFacing(sample.cursorX < sample.windowX + sample.windowWidth / 2 ? "left" : "right");
          }
          setManualGazeActive(true);
          commitPhase("notice");
          await delay(PET_MODE_POST_DROP_LOOK_DURATION_MS);
          if (releaseToken !== actionTokenRef.current) return;
          setManualGazeActive(false);
          commitPhase("tail");
          await delay(PET_MODE_TAIL_FLICK_DURATION_MS);
        }

        if (releaseToken !== actionTokenRef.current) return;
        setManualGazeActive(false);
        const finalPose: PetModeRestPose = focusRestingRef.current ? "sit" : "idle";
        focusRestAppliedRef.current = finalPose === "sit";
        commitPhase(finalPose);
        // A direct-manipulation reaction is a complete life beat. Re-arm both
        // autonomous clocks here so another large action cannot stack at once.
        restartAutonomousCycle();
      } catch (error) {
        void reportNativePetDragError(error).catch(() => undefined);
        if (releaseToken === actionTokenRef.current) {
          setManualGazeActive(false);
          const finalPose: PetModeRestPose = focusRestingRef.current ? "sit" : "idle";
          focusRestAppliedRef.current = finalPose === "sit";
          commitPhase(finalPose);
          restartAutonomousCycle();
        }
      } finally {
        if (manualReleaseTokenRef.current === releaseToken) {
          setManualGazeActive(false);
          manualReleaseTokenRef.current = null;
          manualDropReactionRef.current = null;
        }
      }
    })();
  }, [commitFacing, commitPhase, restartAutonomousCycle, updateDragReleasePose]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== null
        && event.key !== DEV_MODE_STORAGE_KEY
        && event.key !== PET_MODE_DROP_LIFE_PREVIEW_STORAGE_KEY
      ) return;
      if (!dropLifePreviewEnabled()) previousPostDropReactionRef.current = null;
      setDropLifePreviewRevision((revision) => revision + 1);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetDragProbe((probe) => {
      if (disposed) return;
      setDragProbe(probe);
    }).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetDragStart(() => {
      if (!manualDragRef.current || phaseRef.current === "drag") return;
      sleepTouchRef.current = 0;
      const pickupPose: PetModeRestPose = phaseRef.current === "sit" ? "sit" : "idle";
      flushSync(() => {
        setDragPickupPose(pickupPose);
        commitPhase("drag");
      });
    }).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [commitPhase]);

  useEffect(() => {
    document.documentElement.dataset.surface = "pet-mode";
    return () => { delete document.documentElement.dataset.surface; };
  }, []);

  // The native panel remains mounted while Show Pet is off. Without mirroring
  // the persisted toggle here, its autonomous timers keep aging behind the
  // hidden window and can send the cat straight back out when it next enters.
  // A one-hour hide is the same situation wearing a different key, so it rides
  // this path too rather than only suppressing the panel from the main window.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== null
        && event.key !== PET_MODE_STORAGE_KEY
        && event.key !== PET_MODE_HIDDEN_UNTIL_STORAGE_KEY
      ) return;
      // Storage events carry the value from the transition that queued them.
      // Re-reading localStorage here can collapse a queued Off -> On pair into
      // one final `true`, leaving an old outing token alive long enough to hide
      // the newly shown cat. Hidden-until changes still use the combined helper.
      const enabled = event.key === PET_MODE_STORAGE_KEY && event.newValue !== null
        ? event.newValue === "1" && resolveInitialPetModeHiddenUntil() === null
        : resolvePetModePresent();
      if (enabled === petModeEnabledRef.current) return;

      petModeEnabledRef.current = enabled;
      commitVisibility(enabled);
      actionTokenRef.current += 1;
      sleepTouchRef.current = 0;
      restartAutonomousCycle();
      setPetModeEnabled(enabled);
      if (!enabled) {
        setPreserveEntryLanding(false);
        setProudWalk(false);
        commitPhase("idle");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [commitPhase, commitVisibility, restartAutonomousCycle]);

  // The pet runs in its own webview, so it cannot read the settings hook that
  // owns the toggle. Both webviews share localStorage, and `storage` fires in
  // every *other* document, which is exactly the cross-window direction needed
  // here. Applying the coat as a `data-` attribute means the swap is a pure
  // style recalculation: no remount, no `src` change, no animation restart.
  useEffect(() => {
    const applyCoat = (coat: PetModeCoat) => {
      document.documentElement.dataset.petCoat = coat;
    };
    applyCoat(resolveInitialPetModeCoat());
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PET_MODE_COAT_STORAGE_KEY) return;
      applyCoat(resolveInitialPetModeCoat());
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      delete document.documentElement.dataset.petCoat;
    };
  }, []);

  // Size arrives the same way the coat does. The webview only scales its own
  // drawing; the main window owns resizing the native panel, so both sides
  // read the same stored value rather than messaging each other.
  useEffect(() => {
    const applySize = (size: PetModeSize) => {
      document.documentElement.style.setProperty("--pet-size-scale", String(size / 100));
      setPetModeSize(size);
    };
    applySize(resolveInitialPetModeSize());
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PET_MODE_SIZE_STORAGE_KEY) return;
      applySize(resolveInitialPetModeSize());
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      document.documentElement.style.removeProperty("--pet-size-scale");
    };
  }, []);

  // Cursor hunt is owned by the Dev settings webview. Turning it off is a
  // hard safety boundary, not merely a policy for the next drift episode, so
  // the pet webview must cancel any stalk/carry already in flight.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== null
        && event.key !== PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY
        && event.key !== DEV_MODE_STORAGE_KEY
      ) return;
      if (
        event.key === DEV_MODE_STORAGE_KEY
        && window.localStorage.getItem(DEV_MODE_STORAGE_KEY) !== "1"
      ) stopMusicNote();
      if (resolvePetModeDriftHuntSettings().enabled) return;
      actionTokenRef.current += 1;
      void cancelNativePetMotion().catch(() => undefined);
      setActiveLabAction(null);
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [commitPhase, setActiveLabAction, stopMusicNote]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    reportLabState();
    void listenToNativePetModeLabStateRequest(reportLabState).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [reportLabState]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetDragEnd((result) => {
      if (!result.moved) return;
      // The native tracker is the authority for mouse-up. Depending only on
      // the invoke promise can leave WebKit in `drag` after the native loop has
      // already released, especially when the panel crosses app/display
      // boundaries. The event arrives directly from that loop's completion.
      finishManualDrag(result);
    }).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [finishManualDrag]);

  useEffect(() => {
    void preloadPetModeHitRegions().catch(() => undefined);
  }, []);

  const revealForAction = useCallback(async () => {
    if (visibleRef.current) return;
    commitVisibility(true);
    await setNativePetPresence(true);
  }, [commitVisibility]);

  const playIntervention = useCallback(async (target: PetModeInterventionTarget) => {
    const token = ++actionTokenRef.current;
    let movedToTarget = false;
    let contacted = false;

    try {
      if (target.labTarget === "browser_tab_x" || target.labTarget === "drifty_window_x") {
        // A direct Lab target owns the pet immediately. Stop any native walk
        // before AX target discovery so the old action cannot keep travelling
        // while its X target is being resolved.
        stopMusicNote();
        await cancelNativePetMotion().catch(() => undefined);
        if (token !== actionTokenRef.current) return;
      }
      await revealForAction();
      if (token !== actionTokenRef.current) return;
      commitPhase("run");
      const resolved = await moveNativePetToTarget(target);
      if (token !== actionTokenRef.current) return;
      if (resolved.targetKind === "fallback" && !target.preview) {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
        await reportNativePetContact(target.id, false);
        return;
      }
      movedToTarget = true;
      commitFacing(resolved.facing);
      setPawFrame(0);
      commitPhase("paw");

      const reducedMotion = prefersReducedMotion();
      const unitMilliseconds = reducedMotion ? 8 : 1000 / PET_MODE_PAW_FPS;
      for (const step of PET_MODE_PAW_TIMELINE) {
        if (token !== actionTokenRef.current) return;
        if (!contacted && step.frame === PET_MODE_PAW_CONTACT_FRAME) {
          const hitTargetRect = hitTargetRef.current?.getBoundingClientRect();
          const anchorRect = contactAnchorRef.current?.getBoundingClientRect();
          if (hitTargetRect && anchorRect) {
            await alignNativePetContact({
              targetX: resolved.targetX,
              targetY: resolved.targetY,
              anchorX: anchorRect.left - hitTargetRect.left,
              anchorY: anchorRect.top - hitTargetRect.top,
              diagnostic: resolved.diagnostic,
            }).catch(() => undefined);
          }
          if (token !== actionTokenRef.current) return;
        }
        // Paw frames are advanced by this parent loop rather than the cat's
        // internal animation clock. Close the old native silhouette before
        // painting each new frame, matching the gait/life-motion contract.
        await stagePetModeHitRegionTransition({
          regionId: `transition:paw:${step.frame}`,
          mirrored: facingRef.current === "left",
        });
        if (token !== actionTokenRef.current) return;
        setPawFrame(step.frame);
        if (!contacted && step.frame === PET_MODE_PAW_CONTACT_FRAME) {
          contacted = true;
          // Let React commit and the WebView paint the exact contact silhouette
          // before the native target disappears.
          if (!reducedMotion) await delay(34);
          await reportNativePetContact(target.id).catch(() => undefined);
        }
        await delay(step.durationUnits * unitMilliseconds);
      }

      if (token !== actionTokenRef.current) return;
    } finally {
      // Every early return above means the paw never reached its contact frame:
      // the user grabbed the cat, or another action took over. Report that
      // immediately so the caller resolves now instead of burning the full
      // contact timeout before it can react.
      if (!contacted && !target.preview) {
        void reportNativePetContact(target.id, false).catch(() => undefined);
      }
      if (token !== actionTokenRef.current) return;
      if (movedToTarget) {
        // With the expressive-interactions experiment enabled, every real
        // successful close earns the E04 face for the walk home. Approaches,
        // failed contacts, generic previews, and Show Pet stay neutral.
        const proudReturn = expressiveInteractionsEnabled()
          && contacted
          && !target.preview;
        setProudWalk(proudReturn);
        commitPhase("walk");
        try {
          await returnNativePetHome();
        } finally {
          setProudWalk(false);
        }
      }
      if (token === actionTokenRef.current) {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
      }
    }
  }, [commitFacing, commitPhase, revealForAction, stopMusicNote]);

  const playOuting = useCallback(async (awayMilliseconds: number) => {
    const token = ++actionTokenRef.current;
    try {
      await revealForAction();
      if (token !== actionTokenRef.current) return;
      commitPhase("walk");
      const outingTicket = await exitNativePetScreen();
      if (token !== actionTokenRef.current) return;
      commitVisibility(false);
      await setNativePetPresence(false, outingTicket.generation);
      await delay(awayMilliseconds);
      if (token !== actionTokenRef.current) return;
      commitVisibility(true);
      commitPhase("walk");
      await returnNativePetFromOuting(outingTicket);
    } finally {
      if (token === actionTokenRef.current && visibleRef.current) {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
      }
    }
  }, [commitPhase, commitVisibility, revealForAction]);

  const playLifeAction = useCallback(async (action: LifeAction, preview = true) => {
    if (action === "stop") {
      actionTokenRef.current += 1;
      sleepTouchRef.current = 0;
      stopMusicNote();
      setLifeLoopEnabled(false);
      commitVisibility(true);
      commitPhase(focusRestingRef.current ? "sit" : "idle");
      return;
    }
    if (action === "life_loop") {
      setLifeLoopEnabled(true);
      return;
    }
    if (action === "outing") {
      await playOuting(preview ? 2_600 : PET_MODE_AWAY_MS);
      return;
    }
    if (action === "music_note") {
      // This is an additive accent, so a Dev preview must not cancel or replace
      // the pose currently underneath it (including focused sitting).
      if (!expressiveInteractionsEnabled()) return;
      playMusicNote();
      await delay(PET_MODE_MUSIC_NOTE_DURATION_MS);
      return;
    }
    if (action === "stretch_with_note" || action === "tail_flick_with_note") {
      if (!expressiveInteractionsEnabled()) return;
      const token = ++actionTokenRef.current;
      await revealForAction();
      if (token !== actionTokenRef.current) return;
      const baseAction = action === "stretch_with_note" ? "stretch" : "tail_flick";
      commitPhase(baseAction === "stretch" ? "stretch" : "tail");
      playMusicNote();
      await delay(prefersReducedMotion()
        ? 40
        : baseAction === "stretch"
          ? PET_MODE_LIFE_MOTION_DURATION_MS
          : PET_MODE_TAIL_FLICK_DURATION_MS);
      if (token === actionTokenRef.current) {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
      }
      return;
    }
    if (action === "sleep_angry_wake") {
      if (!expressiveInteractionsEnabled()) return;
      const token = ++actionTokenRef.current;
      await revealForAction();
      if (token !== actionTokenRef.current) return;
      sleepTouchRef.current = 0;
      commitPhase("sleep");
      await delay(prefersReducedMotion() ? 40 : 600);
      if (token !== actionTokenRef.current) return;
      commitPhase("anger");
      await delay(prefersReducedMotion() ? 40 : PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS);
      if (token === actionTokenRef.current) {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
      }
      return;
    }

    const token = ++actionTokenRef.current;
    await revealForAction();
    if (token !== actionTokenRef.current) return;
    sleepTouchRef.current = 0;

    if (action === "wake") {
      commitPhase(focusRestingRef.current ? "sit" : "idle");
      return;
    }
    if (action === "sleep") {
      commitPhase("sleep");
      if (preview) return;
      await delay(randomBetween(PET_MODE_SLEEP_MIN_MS, PET_MODE_SLEEP_MAX_MS));
    } else if (action === "sit") {
      commitPhase("sit");
      if (preview) return;
      await delay(randomBetween(PET_MODE_SIT_MIN_MS, PET_MODE_SIT_MAX_MS));
    } else if (action === "walk") {
      commitPhase("walk");
      await roamNativePet();
    } else {
      const phaseByAction: Record<Exclude<LifeAction, "outing" | "wake" | "sleep" | "sit" | "walk" | "stop" | "life_loop" | "music_note" | "stretch_with_note" | "tail_flick_with_note" | "sleep_angry_wake">, PetModeCatPhase> = {
        blink: "blink",
        stretch: "stretch",
        tail_flick: "tail",
        pet: "happy",
      };
      const durationByAction: Record<keyof typeof phaseByAction, number> = {
        blink: PET_MODE_BLINK_DURATION_MS,
        stretch: PET_MODE_LIFE_MOTION_DURATION_MS,
        tail_flick: PET_MODE_TAIL_FLICK_DURATION_MS,
        pet: 1_200,
      };
      commitPhase(phaseByAction[action]);
      const musicNoteDevEnabled = expressiveInteractionsEnabled();
      const guaranteedOutcomes = guaranteedOutcomesEnabled();
      if (
        musicNoteDevEnabled
        && (action === "stretch" || action === "tail_flick")
        && (guaranteedOutcomes
          || shouldShowPetModeMusicNote(action, Math.random(), musicNoteDevEnabled))
      ) playMusicNote();
      await delay(prefersReducedMotion() ? 40 : durationByAction[action]);
    }

    if (token === actionTokenRef.current) {
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    }
  }, [commitPhase, commitVisibility, playMusicNote, playOuting, revealForAction, setLifeLoopEnabled, stopMusicNote]);

  const wakeSleepingPet = useCallback(async () => {
    const token = ++actionTokenRef.current;
    sleepTouchRef.current = 0;
    const experimentsEnabled = expressiveInteractionsEnabled();
    if (!experimentsEnabled) {
      commitPhase(focusRestingRef.current ? "sit" : "idle");
      return;
    }
    const guaranteedOutcomes = guaranteedOutcomesEnabled();
    const annoyed = guaranteedOutcomes || Math.random() < PET_MODE_SLEEP_WAKE_ANGER_CHANCE;
    if (!annoyed) {
      commitPhase(focusRestingRef.current ? "sit" : "idle");
      return;
    }

    // Anger is a wake-up reaction, not a general click reaction. The sleeping
    // branch is the only caller, so an awake happy tap can never roll this
    // effect even when Math.random would otherwise qualify.
    commitPhase("anger");
    await delay(PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS);
    if (token === actionTokenRef.current) {
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    }
  }, [commitPhase]);

  const playCursorHunt = useCallback(async (
    huntSettings: PetModeDriftHuntSettings,
    options: { allowWhileResting?: boolean } = {},
  ) => {
    const focusBlocksHunt = () => !options.allowWhileResting && focusRestingRef.current;
    if (!huntSettings.enabled || focusBlocksHunt()) return;
    const token = ++actionTokenRef.current;
    restartAutonomousCycle();
    await cancelNativePetMotion().catch(() => undefined);
    await revealForAction().catch(() => undefined);
    if (token !== actionTokenRef.current || focusBlocksHunt()) return;
    setPreserveEntryLanding(false);
    if (huntAlertTimerRef.current !== null) window.clearTimeout(huntAlertTimerRef.current);
    setHuntAlertVisible(huntSettings.showAlertCue);
    setHuntAlertDurationMs(huntSettings.alertDurationMs);
    huntAlertTimerRef.current = huntSettings.showAlertCue
      ? window.setTimeout(() => {
        huntAlertTimerRef.current = null;
        setHuntAlertVisible(false);
      }, huntSettings.alertDurationMs)
      : null;
    commitPhase("stalk");

    const stalk = await stalkNativePetCursor(huntSettings).catch(() => null);
    if (token !== actionTokenRef.current || focusBlocksHunt()) return;
    if (
      stalk?.outcome === "completed"
      && stalk.cursorX !== null
      && stalk.cursorY !== null
    ) {
      commitFacing(stalk.facing);
      // The stalk target is authored from the walk SVG's mouth centre, so
      // contact no longer borrows the unrelated browser-tab paw sequence.
      // Hold the closed mouth long enough to read, then let native pivot the
      // body around that exact point and return with the cursor along the
      // approach path. Native emits the one intentional facing change together
      // with the return gait so React never servo-flips mid-walk.
      commitPhase("bite");
      await delay(huntSettings.biteHoldMs);
      if (token !== actionTokenRef.current || focusBlocksHunt()) return;
      await returnWithNativePetCursor({
        targetX: stalk.cursorX,
        targetY: stalk.cursorY,
        approachFacing: stalk.facing,
        cursorMovementDistance: stalk.cursorMovementDistance,
        settings: huntSettings,
      }).catch(() => null);
      if (token !== actionTokenRef.current || focusBlocksHunt()) return;
      commitPhase("bite");
      await delay(huntSettings.biteHoldMs);
    }
    if (token !== actionTokenRef.current || focusBlocksHunt()) return;
    commitPhase("sit");
    await delay(PET_MODE_DRIFT_STALK_SETTLE_MS);
    if (token === actionTokenRef.current && !focusRestingRef.current) commitPhase("idle");
  }, [commitFacing, commitPhase, restartAutonomousCycle, revealForAction]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetModeEvent((event) => {
      if (event.kind === "snapshot") {
        setSnapshot(event.snapshot);
        return;
      }
      if (event.kind === "guides") {
        setGuidesEnabled(event.enabled);
        return;
      }
      if (event.kind === "reveal") {
        // A queued reveal from an older Show request must not resurrect the
        // renderer after a newer Off request has already won in shared storage.
        if (!resolvePetModePresent()) return;
        // An explicit Show Pet request owns the screen immediately. Invalidate
        // any old outing/return timer so it cannot hide the freshly revealed
        // cat after native has already replayed the entry motion.
        actionTokenRef.current += 1;
        sleepTouchRef.current = 0;
        restartAutonomousCycle();
        setPreserveEntryLanding(false);
        setProudWalk(false);
        petModeEnabledRef.current = true;
        commitVisibility(true);
        setPetModeEnabled(true);
        commitPhase(focusRestingRef.current ? "sit" : "idle");
        return;
      }
      if (event.kind === "facing") {
        commitFacing(event.facing);
        return;
      }
      if (event.kind === "preview_facing") {
        const devModeEnabled = window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1";
        const resting = phaseRef.current === "idle" || phaseRef.current === "sit";
        if (
          devModeEnabled
          && petModeEnabledRef.current
          && visibleRef.current
          && resting
          && activeLabActionRef.current === null
          && !manualDragRef.current
        ) {
          commitFacing(event.facing);
        } else {
          reportLabState();
        }
        return;
      }
      if (event.kind === "motion") {
        if (
          manualDragRef.current
          || phaseRef.current === "drag"
          || phaseRef.current === "release"
        ) return;
        if (focusRestingRef.current) return;
        if (event.motion === "entry") {
          // Native cancellation normally prevents stale entry events after the
          // toggle turns off. Re-check the shared setting here as a webview-side
          // guard so a queued old event cannot resurrect the hidden pet.
          if (!resolvePetModePresent()) return;
          // A persisted cold-start pose may already be `entry`. Bump a separate
          // sequence so the gait restarts exactly when native screen movement
          // begins instead of continuing from the hidden mount time.
          actionTokenRef.current += 1;
          restartAutonomousCycle();
          setEntryTravelDistance(event.travelDistance);
          setEntryDurationMs(resolvePetModeEntryDurationMs(event.travelDistance, event.durationMs));
          setEntrySequence((sequence) => sequence + 1);
          setPreserveEntryLanding(false);
          petModeEnabledRef.current = true;
          commitVisibility(true);
          setPetModeEnabled(true);
        } else {
          setPreserveEntryLanding(false);
        }
        commitPhase(event.motion);
        return;
      }
      if (event.kind === "entry_complete") {
        if (!resolvePetModePresent()) return;
        if (focusRestingRef.current) {
          setPreserveEntryLanding(false);
          commitPhase("sit");
          return;
        }
        const beganANewResidence = phaseRef.current === "entry" || !petModeEnabledRef.current;
        petModeEnabledRef.current = true;
        commitVisibility(true);
        setPetModeEnabled(true);
        if (phaseRef.current === "entry") {
          // Keep the exact final walk SVG mounted after the native window lands.
          // This avoids any frame, canvas, or coordinate change at the handoff.
          setPreserveEntryLanding(true);
          commitPhase("idle");
        }
        if (beganANewResidence) restartAutonomousCycle();
        return;
      }
      if (event.kind === "preview_action") {
        const previewAction = event.action;
        const isCursorHuntPreview = previewAction === "cursor_hunt_single"
          || previewAction === "cursor_hunt_chase";
        // Lab previews are deliberately single-flight. A walk moves the native
        // overlay independently, so letting another pose start during that trip
        // makes the cat look as if it is stretching or sleeping while walking.
        // Wake is the intentional interruption that clears the persistent
        // sleep pose immediately.
        if (
          phaseRef.current !== "idle"
          && !(isCursorHuntPreview && phaseRef.current === "sit")
          && previewAction !== "music_note"
          && previewAction !== "wake"
          && previewAction !== "stop"
        ) {
          reportLabState();
          return;
        }
        if (isCursorHuntPreview) {
          const huntSettings = resolvePetModeDriftHuntSettings();
          if (!huntSettings.enabled) {
            reportLabState();
            return;
          }
          void (async () => {
            const actionRevision = setActiveLabAction(previewAction);
            try {
              await playCursorHunt({
                ...huntSettings,
                mode: previewAction === "cursor_hunt_chase" ? "chase" : "single",
              }, { allowWhileResting: true });
            } finally {
              clearActiveLabAction(actionRevision);
            }
          })();
          return;
        }
        void (async () => {
          const actionRevision = setActiveLabAction(previewAction);
          try {
            await playLifeAction(previewAction);
          } catch {
            commitPhase("idle");
          } finally {
            clearActiveLabAction(actionRevision);
          }
        })();
        return;
      }
      const isLabTarget = event.target.labTarget === "browser_tab_x"
        || event.target.labTarget === "drifty_window_x";
      if (
        activeLabActionRef.current === "intervention"
        || (!isLabTarget && focusRestingRef.current)
        || manualDragRef.current
        || (isLabTarget && phaseRef.current === "entry")
        || phaseRef.current === "drag"
        || phaseRef.current === "release"
      ) {
        reportLabState();
        return;
      }
      void (async () => {
        automaticInterventionRef.current = !isLabTarget && !event.target.preview;
        const actionRevision = setActiveLabAction("intervention");
        try {
          await playIntervention(event.target);
        } catch {
          commitPhase("idle");
          void returnNativePetHome().catch(() => undefined);
        } finally {
          automaticInterventionRef.current = false;
          clearActiveLabAction(actionRevision);
          // Focus may have ended while a cancelled native move was still
          // resolving. The focus-exit effect deliberately waits for action
          // ownership to clear, so finish that deferred sit -> idle handoff
          // here instead of stranding the autonomous scheduler in `sit`.
          if (!focusRestingRef.current && phaseRef.current === "sit") {
            restartAutonomousCycle();
            commitPhase("idle");
          }
        }
      })();
    }).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
      actionTokenRef.current += 1;
    };
  }, [clearActiveLabAction, commitFacing, commitPhase, commitVisibility, playCursorHunt, playIntervention, playLifeAction, reportLabState, restartAutonomousCycle, setActiveLabAction]);

  useEffect(() => {
    const resting = snapshot?.productivity === "focus";
    const wasResting = focusRestingRef.current;
    focusRestingRef.current = resting;

    if (!petModeEnabled) {
      focusRestAppliedRef.current = false;
      return;
    }
    if (
      manualReleaseTokenRef.current !== null
      && manualReleaseTokenRef.current === actionTokenRef.current
    ) {
      // A focus boundary can arrive anywhere in the landing reaction. Retarget
      // only the quiet release; a user-triggered walk/look keeps ownership and
      // will settle into the newly correct final pose when it finishes.
      const reaction = manualDropReactionRef.current ?? "stay";
      if (phaseRef.current === "release") {
        updateDragReleasePose(resting && reaction === "stay" ? "sit" : "idle");
      }
      focusRestAppliedRef.current = resting && reaction === "stay";
      if (resting || wasResting) restartAutonomousCycle();
      if (resting && reaction !== "look_tail") {
        gazeEngagedRef.current = false;
        setGazeOffset({ x: 0, y: 0 });
      }
      return;
    }
    if (resting) {
      if (focusRestAppliedRef.current) return;
      restartAutonomousCycle();
      gazeEngagedRef.current = false;
      setGazeOffset({ x: 0, y: 0 });

      // Direct manipulation and explicit Lab previews keep ownership until
      // their normal completion; every automatic action is interruptible.
      const explicitLabPreviewOwnsMotion = activeLabActionRef.current !== null
        && !automaticInterventionRef.current;
      if (manualDragRef.current || explicitLabPreviewOwnsMotion) return;
      focusRestAppliedRef.current = true;
      actionTokenRef.current += 1;
      void cancelNativePetMotion().catch(() => undefined);
      if (!visibleRef.current) {
        commitVisibility(true);
        void setNativePetPresence(true).catch(() => undefined);
      }
      setPreserveEntryLanding(false);
      commitPhase("sit");
      return;
    }

    const hadAppliedRest = focusRestAppliedRef.current;
    focusRestAppliedRef.current = false;
    if (wasResting || hadAppliedRest) {
      restartAutonomousCycle();
      if (!manualDragRef.current && !activeLabActionRef.current && phaseRef.current === "sit") {
        commitPhase("idle");
      }
    }
  }, [commitPhase, commitVisibility, petModeEnabled, restartAutonomousCycle, snapshot?.productivity, updateDragReleasePose]);

  useEffect(() => {
    const next = advancePetModeDriftHunt(
      driftHuntRef.current,
      snapshot,
      prefersReducedMotion(),
    );
    driftHuntRef.current = next.state;
    if (!petModeEnabled || !next.action || manualDragRef.current || activeLabActionRef.current) return;

    const huntSettings = resolvePetModeDriftHuntSettings();
    if (!huntSettings.enabled) return;
    if (next.action === "stalk") {
      void playCursorHunt(huntSettings);
      return;
    }
    const token = ++actionTokenRef.current;
    restartAutonomousCycle();
    void cancelNativePetMotion().catch(() => undefined);
    void (async () => {
      if (!visibleRef.current) {
        commitVisibility(true);
        await setNativePetPresence(true).catch(() => undefined);
      }
      if (token !== actionTokenRef.current || focusRestingRef.current) return;
      setPreserveEntryLanding(false);

      commitPhase("notice");
      await delay(PET_MODE_DRIFT_NOTICE_MS);

      if (token === actionTokenRef.current && !focusRestingRef.current) commitPhase("idle");
    })();
  }, [commitPhase, commitVisibility, petModeEnabled, playCursorHunt, restartAutonomousCycle, snapshot]);

  useEffect(() => {
    if (phase !== "entry") return;
    // Native completion is authoritative. The recovery grace covers the native
    // visible paint hold plus scheduling slack; this only prevents a
    // stale gait if cold-start/HMR misses the completion event.
    const timerId = window.setTimeout(() => {
      if (phaseRef.current === "entry") {
        // A cancelled native entrance can leave the transparent leading edge
        // parked just outside the display. Settling only the renderer phase
        // would then report an idle, visible pet that the user still cannot
        // see. Reassert native presence as part of the fallback so the panel
        // is moved back to its remembered home before we declare it resident.
        void setNativePetPresence(true).catch(() => undefined);
        setPreserveEntryLanding(true);
        commitPhase("idle");
        restartAutonomousCycle();
      }
    }, entryDurationMs + PET_MODE_ENTRY_FALLBACK_GRACE_MS);
    return () => window.clearTimeout(timerId);
  }, [commitPhase, entryDurationMs, entrySequence, phase, restartAutonomousCycle]);

  useEffect(() => {
    if (!labLifeLoopEnabled) return;
    let disposed = false;
    let timerId = 0;
    const schedule = (delayMs: number) => {
      timerId = window.setTimeout(() => {
        if (disposed) return;
        if (phaseRef.current !== "idle" || !visibleRef.current) {
          schedule(700);
          return;
        }
        const action = LAB_LIFE_ACTIONS[Math.floor(Math.random() * LAB_LIFE_ACTIONS.length)];
        void playLifeAction(action).finally(() => {
          if (!disposed) schedule(randomBetween(8_000, 14_000));
        });
      }, delayMs);
    };
    schedule(350);
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [labLifeLoopEnabled, playLifeAction]);

  useEffect(() => {
    if (!petModeEnabled || snapshot?.productivity === "focus") return;
    let disposed = false;
    let timerId = 0;
    const cycle = autonomousCycle;
    const isCurrentCycle = () => (
      !disposed
      && petModeEnabledRef.current
      && autonomousCycleRef.current === cycle
    );
    // `schedule` re-arms the full presence window; `retry` only waits for the
    // pet to become interruptible. Re-arming on every retry made the outing
    // starve once sit/sleep started holding the pet out of `idle` for minutes:
    // the due outing was pushed back another nine minutes each time instead of
    // firing as soon as the pet stood back up.
    const runOuting = () => {
      void playOuting(PET_MODE_AWAY_MS).finally(() => {
        if (isCurrentCycle()) schedule();
      });
    };
    const retry = () => {
      timerId = window.setTimeout(() => {
        if (!isCurrentCycle()) return;
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current) {
          retry();
          return;
        }
        runOuting();
      }, 1_000);
    };
    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (!isCurrentCycle()) return;
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current) {
          retry();
          return;
        }
        runOuting();
      }, PET_MODE_PRESENT_MS);
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [autonomousCycle, petModeEnabled, playOuting, snapshot?.productivity]);

  useEffect(() => {
    if (!petModeEnabled || snapshot?.productivity === "focus") return;
    let disposed = false;
    let timerId = 0;
    const cycle = autonomousCycle;
    const isCurrentCycle = () => (
      !disposed
      && petModeEnabledRef.current
      && autonomousCycleRef.current === cycle
    );
    const roll = () => {
      // The pet stands back up between autonomous actions. Condition the next
      // roll on the previous autonomous pose rather than pretending the current
      // `idle` frame is still seated. A completed sit opens the dozing branch.
      const posture = previousAutonomousActionRef.current === "sit" ? "sitting" : "standing";
      const action = pickPetModeLifeAction(posture, Math.random());
      previousAutonomousActionRef.current = action;
      void playLifeAction(action, false).finally(() => {
        if (isCurrentCycle()) schedule();
      });
    };
    // Same starvation guard as the outing timer: once the roll is due, wait for
    // an interruptible moment instead of restarting the whole interval.
    const retry = () => {
      timerId = window.setTimeout(() => {
        if (!isCurrentCycle()) return;
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current) {
          retry();
          return;
        }
        roll();
      }, 1_000);
    };
    const schedule = () => {
      const interval = getPetModeNextActionInterval(
        snapshot?.productivity ?? null,
        previousAutonomousActionRef.current,
        dropLifePreviewEnabled(),
      );
      timerId = window.setTimeout(() => {
        if (!isCurrentCycle()) return;
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current) {
          retry();
          return;
        }
        roll();
      }, randomBetween(.72, 1.28) * interval);
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [autonomousCycle, dropLifePreviewRevision, petModeEnabled, playLifeAction, snapshot?.productivity]);

  useEffect(() => {
    if (snapshot?.productivity === "focus") return undefined;
    let disposed = false;
    let resetTimerId = 0;
    let timerId = 0;
    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (disposed) return;
        if (phaseRef.current === "idle" && visibleRef.current) {
          commitPhase("blink");
          resetTimerId = window.setTimeout(() => {
            if (phaseRef.current === "blink") commitPhase("idle");
          }, prefersReducedMotion() ? 30 : PET_MODE_BLINK_DURATION_MS);
        }
        schedule();
      }, randomBetween(PET_MODE_BLINK_INTERVAL_MIN_MS, PET_MODE_BLINK_INTERVAL_MAX_MS));
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      window.clearTimeout(resetTimerId);
    };
  }, [commitPhase, snapshot?.productivity]);

  useEffect(() => {
    if (snapshot?.productivity === "focus") return undefined;
    let disposed = false;
    let resetTimerId = 0;
    let timerId = 0;
    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (disposed) return;
        // The tail flick only fires from `idle`, so its share of screen time
        // fell as sit/sleep took that time over. Raising the gate keeps the
        // flick roughly as frequent as before per minute of standing, which is
        // the cadence that was reviewed and approved.
        if (Math.random() < .62 && phaseRef.current === "idle" && visibleRef.current) {
          commitPhase("tail");
          resetTimerId = window.setTimeout(() => {
            if (phaseRef.current === "tail") commitPhase("idle");
          }, prefersReducedMotion() ? 40 : PET_MODE_TAIL_FLICK_DURATION_MS);
        }
        schedule();
      }, randomBetween(6_200, 10_400));
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      window.clearTimeout(resetTimerId);
    };
  }, [commitPhase, snapshot?.productivity]);

  useEffect(() => {
    // Focus and drift are both intentionally self-contained states. Looking at
    // every nearby pointer during either one makes the pet read like an eager
    // assistant waiting for input rather than a cat with its own attention.
    // Neutral time still keeps the small proximity response for users who
    // deliberately approach the resting pet.
    //
    // The cursor hunt is the one exception inside drift. It is the drift state,
    // but the cat is deliberately going after the pointer, so refusing to look
    // at it there produced the opposite of self-contained: a cat sprinting at
    // the cursor while staring straight past it. A manual drop acknowledgement
    // is the other narrow exception: the user just addressed the cat directly.
    if (
      !petModeEnabled
      || !petVisible
      || (snapshot?.productivity === "focus" && !manualGazeActive)
    ) {
      gazeEngagedRef.current = false;
      setGazeOffset({ x: 0, y: 0 });
      return undefined;
    }
    let disposed = false;
    let timerId = 0;
    const poll = async () => {
      if (disposed) return;
      const pose = petModeGazePoseForPhase(phaseRef.current);
      const reducedMotion = prefersReducedMotion();
      // Drift is checked here rather than in the effect condition because the
      // exception depends on the live phase, and phase lives in a ref that
      // cannot retrigger this effect.
      const driftBlocksGaze = snapshot?.productivity === "drift"
        && !isPetModeChaseMotionKind(phaseRef.current);
      if (!pose || reducedMotion || driftBlocksGaze || manualDragRef.current) {
        gazeEngagedRef.current = false;
        setGazeOffset((current) => current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 });
      } else {
        const sample = await sampleNativePetCursor();
        if (disposed) return;
        if (!sample) {
          gazeEngagedRef.current = false;
          setGazeOffset((current) => current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 });
          return;
        }
        if (!sample.visible) {
          gazeEngagedRef.current = false;
          setGazeOffset((current) => current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 });
        } else {
          const next = resolvePetModeGazeOffset({
            cursorX: sample.cursorX,
            cursorY: sample.cursorY,
            windowX: sample.windowX,
            windowY: sample.windowY,
            windowWidth: sample.windowWidth,
            windowHeight: sample.windowHeight,
            facing: facingRef.current,
            pose,
            reducedMotion,
          }, gazeEngagedRef.current);
          gazeEngagedRef.current = next.engaged;
          setGazeOffset((current) => {
            const damped = dampPetModeGazeOffset(current, next.offset, PET_MODE_GAZE_SAMPLE_MS);
            if (Math.abs(current.x - damped.x) < 0.04 && Math.abs(current.y - damped.y) < 0.04) {
              return current;
            }
            return damped;
          });
        }
      }
      if (!disposed) timerId = window.setTimeout(() => { void poll(); }, PET_MODE_GAZE_SAMPLE_MS);
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [manualGazeActive, petModeEnabled, petVisible, snapshot?.productivity]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    // The overlay is a separate, non-focusable window. It must still consume
    // every press on its hit rectangle, including while an animation is busy;
    // otherwise macOS may forward that down-event to the dashboard below it.
    event.preventDefault();
    event.stopPropagation();
    void reportNativePetPointer().catch(() => undefined);
    if (typeof event.button === "number" && event.button > 0) return;
    if (manualDragRef.current) return;
    const dragToken = ++actionTokenRef.current;
    manualDragRef.current = true;
    void cancelNativePetMotion().catch(() => undefined);
    void (async () => {
      try {
        // Native tracking must begin in the original pointer-down task so it
        // preserves the exact initial cursor coordinate. Waiting here for the
        // pickup artwork made short/quick drags lose their first 148 ms and
        // appear as a tiny twitch. Rust owns that visual hold now: it captures
        // the pointer immediately, lets WebKit paint, then follows the full
        // delta without sacrificing input.
        const result = await beginNativePetDrag(
          event.clientX,
          event.clientY,
          prefersReducedMotion() ? 0 : PET_MODE_DRAG_PICKUP_MS,
        );
        // A real pointer drag owns the pet until release. Automatic/lab actions
        // may invalidate their own token while AppKit runs its native tracking
        // loop, but they must never strand manualDragRef at true or suppress the
        // user's release transition.
        if (result.moved) {
          finishManualDrag(result);
          return;
        }
        manualDragRef.current = false;
        // Native movement never crossed the drag threshold, so this entire
        // gesture is a normal petting tap. Cancel any interrupted life pose
        // before playing the existing happy reaction, while preserving the
        // deliberate two-touch wake behavior for a sleeping cat.
        if (phaseRef.current !== "sleep") {
          commitPhase(focusRestingRef.current ? "sit" : "idle");
        }
        handlePet();
      } catch (error) {
        void reportNativePetDragError(error).catch(() => undefined);
        manualDragRef.current = false;
        if (dragToken === actionTokenRef.current) {
          commitPhase(focusRestingRef.current ? "sit" : "idle");
        }
      }
    })();
  };

  /* A right-click is a menu request, never a petting gesture. handlePointerDown
     already ignores non-primary buttons, so the only thing needed here is to
     stop the browser's own menu and hand the press to AppKit. */
  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (manualDragRef.current) return;
    /* The menu is anchored to where the cat stands. Autonomous life keeps
       running underneath it, so without this the cat can walk out from under
       its own open menu and leave it pointing at nothing. Holding the pose for
       the lifetime of the menu also stops a second right-click from stacking a
       duplicate popup. */
    if (menuOpenRef.current) return;
    menuOpenRef.current = true;
    setMenuHolding(true);
    void openNativePetModeMenu({
      onOpenDashboard: () => {
        void triggerNativeEndOfDayReviewAction("openDashboard").catch(() => undefined);
      },
      onOpenSettings: () => {
        void triggerNativeEndOfDayReviewAction("openSettings").catch(() => undefined);
      },
      onHideForOneHour: () => {
        void triggerNativePetVisibilityAction("hideOneHour").catch(() => undefined);
      },
      onTurnOffPet: () => {
        void triggerNativePetVisibilityAction("turnOff").catch(() => undefined);
      },
    }).catch(() => undefined).finally(() => {
      menuOpenRef.current = false;
      setMenuHolding(false);
    });
  };

  const handlePet = () => {
    if (manualDragRef.current) return;
    if (phaseRef.current === "sleep") {
      if (sleepTouchRef.current === 0) {
        sleepTouchRef.current = 1;
        return;
      }
      void wakeSleepingPet();
      return;
    }
    // Sitting is a multi-minute hold, so it has to stay pettable or the pet
    // reads as unresponsive for most of the time it is settled. Unlike sleep it
    // needs no two-touch guard: the cat is already awake and looking.
    if (
      phaseRef.current !== "idle"
      && phaseRef.current !== "blink"
      && phaseRef.current !== "tail"
      && phaseRef.current !== "sit"
    ) return;

    // OFF preserves the shipped interaction: every awake touch simply plays
    // the happy response. ON adds the experimental relationship streak.
    if (!expressiveInteractionsEnabled()) {
      petStreakRef.current = 0;
      lastPetAtRef.current = 0;
      void playLifeAction("pet");
      return;
    }

    // Repeated petting is a relationship, not a series of unrelated taps. Each
    // pet inside the streak window adds to a run; a long enough run settles the
    // cat instead of replaying the same happy beat forever. The streak decays
    // on its own so attention has to be renewed rather than banked.
    const now = Date.now();
    const continuing = now - lastPetAtRef.current <= PET_MODE_PET_STREAK_WINDOW_MS;
    petStreakRef.current = continuing ? petStreakRef.current + 1 : 1;
    lastPetAtRef.current = now;

    if (petStreakRef.current >= PET_MODE_PET_STREAK_TO_SLEEP) {
      petStreakRef.current = 0;
      void playLifeAction("sleep", false);
      return;
    }
    void playLifeAction("pet");
  };

  const entering = phase === "entry";

  return (
    <main className="pet-mode-surface" data-productivity={snapshot?.productivity ?? "neutral"}>
      <div className="pet-mode-scale">
        <button
          ref={hitTargetRef}
          type="button"
          className={`pet-mode-hit-target${entering ? " is-entering" : ""}`}
          onPointerDown={handlePointerDown}
          onContextMenu={handleContextMenu}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-label="Pet Drifty cat. Drag to move. Right-click for options."
        >
          <PetModeCat
            phase={phase}
            facing={facing}
            pawFrame={pawFrame}
            entrySequence={entrySequence}
            entryTravelDistance={entryTravelDistance}
            entryDurationMs={entryDurationMs}
            sizeScale={petModeSize / 100}
            preserveEntryLanding={preserveEntryLanding}
            hitRegionInteractive={petModeEnabled
              && petVisible
              && phase !== "entry"
              /* While the menu is up AppKit owns the pointer. Republishing the
                 silhouette underneath it can hand input back mid-popup. */
              && !menuHolding
              && hitRegionTransitionCount === 0}
            hitRegionCommitRevision={hitRegionCommitRevision}
            gazeOffset={gazeOffset}
            huntAlertVisible={huntAlertVisible}
            huntAlertDurationMs={huntAlertDurationMs}
            dragPickupPose={dragPickupPose}
            dragReleasePose={dragReleasePose}
            proudWalk={proudWalk}
            musicNoteVisible={musicNoteVisible}
          />
          <span
            ref={contactAnchorRef}
            className={`pet-mode-contact-anchor pet-mode-contact-anchor--${facing}`}
            aria-hidden="true"
          />
          {guidesEnabled && (phase === "drag" || manualDragRef.current) && dragProbe ? (
            <div className={`pet-mode-drag-probe-badge pet-mode-drag-probe-badge--${getDragProbeKind(dragProbe)}`} aria-hidden="true">
              <span className="pet-mode-drag-probe-dot" />
              <span className="pet-mode-drag-probe-text">{getDragProbeLabel(dragProbe)}</span>
            </div>
          ) : null}
          {guidesEnabled ? (
            <div className="pet-mode-guides" aria-hidden="true">
              <div className="pet-mode-guide-line pet-mode-guide-line--feet">
                <span className="pet-mode-guide-label">발 93pt</span>
              </div>
              <div className="pet-mode-guide-marker pet-mode-guide-marker--slab-left" />
              <div className="pet-mode-guide-marker pet-mode-guide-marker--slab-right" />
              <div className="pet-mode-guide-box" />
            </div>
          ) : null}
        </button>
      </div>
    </main>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}


function getDragProbeKind(probe: PetDropPlan): "stay" | "ledge" | "catch" | "hop" {
  switch (probe.kind) {
    case "stay_top":
    case "stay_floor":
      return "stay";
    case "already_on":
      return "ledge";
    case "catch":
      return "catch";
    case "hop":
    default:
      return "hop";
  }
}

function getDragProbeLabel(probe: PetDropPlan): string {
  switch (probe.kind) {
    case "stay_top":
      return "상단 집 (안 떨어짐)";
    case "stay_floor":
      return "하단 집 (안 떨어짐)";
    case "already_on":
      return `${probe.ledge} 위 (밀착)`;
    case "catch":
      return `낙하: ${probe.ledge} (${Math.round(probe.distance)}pt)`;
    case "hop":
    default:
      return "일반 낙하 (4pt 홉)";
  }
}
