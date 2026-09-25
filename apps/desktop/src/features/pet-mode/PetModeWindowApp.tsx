import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { PET_MODE_DRIFT_REACTION_ENABLED } from "../../appFeatureSwitches";
import {
  PetModeCat,
  resolvePetModeSitGazeAnchor,
  type PetModeCatPhase,
  type PetModeDriftCue,
  type PetModeRestPose,
} from "./PetModeCat";
import {
  alignNativePetContact,
  beginNativePetDrag,
  cancelNativePetMotion,
  exitNativePetScreen,
  listenToNativePetDragEnd,
  listenToNativePetDragProbe,
  listenToNativePetDragStart,
  listenToNativePetStrokeDetected,
  listenToNativePetModeEvent,
  listenToNativePetModeLabStateRequest,
  moveNativePetToTarget,
  finishNativePetFullscreenIntervention,
  probeNativePetAxSeat,
  prepareNativePetOutingHunt,
  reconcileNativePetPosition,
  rememberNativePetPosition,
  resolveNativePetDrop,
  type PetDropPlan,
  type PetModeNativeDragResult,
  type PetModeSeatResolution,
  reportNativePetContact,
  reportNativePetDragError,
  reportNativePetModeLabState,
  reportNativePetPointer,
  returnNativePetFromOuting,
  returnNativePetHome,
  roamNativePet,
  sampleNativePetCursor,
  isNativePetCursorInside,
  isNativePetQuickControlsCursorInside,
  listenToNativePetQuickControlsAction,
  listenToNativePetQuickControlsHold,
  listenToNativePetQuickControlsMenuState,
  setNativePetQuickControlsVisible,
  setNativePetDanceHeadroom,
  setNativePetPresence,
  stalkNativePetCursor,
  returnWithNativePetCursor,
  triggerNativePetQuickControlsAction,
  triggerNativePetVisibilityAction,
} from "./petModeBridge";
import { usePetTimedPauseSleep } from "./usePetTimedPauseSleep";
import { openNativePetModeMenu, openNativePetTurnOffSuggestionMenu } from "./petModeNativeMenu";
import {
  EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT,
  PET_QUICK_CONTROLS_EXIT_MS,
  PET_QUICK_CONTROLS_EXIT_POLL_MS,
  PET_QUICK_CONTROLS_ACKNOWLEDGE_COOLDOWN_MS,
  PET_QUICK_CONTROLS_INTERACTION_COOLDOWN_MS,
  PET_QUICK_CONTROLS_POLL_MS,
  advancePetQuickControlsHoverIntent,
  isPetQuickControlsInteractionCoolingDown,
  isPetQuickControlsHoverablePhase,
  pointerMovedEnough,
  type PetQuickControlsPoint,
} from "./petModeQuickControls";
import { resolveInitialDisplayLanguage } from "../localization/languagePreference";
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
  PET_MODE_ENTRY_FALLBACK_GRACE_MS,
  getPetModeDefaultEntryTravelDistance,
  getPetModeWindowSize,
  resolvePetModeEntryDurationMs,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_DANCE_DURATION_MS,
  PET_MODE_DANCE_ON_CLOSE_BETA_STORAGE_KEY,
  resolveInitialPetModeDanceOnCloseBetaEnabled,
  PET_MODE_MUSIC_NOTE_DURATION_MS,
  PET_MODE_PET_STREAK_TO_DROWSY,
  PET_MODE_PET_STREAK_TO_SLEEP,
  PET_MODE_PET_STREAK_WINDOW_MS,
  PET_MODE_POST_DROP_LOOK_DURATION_MS,
  PET_MODE_PAW_CONTACT_FRAME,
  PET_MODE_PAW_FPS,
  PET_MODE_PAW_PREP_FRAME_COUNT,
  PET_MODE_PAW_TIMELINE,
  PET_MODE_PRESENT_MS,
  PET_MODE_INTERVENTION_PAW_LEAD_MS,
  PET_MODE_RUN_BETA_STORAGE_KEY,
  PET_MODE_STORAGE_KEY,
  PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
  PET_MODE_SIZE_STORAGE_KEY,
  PET_MODE_SEAT_RECONCILE_INTERVAL_MS,
  PET_MODE_SEAT_CLEAR_CONFIRM_MS,
  PET_MODE_DROWSY_RESETTLE_MS,
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
  resolveInitialPetModeRunBetaEnabled,
  resolveInitialPetModeSize,
  resolvePetModePresent,
  shouldShowPetModeMusicNote,
  type PetModeInterventionTarget,
  type PetModeLabAction,
  type PetModeLifeAction,
  type PetModeOutingTicket,
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
import { subscribePetOutingPreference, usePetOutingPreference } from "./petOutingPreference";
import {
  PET_PRESENCE_DISMISS_RETREAT_MS,
  PET_PRESENCE_INITIAL_RETREAT_MS,
  PET_PRESENCE_RETREAT_AFTER_FOCUS_MS,
  hasSeenPetTurnOffSuggestion,
  markPetTurnOffSuggestionSeen,
  persistPetPresenceMode,
  usePetPresenceMode,
} from "./petPresenceMode";
import {
  EMPTY_PET_MODE_DRIFT_HUNT_STATE,
  PET_MODE_DRIFT_HUNT_ALERT_MS,
  PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY,
  PET_MODE_DRIFT_NOTICE_SECONDS,
  PET_MODE_DRIFT_NOTICE_MS,
  PET_MODE_DRIFT_SLEEP_EXPRESSION_PREVIEW_MS,
  PET_MODE_DRIFT_SLEEP_FULL_PREVIEW_HOLD_MS,
  PET_MODE_DRIFT_SLEEP_NOTICE_MS,
  PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS,
  PET_MODE_DRIFT_SLEEP_WAKE_MS,
  PET_MODE_DRIFT_STALK_SETTLE_MS,
  advancePetModeDriftHunt,
  commitPetModeDriftHuntAction,
  resolvePetModeDriftHuntSettings,
  suppressPetModeDriftHunt,
  type PetModeDriftHuntAction,
  type PetModeDriftHuntSettings,
  type PetModeDriftHuntState,
} from "./petModeDriftHunt";
import "./petMode.css";

const LAB_LIFE_ACTIONS = ["walk", "stretch", "tail_flick"] as const;
// The native drag loop reports at pointer-tracking cadence. AX window walks
// are much heavier, and a 4 Hz diagnostic is still comfortably live to a
// person deciding where to drop the cat.
const PET_MODE_AX_PROBE_INTERVAL_MS = 250;
type LifeAction = Exclude<PetModePreviewAction, "sleep_drift_notice" | "sleep_drift_full_preview" | "cursor_hunt_single" | "cursor_hunt_chase"> | "drowsy";
type PetModeAxProbeKind = "scanning" | "free" | "overlap" | "blocked" | "unknown" | "off";
type PetModeAxProbeDisplay = {
  readonly kind: PetModeAxProbeKind;
  readonly label: string;
};
type PetModeInterventionRunTiming = {
  readonly durationMs: number;
  readonly startDelayMs: number;
};

function guaranteedOutcomesEnabled(): boolean {
  return window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1"
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
  const timedPauseUntil = usePetTimedPauseSleep();
  const timedPauseRef = useRef(timedPauseUntil);
  timedPauseRef.current = timedPauseUntil;
  const initialSleepNeedsPresenceRef = useRef(timedPauseUntil !== null);
  // A pause expiring mid-drag may resume settings, but the held cat keeps its
  // sleeping silhouette until native placement completes.
  const sleepingDragRef = useRef(false);
  // A sleeping cat that must step off a control wakes drowsily, walks, and
  // lies back down. While this runs, the timed-pause sleep lock yields to the
  // walk and drowsy poses; every other path still sees the cat as asleep.
  const sleepwalkRef = useRef(false);
  const sleepwalkTokenRef = useRef(0);
  const sleepwalkResettleTimerRef = useRef<number | null>(null);
  const [sleepwalking, setSleepwalking] = useState(false);
  // Native announces facing before the seat-correction motion. The sleep lock
  // refuses the flip, so keep the last one for when the sleepwalk begins.
  const heldSleepFacingRef = useRef<"left" | "right" | null>(null);
  const initialPhase: PetModeCatPhase = timedPauseUntil !== null ? "sleep" : initialAppearance.phase;
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
  const [runSequence, setRunSequence] = useState(0);
  const [runTravelDistance, setRunTravelDistance] = useState<number | undefined>(undefined);
  const [runDurationMs, setRunDurationMs] = useState<number | undefined>(undefined);
  const [runStartDelayMs, setRunStartDelayMs] = useState<number | undefined>(undefined);
  const [petModeSize, setPetModeSize] = useState(resolveInitialPetModeSize);
  const [fastRunBetaEnabled, setFastRunBetaEnabled] = useState(resolveInitialPetModeRunBetaEnabled);
  const [danceOnCloseBetaEnabled, setDanceOnCloseBetaEnabled] = useState(resolveInitialPetModeDanceOnCloseBetaEnabled);
  const danceOnCloseBetaEnabledRef = useRef(danceOnCloseBetaEnabled);
  danceOnCloseBetaEnabledRef.current = danceOnCloseBetaEnabled;
  const [preserveEntryLanding, setPreserveEntryLanding] = useState(false);
  const [petModeEnabled, setPetModeEnabled] = useState(initialAppearance.enabled);
  const [petVisible, setPetVisible] = useState(true);
  const [hitRegionTransitionCount, setHitRegionTransitionCount] = useState(0);
  const [hitRegionCommitRevision, setHitRegionCommitRevision] = useState(0);
  const [autonomousCycle, setAutonomousCycle] = useState(0);
  const [petOutingsEnabled] = usePetOutingPreference();
  const [presenceMode] = usePetPresenceMode();
  // True while the "drift only" cat is away off screen with no return
  // scheduled. It is the renderer-side twin of `outingTicketRef`: the ticket
  // says how to come back, this says that nobody scheduled a return.
  const [watching, setWatching] = useState(false);
  // Bumped when the retreat wait should be re-evaluated without disturbing
  // the other autonomous schedulers.
  const [retreatRevision, setRetreatRevision] = useState(0);
  const [pawFrame, setPawFrame] = useState(0);
  // Only the return from a successful Drifty-window close wears the proud
  // lids; every approach and every other walk keeps the shipped neutral face.
  const [proudWalk, setProudWalk] = useState(false);
  const [musicNoteVisible, setMusicNoteVisible] = useState(false);
  const [snapshot, setSnapshot] = useState<PetModeSnapshot | null>(null);
  const snapshotRef = useRef<PetModeSnapshot | null>(null);
  const [labLifeLoopEnabled, setLabLifeLoopEnabled] = useState(false);
  const [dragProbe, setDragProbe] = useState<PetDropPlan | null>(null);
  const [axSeatProbe, setAxSeatProbe] = useState<PetModeAxProbeDisplay | null>(null);
  // A right-click menu is anchored to the cat's current position, so the cat
  // has to stand still for as long as the menu is up.
  const [menuHolding, setMenuHolding] = useState(false);
  const [gazeOffset, setGazeOffset] = useState<PetModeGazeOffset>({ x: 0, y: 0 });
  const [manualGazeActive, setManualGazeActive] = useState(false);
  const [huntAlertVisible, setHuntAlertVisible] = useState(false);
  const [huntAlertDurationMs, setHuntAlertDurationMs] = useState(PET_MODE_DRIFT_HUNT_ALERT_MS);
  const [driftCue, setDriftCue] = useState<PetModeDriftCue>("none");
  const [sleepDriftAnnoyedContext, setSleepDriftAnnoyedContext] = useState<string | null>(null);
  const [sleepDriftPreviewExpression, setSleepDriftPreviewExpression] = useState(false);
  const [driftRetryRevision, setDriftRetryRevision] = useState(0);
  const [guidesEnabled, setGuidesEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(PET_MODE_GUIDES_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const guidesEnabledRef = useRef(guidesEnabled);
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
  const interventionSceneRef = useRef<{ id: string; token: number } | null>(null);
  const interventionRunTimingRef = useRef<{
    readonly token: number;
    readonly resolve: (timing: PetModeInterventionRunTiming) => void;
  } | null>(null);
  // The action token says only that ownership changed. These refs retain why an
  // automatic intervention lost ownership so a focus transition or renderer
  // failure can never impersonate the one destructive-action veto the user
  // controls directly: catching the cat.
  const userInterceptedInterventionTokenRef = useRef<number | null>(null);
  const contextChangedInterventionTokenRef = useRef<number | null>(null);
  const menuOpenRef = useRef(false);
  const controlsHoldingRef = useRef(false);
  const nativeQuickControlsHoldGenerationRef = useRef<number | null>(null);
  const quickControlsOpenDeniedRevisionRef = useRef(0);
  const quickControlsMenuOpenRef = useRef(false);
  const quickControlsInteractionCooldownUntilRef = useRef(0);
  const quickControlsResumeAfterInteractionRef = useRef(false);
  const labLifeLoopEnabledRef = useRef(false);
  const petModeEnabledRef = useRef(initialAppearance.enabled);
  const petOutingsEnabledRef = useRef(petOutingsEnabled);
  const appliedPetOutingsEnabledRef = useRef(petOutingsEnabled);
  const presenceModeRef = useRef(presenceMode);
  presenceModeRef.current = presenceMode;
  const watchingRef = useRef(false);
  // When the cat last had a reason to be on screen: a drift episode or a pat
  // that called it in. The retreat timer counts from here.
  const lastOnDutyAtMsRef = useRef<number | null>(null);
  // A pat on the visiting cat while focus holds asks it to leave soon.
  const dismissRequestedRef = useRef(false);
  const pendingTurnOffSuggestionRef = useRef(false);
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
  const lastSurfaceRevisionRef = useRef<number | null>(null);
  const seatReconcilePendingRef = useRef(false);
  const seatReconcileInFlightRef = useRef(false);
  const seatReconcileDisposedRef = useRef(false);
  const seatReconcileTimerRef = useRef<number | null>(null);
  const seatReconcileRetryTimerRef = useRef<number | null>(null);
  const flushSeatReconcileRef = useRef<() => void>(() => undefined);
  const axSeatProbeInFlightRef = useRef(false);
  const axSeatProbeLastStartedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const axSeatProbeRevisionRef = useRef(0);
  const strokeHoldRef = useRef(false);
  const manualReleaseTokenRef = useRef<number | null>(null);
  // A remembered manual drop cannot adopt a seated focus pose until native AX
  // has verified that the user's landing is safe. Otherwise a focus boundary
  // in the final release frames can briefly produce sit -> stand -> walk.
  const manualReleaseSeatCheckPendingRef = useRef(false);
  const manualDropReactionRef = useRef<PetModePostDropReaction | null>(null);
  const previousPostDropReactionRef = useRef<PetModePostDropReaction | null>(null);
  const dragReleasePoseRef = useRef<PetModeRestPose>("idle");
  const releaseLandingRef = useRef(false);
  const hitTargetRef = useRef<HTMLButtonElement | null>(null);
  const contactAnchorRef = useRef<HTMLSpanElement | null>(null);
  const gazeEngagedRef = useRef(false);
  const focusRestingRef = useRef(false);
  const focusRestAppliedRef = useRef(false);
  const driftHuntRef = useRef<PetModeDriftHuntState>(EMPTY_PET_MODE_DRIFT_HUNT_STATE);
  const cursorHuntActiveRef = useRef(false);
  const cursorHuntRevisionRef = useRef(0);
  const huntAlertTimerRef = useRef<number | null>(null);
  const driftCueTokenRef = useRef<number | null>(null);
  const outingTicketRef = useRef<PetModeOutingTicket | null>(null);
  const activeOutingTokenRef = useRef<number | null>(null);

  const setWatchingState = useCallback((next: boolean) => {
    watchingRef.current = next;
    setWatching(next);
  }, []);

  /**
   * Any action that pulls the away drift-only cat back onto the screen is a
   * visit: clear the away flag and its now-stale return ticket, and restart
   * the retreat wait from this moment. Without this the cat would stay on
   * screen after the action with its retreat timer and hover controls off,
   * and the next drift would enter from a stale edge ticket.
   */
  const endWatchForVisit = useCallback(() => {
    if (!watchingRef.current) return;
    setWatchingState(false);
    outingTicketRef.current = null;
    lastOnDutyAtMsRef.current = Date.now();
    dismissRequestedRef.current = false;
  }, [setWatchingState]);

  const clearHuntAlert = useCallback(() => {
    if (huntAlertTimerRef.current !== null) {
      window.clearTimeout(huntAlertTimerRef.current);
      huntAlertTimerRef.current = null;
    }
    setHuntAlertVisible(false);
  }, []);

  const showTimedHuntAlert = useCallback((visible: boolean, durationMs: number) => {
    clearHuntAlert();
    setHuntAlertDurationMs(durationMs);
    if (!visible) return;
    setHuntAlertVisible(true);
    huntAlertTimerRef.current = window.setTimeout(() => {
      huntAlertTimerRef.current = null;
      setHuntAlertVisible(false);
    }, durationMs);
  }, [clearHuntAlert]);

  useEffect(() => () => {
    if (huntAlertTimerRef.current !== null) window.clearTimeout(huntAlertTimerRef.current);
  }, []);

  const showDriftCue = useCallback((nextCue: Exclude<PetModeDriftCue, "none">, token: number) => {
    driftCueTokenRef.current = token;
    setDriftCue(nextCue);
  }, []);

  const clearDriftCue = useCallback((token: number) => {
    if (driftCueTokenRef.current !== token) return;
    driftCueTokenRef.current = null;
    setDriftCue("none");
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

  /**
   * The dance frames stand the cat taller than the panel at its 1:1 body
   * scale, so the panel borrows headroom above itself for exactly the dance
   * phase. Callers raise it before committing the pose and lower it before the
   * next pose; the phase effect below lowers it after any interruption. Native
   * also drops it on its own before motion, drag, resize, or hide, so a stale
   * lower here is a harmless no-op.
   */
  const danceHeadroomRef = useRef(false);
  const danceHeadroomGenerationRef = useRef(0);
  const invalidateDanceHeadroom = useCallback(() => {
    danceHeadroomGenerationRef.current += 1;
    const wasRaised = danceHeadroomRef.current;
    danceHeadroomRef.current = false;
    if (wasRaised) void setNativePetDanceHeadroom(false).catch(() => undefined);
  }, []);
  /**
   * A Lab action is a command, not a suggestion. Whatever the cat is doing —
   * an earlier preview, an autonomous life action, a native walk, an outing,
   * a cursor hunt, an intervention — drops here so the requested action can
   * start at once. Every in-flight sequence checks the action token, so
   * advancing it is the cancellation; the rest clears renderer-owned cues the
   * cancelled sequence would otherwise leave behind. Native travel is stopped
   * by the command itself before this event arrives.
   */
  const interruptForLabCommand = useCallback(() => {
    actionTokenRef.current += 1;
    activeOutingTokenRef.current = null;
    sleepTouchRef.current = 0;
    stopMusicNote();
    clearHuntAlert();
    if (driftCueTokenRef.current !== null) {
      driftCueTokenRef.current = null;
      setDriftCue("none");
    }
    setSleepDriftPreviewExpression(false);
    invalidateDanceHeadroom();
  }, [clearHuntAlert, invalidateDanceHeadroom, stopMusicNote]);
  const raiseDanceHeadroom = useCallback(async () => {
    const generation = ++danceHeadroomGenerationRef.current;
    try {
      await setNativePetDanceHeadroom(true);
    } catch {
      return;
    }
    if (generation !== danceHeadroomGenerationRef.current) {
      await setNativePetDanceHeadroom(false).catch(() => undefined);
      return;
    }
    danceHeadroomRef.current = true;
  }, []);
  const lowerDanceHeadroom = useCallback(async () => {
    danceHeadroomGenerationRef.current += 1;
    if (!danceHeadroomRef.current) return;
    danceHeadroomRef.current = false;
    await setNativePetDanceHeadroom(false).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (phase !== "dance") void lowerDanceHeadroom();
  }, [lowerDanceHeadroom, phase]);

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

  const commitPhase = useCallback((nextPhase: PetModeCatPhase, onCommit?: () => void) => {
    if ((timedPauseRef.current !== null || sleepingDragRef.current) && !sleepwalkRef.current) nextPhase = "sleep";
    phaseRef.current = nextPhase;
    reportLabState(nextPhase);
    const transition = ++poseTransitionRef.current;
    return new Promise<boolean>((resolve) => {
      const commit = () => {
        if (transition === poseTransitionRef.current && phaseRef.current === nextPhase) {
          renderedPhaseRef.current = nextPhase;
          // Clear the sleeping overlay in the same render that swaps to the
          // upright artwork. Clearing it earlier exposes one neutral sleeping
          // frame while the native hit region is still being staged. The
          // expression can outlive its cue during the full Dev preview, so it
          // must be cleared independently to avoid leaking into the next sleep.
          if (nextPhase !== "sleep") {
            if (driftCueTokenRef.current !== null) {
              driftCueTokenRef.current = null;
              setDriftCue("none");
            }
            setSleepDriftPreviewExpression(false);
          }
          onCommit?.();
          setPhase(nextPhase);
          setHitRegionCommitRevision((revision) => revision + 1);
          resolve(true);
          return;
        }
        resolve(false);
      };
      const reject = () => {
        if (transition === poseTransitionRef.current && phaseRef.current === nextPhase) {
          phaseRef.current = renderedPhaseRef.current;
          reportLabState(renderedPhaseRef.current);
        }
        resolve(false);
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
    });
  }, [beginHitRegionTransition, reportLabState]);

  const commitFacing = useCallback((nextFacing: "left" | "right") => {
    if ((timedPauseRef.current !== null || sleepingDragRef.current) && !sleepwalkRef.current) {
      heldSleepFacingRef.current = nextFacing;
      return;
    }
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
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void listenToNativePetQuickControlsAction((action) => {
      if (disposed || action !== "acknowledgeDismiss") return;
      quickControlsInteractionCooldownUntilRef.current = Date.now()
        + PET_QUICK_CONTROLS_ACKNOWLEDGE_COOLDOWN_MS;
      quickControlsResumeAfterInteractionRef.current = false;
      controlsHoldingRef.current = false;
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else if (nextUnlisten) unlisteners.push(nextUnlisten);
    }).catch(() => undefined);
    void listenToNativePetQuickControlsMenuState((open) => {
      if (disposed) return;
      quickControlsMenuOpenRef.current = open;
      if (open) controlsHoldingRef.current = true;
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else if (nextUnlisten) unlisteners.push(nextUnlisten);
    }).catch(() => undefined);
    void listenToNativePetQuickControlsHold((held, generation) => {
      if (disposed) return;
      if (held) {
        nativeQuickControlsHoldGenerationRef.current = generation;
      } else if (nativeQuickControlsHoldGenerationRef.current === generation) {
        nativeQuickControlsHoldGenerationRef.current = null;
      }
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else if (nextUnlisten) unlisteners.push(nextUnlisten);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      quickControlsMenuOpenRef.current = false;
      nativeQuickControlsHoldGenerationRef.current = null;
      for (const stop of unlisteners) stop();
    };
  }, []);

  useEffect(() => {
    if (phase !== "idle" && phase !== "entry") setPreserveEntryLanding(false);
  }, [phase]);

  useEffect(() => {
    if (phase === "idle" || phase === "sit" || phase === "sleep") {
      setDriftRetryRevision((revision) => revision + 1);
    }
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

  const applyPetOutingPreference = useCallback((enabled: boolean) => {
    petOutingsEnabledRef.current = enabled;
    if (appliedPetOutingsEnabledRef.current === enabled) return;
    appliedPetOutingsEnabledRef.current = enabled;
    restartAutonomousCycle();
    if (enabled) return;

    const outingToken = activeOutingTokenRef.current;
    if (outingToken === null || outingToken !== actionTokenRef.current) return;
    activeOutingTokenRef.current = null;

    const cancellationToken = ++actionTokenRef.current;
    outingTicketRef.current = null;
    void cancelNativePetMotion().catch(() => undefined).then(() => {
      // The preference governs only autonomous departures. Re-check after the
      // native cancellation so an explicit Off or one-hour hide that arrived
      // in the meantime remains authoritative. A newer action owns both pose
      // and native position, so stale outing recovery must leave it untouched.
      if (
        cancellationToken !== actionTokenRef.current
        || !petModeEnabledRef.current
        || !resolvePetModePresent()
      ) return;
      commitVisibility(true);
      void setNativePetPresence(true).catch(() => undefined);
      if (!manualDragRef.current && manualReleaseTokenRef.current === null) {
        commitPhase(timedPauseRef.current !== null ? "sleep" : focusRestingRef.current ? "sit" : "idle");
      }
    });
  }, [commitPhase, commitVisibility, restartAutonomousCycle]);

  useEffect(() => {
    applyPetOutingPreference(petOutingsEnabled);
  }, [applyPetOutingPreference, petOutingsEnabled]);

  // React can batch a rapid Off -> On pair into one final state. Listen to the
  // ordered storage snapshots as well so the intermediate opt-out still owns
  // and cancels an outing already in flight.
  useEffect(() => subscribePetOutingPreference(applyPetOutingPreference), [applyPetOutingPreference]);

  const appliedTimedPauseRef = useRef(false);
  const cancelSleepwalk = useCallback(() => {
    sleepwalkTokenRef.current += 1;
    sleepwalkRef.current = false;
    setSleepwalking(false);
    heldSleepFacingRef.current = null;
    if (sleepwalkResettleTimerRef.current !== null) {
      window.clearTimeout(sleepwalkResettleTimerRef.current);
      sleepwalkResettleTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelSleepwalk, [cancelSleepwalk]);
  useEffect(() => {
    const sleeping = timedPauseUntil !== null;
    if (!petModeEnabled) {
      appliedTimedPauseRef.current = false;
      return;
    }
    if (sleeping === appliedTimedPauseRef.current) return;
    appliedTimedPauseRef.current = sleeping;
    cancelSleepwalk();
    restartAutonomousCycle();
    sleepTouchRef.current = 0;
    petStreakRef.current = 0;
    driftHuntRef.current = suppressPetModeDriftHunt(snapshotRef.current);
    if (sleeping) {
      if (manualDragRef.current || manualReleaseTokenRef.current !== null) sleepingDragRef.current = true;
      actionTokenRef.current += 1;
      cursorHuntRevisionRef.current += 1;
      cursorHuntActiveRef.current = false;
      // A staged facing change from before the pause must not flip the cat
      // after it has fallen asleep.
      facingTransitionRef.current += 1;
      facingRef.current = renderedFacingRef.current;
      clearHuntAlert();
      stopMusicNote();
      driftCueTokenRef.current = null;
      setDriftCue("none");
      setSleepDriftAnnoyedContext(null);
      setSleepDriftPreviewExpression(false);
      setManualGazeActive(false);
      setGazeOffset({ x: 0, y: 0 });
      setPreserveEntryLanding(false);
      // An away drift-only cat keeps its return ticket so the pause can end
      // without popping it home; it simply stays away.
      if (!watchingRef.current) outingTicketRef.current = null;
      void cancelNativePetMotion().catch(() => undefined);
      if (watchingRef.current) return;
      const needsPresence = !visibleRef.current || phaseRef.current === "entry"
        || initialSleepNeedsPresenceRef.current;
      initialSleepNeedsPresenceRef.current = false;
      commitVisibility(true);
      // Revealing an outing also returns the panel home. A resident cat must
      // fall asleep where it is, including while the user is carrying it.
      if (needsPresence) void setNativePetPresence(true).catch(() => undefined);
      commitPhase("sleep");
      // An away drift-only cat has no seat to reconcile and no pose to show;
      // waking from the pause must not pull it back onto the screen.
    } else if (!sleepingDragRef.current && !watchingRef.current) {
      // The seat was held while asleep. Let the awake cat return home once
      // the upright pose has rendered.
      seatReconcilePendingRef.current = true;
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    }
  }, [cancelSleepwalk, clearHuntAlert, commitPhase, commitVisibility, petModeEnabled, restartAutonomousCycle, stopMusicNote, timedPauseUntil]);

  /** The sleepwalk arrived (or was cut short): sit up drowsily, then lie back down. */
  const finishSleepwalk = useCallback((settle: boolean) => {
    if (!sleepwalkRef.current) return;
    const token = ++sleepwalkTokenRef.current;
    heldSleepFacingRef.current = null;
    if (sleepwalkResettleTimerRef.current !== null) {
      window.clearTimeout(sleepwalkResettleTimerRef.current);
      sleepwalkResettleTimerRef.current = null;
    }
    if (!settle) {
      sleepwalkRef.current = false;
      setSleepwalking(false);
      commitPhase("sleep");
      return;
    }
    commitPhase("drowsy");
    sleepwalkResettleTimerRef.current = window.setTimeout(() => {
      sleepwalkResettleTimerRef.current = null;
      if (token !== sleepwalkTokenRef.current) return;
      sleepwalkRef.current = false;
      setSleepwalking(false);
      commitPhase("sleep");
    }, PET_MODE_DROWSY_RESETTLE_MS);
  }, [commitPhase]);

  /** Native is about to walk the sleeping cat off a control: wake it drowsily first. */
  const beginSleepwalk = useCallback(() => {
    if (sleepwalkResettleTimerRef.current !== null) {
      window.clearTimeout(sleepwalkResettleTimerRef.current);
      sleepwalkResettleTimerRef.current = null;
    }
    sleepwalkTokenRef.current += 1;
    sleepwalkRef.current = true;
    setSleepwalking(true);
    const facing = heldSleepFacingRef.current;
    heldSleepFacingRef.current = null;
    if (facing !== null) commitFacing(facing);
    // The cat gets up and walks in the same beat, eyes still heavy. The walk
    // pose stays until the seat reconcile reports arrival.
    commitPhase("walk");
  }, [commitFacing, commitPhase]);

  const updateDragReleasePose = useCallback((nextPose: PetModeRestPose) => {
    dragReleasePoseRef.current = nextPose;
    setDragReleasePose(nextPose);
  }, []);

  const suppressQuickControlsAfterInteraction = useCallback((resumeWhenStillHovered = true) => {
    quickControlsInteractionCooldownUntilRef.current = Date.now()
      + PET_QUICK_CONTROLS_INTERACTION_COOLDOWN_MS;
    quickControlsResumeAfterInteractionRef.current = resumeWhenStillHovered;
    controlsHoldingRef.current = false;
    void setNativePetQuickControlsVisible(false).catch(() => undefined);
  }, []);

  const finishManualDrag = useCallback((result?: PetModeNativeDragResult, rememberPosition = true) => {
    if (
      !manualDragRef.current
      && phaseRef.current !== "drag"
    ) return;
    suppressQuickControlsAfterInteraction();
    manualDragRef.current = false;
    setDragProbe(null);
    axSeatProbeRevisionRef.current += 1;
    setAxSeatProbe(null);
    const releaseToken = ++actionTokenRef.current;
    manualReleaseTokenRef.current = releaseToken;
    manualReleaseSeatCheckPendingRef.current = rememberPosition;
    if (sleepingDragRef.current || timedPauseRef.current !== null) {
      sleepingDragRef.current = true;
      void (async () => {
        try {
          // Keep the exact sleep drawing during native placement, including
          // shake/drop and AX correction. No pickup, fall or random reaction.
          if (!prefersReducedMotion()) await resolveNativePetDrop(false);
          if (rememberPosition) await rememberNativePetPosition(true);
        } catch (error) {
          void reportNativePetDragError(error).catch(() => undefined);
        } finally {
          if (manualReleaseTokenRef.current === releaseToken) {
            manualReleaseTokenRef.current = null;
            manualReleaseSeatCheckPendingRef.current = false;
            sleepingDragRef.current = false;
            commitPhase(timedPauseRef.current !== null ? "sleep" : focusRestingRef.current ? "sit" : "idle");
            restartAutonomousCycle();
          }
        }
      })();
      return;
    }
    const reducedMotion = prefersReducedMotion();
    const forceFloorDrop = !reducedMotion
      && result?.shakeDetected === true;
    const reaction = !reducedMotion
      ? pickPetModePostDropReaction(Math.random(), previousPostDropReactionRef.current)
      : "stay";
    manualDropReactionRef.current = reaction;
    // Keep the standing rest pose for the whole fall. Sitting too early makes a
    // falling cat look already settled; the focus-derived rest pose waits until
    // native travel has finished.
    const airbornePose: PetModeRestPose = "idle";
    dragReleasePoseRef.current = airbornePose;
    releaseLandingRef.current = false;
    let positionRemembered = false;

    void (async () => {
      try {
        if (!reducedMotion) {
          flushSync(() => {
            updateDragReleasePose(airbornePose);
            commitPhase("release");
          });
          // Native owns the fall. Keep the standing silhouette until that
          // travel returns. A remembered drop must also stay standing while
          // AX decides whether the landing is safe: sitting before a corrective
          // walk reads as an accidental sit -> stand -> walk interruption.
          const dropPlan = await resolveNativePetDrop(forceFloorDrop).catch(() => null);
          if (releaseToken !== actionTokenRef.current) return;
          const dropDurationMs = dropPlan?.durationMs ?? 0;
          const remainingSettleMs = Math.max(0, PET_MODE_DRAG_SETTLE_MS - dropDurationMs);
          const sitLeadMs = remainingSettleMs > 0 ? Math.min(remainingSettleMs, 48) : 0;
          if (remainingSettleMs > sitLeadMs) await delay(remainingSettleMs - sitLeadMs);
          if (releaseToken !== actionTokenRef.current) return;
          releaseLandingRef.current = true;
          const landedPose: PetModeRestPose = !rememberPosition
            && focusRestingRef.current
            && reaction === "stay"
            ? "sit"
            : "idle";
          if (landedPose !== airbornePose) updateDragReleasePose(landedPose);
          if (sitLeadMs > 0) await delay(sitLeadMs);
        }

        if (releaseToken !== actionTokenRef.current) return;
        commitPhase(dragReleasePoseRef.current);
        let seatResolution = null;
        if (rememberPosition) {
          // Capture the user's chosen home before a reaction walk changes the
          // native panel position. AX avoidance is part of that settlement:
          // the durable anchor remains the user's drop, while the visible cat
          // immediately walks off any control under it.
          seatResolution = await rememberNativePetPosition(
            reducedMotion,
          ).catch((error) => {
            void reportNativePetDragError(error).catch(() => undefined);
            return null;
          });
          positionRemembered = true;
        }
        if (releaseToken !== actionTokenRef.current) return;
        if (seatResolution?.moved) {
          // The corrective walk is already the visible post-drop reaction.
          // Stacking the random 84pt walk would carry the cat away from the
          // safe seat that AX just selected.
          previousPostDropReactionRef.current = "stay";
          const finalPose: PetModeRestPose = focusRestingRef.current ? "sit" : "idle";
          focusRestAppliedRef.current = finalPose === "sit";
          commitPhase(finalPose);
          restartAutonomousCycle();
          return;
        }
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
        // A pause can cancel the ordinary release before it remembers the
        // user's drop. Finish that placement without a post-drop reaction.
        if (manualReleaseTokenRef.current === releaseToken
          && sleepingDragRef.current && rememberPosition && !positionRemembered) {
          await rememberNativePetPosition(true).catch((error) => {
            void reportNativePetDragError(error).catch(() => undefined);
          });
        }
        if (manualReleaseTokenRef.current === releaseToken) {
          setManualGazeActive(false);
          manualReleaseTokenRef.current = null;
          manualReleaseSeatCheckPendingRef.current = false;
          manualDropReactionRef.current = null;
          releaseLandingRef.current = false;
          if (sleepingDragRef.current) {
            sleepingDragRef.current = false;
            commitPhase(timedPauseRef.current !== null ? "sleep" : focusRestingRef.current ? "sit" : "idle");
            restartAutonomousCycle();
          }
        }
      }
    })();
  }, [commitFacing, commitPhase, restartAutonomousCycle, suppressQuickControlsAfterInteraction, updateDragReleasePose]);

  const flushSeatReconcile = useCallback(() => {
    if (
      seatReconcileDisposedRef.current
      || !seatReconcilePendingRef.current
      || seatReconcileInFlightRef.current
    ) return;
    const startingPhase = phaseRef.current;
    const resting = startingPhase === "idle" || startingPhase === "sit" || startingPhase === "sleep";
    if (
      !petModeEnabledRef.current
      || !visibleRef.current
      || !resting
      || manualDragRef.current
      || manualReleaseTokenRef.current !== null
      || menuOpenRef.current || controlsHoldingRef.current
      || nativeQuickControlsHoldGenerationRef.current !== null
      || activeLabActionRef.current !== null
    ) return;

    seatReconcilePendingRef.current = false;
    seatReconcileInFlightRef.current = true;
    const token = actionTokenRef.current;
    // A sleeping cat only moves off a control it is covering. Returning to
    // the remembered home while asleep looked like sleepwalking, so that
    // return waits for the wake-up reconcile.
    void reconcileNativePetPosition(
      prefersReducedMotion(),
      startingPhase === "sleep",
    )
      .then((resolution) => {
        if (seatReconcileDisposedRef.current) return;
        if (
          sleepwalkRef.current
          && (resolution.reason === "motion_superseded" || token !== actionTokenRef.current)
        ) {
          // Something else took over the native window mid-sleepwalk. Under a
          // timed pause nothing else will commit a pose, so lie back down;
          // otherwise the superseding action owns the next pose.
          if (timedPauseRef.current !== null) finishSleepwalk(false);
          else cancelSleepwalk();
        }
        if (resolution.reason === "motion_superseded") {
          // The AX answer belongs to an older resting pose. Keep the request
          // pending, but let the foreground action finish before checking its
          // final seat.
          seatReconcilePendingRef.current = true;
          return;
        }
        if (token !== actionTokenRef.current) return;
        if (resolution.reason === "anchor_clear_pending") {
          if (seatReconcileRetryTimerRef.current === null) {
            seatReconcileRetryTimerRef.current = window.setTimeout(() => {
              seatReconcileRetryTimerRef.current = null;
              seatReconcilePendingRef.current = true;
              flushSeatReconcileRef.current();
            }, PET_MODE_SEAT_CLEAR_CONFIRM_MS);
          }
          return;
        }
        if (!resolution.moved) return;
        if (sleepwalkRef.current) {
          finishSleepwalk(true);
          return;
        }
        if (startingPhase === "sleep" && phaseRef.current === "sleep") return;
        const finalPose: PetModeRestPose = focusRestingRef.current ? "sit" : "idle";
        focusRestAppliedRef.current = finalPose === "sit";
        commitPhase(finalPose);
      })
      .catch((error) => {
        finishSleepwalk(false);
        void reportNativePetDragError(error).catch(() => undefined);
      })
      .finally(() => {
        seatReconcileInFlightRef.current = false;
        if (
          !seatReconcileDisposedRef.current
          && seatReconcilePendingRef.current
          && seatReconcileRetryTimerRef.current === null
        ) {
          seatReconcileRetryTimerRef.current = window.setTimeout(() => {
            seatReconcileRetryTimerRef.current = null;
            flushSeatReconcileRef.current();
          }, 0);
        }
      });
  }, [cancelSleepwalk, commitPhase, finishSleepwalk]);

  useEffect(() => {
    flushSeatReconcileRef.current = flushSeatReconcile;
  }, [flushSeatReconcile]);

  const requestSeatReconcile = useCallback(() => {
    seatReconcilePendingRef.current = true;
    if (seatReconcileTimerRef.current !== null) {
      window.clearTimeout(seatReconcileTimerRef.current);
    }
    // Let the snapshot's focus transition settle before native movement starts
    // and coalesce title churn from one app/window transition into one AX scan.
    seatReconcileTimerRef.current = window.setTimeout(() => {
      seatReconcileTimerRef.current = null;
      flushSeatReconcileRef.current();
    }, 120);
  }, []);

  useEffect(() => {
    if (seatReconcilePendingRef.current) requestSeatReconcile();
  }, [menuHolding, petModeEnabled, petVisible, phase, requestSeatReconcile]);

  useEffect(() => {
    if (!petModeEnabled || !petVisible) return undefined;
    const intervalId = window.setInterval(
      requestSeatReconcile,
      PET_MODE_SEAT_RECONCILE_INTERVAL_MS,
    );
    return () => window.clearInterval(intervalId);
  }, [petModeEnabled, petVisible, requestSeatReconcile]);

  useEffect(() => {
    seatReconcileDisposedRef.current = false;
    return () => {
      seatReconcileDisposedRef.current = true;
      seatReconcilePendingRef.current = false;
      if (seatReconcileTimerRef.current !== null) {
        window.clearTimeout(seatReconcileTimerRef.current);
      }
      if (seatReconcileRetryTimerRef.current !== null) {
        window.clearTimeout(seatReconcileRetryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetDragProbe((probe) => {
      if (disposed) return;
      setDragProbe(probe);
      if (
        !probe
        || !guidesEnabledRef.current
        || !manualDragRef.current
        || axSeatProbeInFlightRef.current
      ) return;

      const now = Date.now();
      if (now - axSeatProbeLastStartedAtRef.current < PET_MODE_AX_PROBE_INTERVAL_MS) return;
      axSeatProbeLastStartedAtRef.current = now;
      axSeatProbeInFlightRef.current = true;
      const revision = ++axSeatProbeRevisionRef.current;
      // Keep the last resolved status visible while the next bounded scan is
      // running. Replacing it with SCANNING on every probe makes the badge
      // flicker even when the seat classification is stable.
      setAxSeatProbe((current) => current ?? { kind: "scanning", label: "AX SCANNING" });
      void probeNativePetAxSeat()
        .then((resolution) => {
          if (
            disposed
            || revision !== axSeatProbeRevisionRef.current
            || !guidesEnabledRef.current
            || !manualDragRef.current
          ) return;
          setAxSeatProbe(getAxProbeDisplay(resolution));
        })
        .catch(() => {
          if (
            disposed
            || revision !== axSeatProbeRevisionRef.current
            || !guidesEnabledRef.current
            || !manualDragRef.current
          ) return;
          setAxSeatProbe({ kind: "unknown", label: "AX UNKNOWN" });
        })
        .finally(() => {
          axSeatProbeInFlightRef.current = false;
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
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetDragStart(() => {
      if (!manualDragRef.current || strokeHoldRef.current || phaseRef.current === "drag") return;
      if (timedPauseRef.current !== null || sleepingDragRef.current) return;
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
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetStrokeDetected(() => {
      strokeHoldRef.current = true;
      // A late drag-start can still arrive after the first reverse. Keep the
      // current resting pose instead of flashing the held sprite.
      if (phaseRef.current === "drag") {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
      }
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
        outingTicketRef.current = null;
        driftHuntRef.current = suppressPetModeDriftHunt(snapshotRef.current);
        driftCueTokenRef.current = null;
        setDriftCue("none");
        setSleepDriftAnnoyedContext(null);
        setSleepDriftPreviewExpression(false);
        setHuntAlertVisible(false);
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

  // Fast run is an opt-in visual beta. Keep the pet webview synchronized with
  // the user-facing settings window without adding a new native command; both
  // webviews already share localStorage for coat and size preferences.
  useEffect(() => {
    const applyFastRunBeta = () => {
      setFastRunBetaEnabled(resolveInitialPetModeRunBetaEnabled());
    };
    applyFastRunBeta();
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PET_MODE_RUN_BETA_STORAGE_KEY) return;
      applyFastRunBeta();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PET_MODE_DANCE_ON_CLOSE_BETA_STORAGE_KEY) return;
      const next = resolveInitialPetModeDanceOnCloseBetaEnabled();
      setDanceOnCloseBetaEnabled(next);
      danceOnCloseBetaEnabledRef.current = next;
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Native cursor control is owned by the Dev settings webview. Turning it off
  // is a hard safety boundary, so cancel an active stalk/carry immediately.
  // The approved visual drift reaction is independent and must stay intact;
  // an annoyed sleeping cat still wakes and reacts without moving the cursor.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== null
        && event.key !== PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY
        && event.key !== DEV_MODE_STORAGE_KEY
      ) return;
      if (resolvePetModeDriftHuntSettings().enabled) return;
      if (!cursorHuntActiveRef.current) return;
      cursorHuntActiveRef.current = false;
      cursorHuntRevisionRef.current += 1;
      clearHuntAlert();
      void cancelNativePetMotion().catch(() => undefined);
      actionTokenRef.current += 1;
      setActiveLabAction(null);
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [clearHuntAlert, commitPhase, setActiveLabAction]);

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
      if (!result.moved || result.strokeDetected) return;
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
    interventionSceneRef.current = { id: target.id, token };
    // Automatic close runs on its own schedule and can fire while the
    // drift-only cat is still away. It reveals the panel at home, so the
    // visit has to be recorded here; the retreat timer then walks the cat
    // back off screen once focus holds again after the close.
    endWatchForVisit();
    let movedToTarget = false;
    let contacted = false;
    let terminalContactReported = false;
    let technicalFailure = false;

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
      // The run and paw are the visible reason a window closes, so this scene
      // keeps its authored cadence even when the system asks for reduced
      // motion. Windows reports that whenever its Animation effects switch is
      // off, and the old 8ms paw plus native jump read as a teleport.
      const overlapsRunAndPaw = fastRunBetaEnabled;
      let resolveRunTiming: ((timing: PetModeInterventionRunTiming) => void) | null = null;
      const runTimingPromise = overlapsRunAndPaw
        ? new Promise<PetModeInterventionRunTiming>((resolve) => {
          resolveRunTiming = resolve;
        })
        : null;
      if (resolveRunTiming) {
        interventionRunTimingRef.current = { token, resolve: resolveRunTiming };
      }
      const movePromise = moveNativePetToTarget(target);
      let pawTimelineStartIndex = 0;
      let resolved: Awaited<ReturnType<typeof moveNativePetToTarget>>;
      if (runTimingPromise) {
        const first = await Promise.race([
          movePromise.then((moveResult) => ({ kind: "move" as const, moveResult })),
          runTimingPromise.then(async (timing) => {
            await delay(Math.max(
              0,
              timing.startDelayMs + timing.durationMs - PET_MODE_INTERVENTION_PAW_LEAD_MS,
            ));
            return { kind: "paw_lead" as const };
          }),
        ]);
        if (first.kind === "move") {
          resolved = first.moveResult;
          if (interventionRunTimingRef.current?.token === token) {
            interventionRunTimingRef.current = null;
          }
        } else {
          if (token !== actionTokenRef.current) return;
          setPawFrame(0);
          void commitPhase("paw");
          // These seven source frames are the near-static preparation. Playing
          // them now makes the pose develop through the final 150ms of native
          // deceleration; the first readable lift still occurs after arrival.
          for (const step of PET_MODE_PAW_TIMELINE.slice(0, PET_MODE_PAW_PREP_FRAME_COUNT)) {
            if (token !== actionTokenRef.current) return;
            await stagePetModeHitRegionTransition({
              regionId: `transition:paw:${step.frame}`,
              mirrored: facingRef.current === "left",
            });
            if (token !== actionTokenRef.current) return;
            setPawFrame(step.frame);
            await delay(step.durationUnits * 1000 / PET_MODE_PAW_FPS);
          }
          resolved = await movePromise;
          pawTimelineStartIndex = PET_MODE_PAW_PREP_FRAME_COUNT;
        }
      } else {
        resolved = await movePromise;
      }
      if (token !== actionTokenRef.current) return;
      if (resolved.targetKind === "fallback" && !target.preview) {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
        // Not a user catch: the AX scan never produced a real X to point at,
        // or native refused a hotspot it could not prove belongs to the tab
        // about to be closed. Carry the native diagnostic so the alarm's
        // debug log can distinguish "no AX geometry" from "AX highlighted a
        // different tab than the browser's active tab" after the fact.
        await reportNativePetContact(
          target.id,
          false,
          formatTargetUnavailableReason(resolved.diagnostic),
        );
        terminalContactReported = true;
        return;
      }
      if (resolved.motionOutcome !== "completed") {
        commitPhase(focusRestingRef.current ? "sit" : "idle");
        if (!target.preview) {
          await reportNativePetContact(target.id, false, "native_motion_cancelled");
          terminalContactReported = true;
        }
        return;
      }
      movedToTarget = true;
      // Native movement already lands on the authored contact point, but a
      // monitor's backing scale can leave a sub-point residual. Settle that
      // residual at arrival, where it reads as the end of the run, rather than
      // immediately before the contact frame (which made the whole cat snap
      // upward just before closing the target on Windows).
      const hitTargetRect = hitTargetRef.current?.getBoundingClientRect();
      const anchorRect = contactAnchorRef.current?.getBoundingClientRect();
      if (hitTargetRect && anchorRect) {
        const renderedAnchorX = anchorRect.left - hitTargetRect.left;
        const anchorX = renderedFacingRef.current === resolved.facing
          ? renderedAnchorX
          : hitTargetRect.width - renderedAnchorX;
        await alignNativePetContact({
          targetX: resolved.targetX,
          targetY: resolved.targetY,
          anchorX,
          anchorY: anchorRect.top - hitTargetRect.top,
          diagnostic: resolved.diagnostic,
        }).catch(() => undefined);
        if (token !== actionTokenRef.current) return;
      }
      commitFacing(resolved.facing);
      if (pawTimelineStartIndex === 0) {
        setPawFrame(0);
        void commitPhase("paw");
      }

      const unitMilliseconds = 1000 / PET_MODE_PAW_FPS;
      for (const step of PET_MODE_PAW_TIMELINE.slice(pawTimelineStartIndex)) {
        if (token !== actionTokenRef.current) return;
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
          await delay(34);
          await reportNativePetContact(target.id).catch(() => undefined);
        }
        await delay(step.durationUnits * unitMilliseconds);
      }

      if (token !== actionTokenRef.current) return;
    } catch (error) {
      technicalFailure = true;
      throw error;
    } finally {
      if (interventionSceneRef.current?.token === token) interventionSceneRef.current = null;
      if (interventionRunTimingRef.current?.token === token) interventionRunTimingRef.current = null;
      // Report exactly one terminal non-contact result. The old blanket
      // `user_intercepted` fallback also covered focus changes, native movement
      // errors, and the already-reported target-unavailable branch. That both
      // cancelled Automatic close incorrectly and could leak a duplicate event
      // into the next same-episode intervention.
      if (!contacted && !terminalContactReported && !target.preview) {
        const reason = userInterceptedInterventionTokenRef.current === token
          ? "user_intercepted"
          : contextChangedInterventionTokenRef.current === token
            ? "activity_context_changed"
            : technicalFailure
              ? "renderer_intervention_failed"
              : "renderer_action_cancelled";
        await reportNativePetContact(target.id, false, reason).catch(() => undefined);
      }
      if (userInterceptedInterventionTokenRef.current === token) {
        userInterceptedInterventionTokenRef.current = null;
      }
      if (contextChangedInterventionTokenRef.current === token) {
        contextChangedInterventionTokenRef.current = null;
      }
      const fullscreenReturnHandled = await finishNativePetFullscreenIntervention(
        target.id, token !== actionTokenRef.current,
      ).catch(() => false);
      if (token !== actionTokenRef.current) return;
      if (movedToTarget && !fullscreenReturnHandled) {
        if (contacted && danceOnCloseBetaEnabledRef.current && token === actionTokenRef.current) {
          await raiseDanceHeadroom();
          if (token !== actionTokenRef.current) return;
          commitPhase("dance");
          await delay(prefersReducedMotion() ? 40 : PET_MODE_DANCE_DURATION_MS);
          if (token !== actionTokenRef.current) return;
          // Lower before the walk home so the return trip starts from the
          // base-height panel instead of the taller dance frame.
          await lowerDanceHeadroom();
          if (token !== actionTokenRef.current) return;
        }
        // Every real successful close earns the E04 face for the walk home.
        // Approaches, failed contacts, generic previews, and Show Pet stay
        // neutral.
        const proudReturn = contacted && !target.preview;
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
  }, [commitFacing, commitPhase, endWatchForVisit, fastRunBetaEnabled, lowerDanceHeadroom, raiseDanceHeadroom, revealForAction, stopMusicNote]);

  const playOuting = useCallback(async (awayMilliseconds: number) => {
    if (!petOutingsEnabledRef.current) return;
    const token = ++actionTokenRef.current;
    activeOutingTokenRef.current = token;
    try {
      await revealForAction();
      if (token !== actionTokenRef.current || !petOutingsEnabledRef.current) return;
      commitPhase("walk");
      const outingTicket = await exitNativePetScreen();
      if (token !== actionTokenRef.current || !petOutingsEnabledRef.current) return;
      outingTicketRef.current = outingTicket;
      commitVisibility(false);
      await setNativePetPresence(false, outingTicket.generation);
      await delay(awayMilliseconds);
      if (token !== actionTokenRef.current || !petOutingsEnabledRef.current) return;
      outingTicketRef.current = null;
      commitVisibility(true);
      commitPhase("walk");
      await returnNativePetFromOuting(outingTicket);
    } finally {
      if (activeOutingTokenRef.current === token) activeOutingTokenRef.current = null;
      if (token === actionTokenRef.current && visibleRef.current) {
        outingTicketRef.current = null;
        commitPhase(focusRestingRef.current ? "sit" : "idle");
      }
    }
  }, [commitPhase, commitVisibility, revealForAction]);

  /**
   * Drift-only presence: walk off the nearest edge and stay away, exactly
   * like an outing without a return timer. If an outing already has the cat
   * away, keep it away; the retained ticket still brings it back.
   */
  const retreatToWatch = useCallback(async () => {
    if (
      watchingRef.current
      || !petModeEnabledRef.current
      || timedPauseRef.current !== null
      || manualDragRef.current
      || sleepingDragRef.current
    ) return;
    const token = ++actionTokenRef.current;
    activeOutingTokenRef.current = null;
    dismissRequestedRef.current = false;
    restartAutonomousCycle();
    clearHuntAlert();
    stopMusicNote();
    setWatchingState(true);
    if (!visibleRef.current && outingTicketRef.current !== null) return;
    try {
      await revealForAction();
      // A superseding action owns the cat and left it on screen. Clearing the
      // flag matters more than the retreat: a stuck `watching` would disable
      // both the retreat scheduler and the hover controls until the next drift.
      if (token !== actionTokenRef.current) return void setWatchingState(false);
      commitPhase("walk");
      const ticket = await exitNativePetScreen();
      if (token !== actionTokenRef.current) return void setWatchingState(false);
      outingTicketRef.current = ticket;
      commitVisibility(false);
      await setNativePetPresence(false, ticket.generation);
    } catch {
      if (token !== actionTokenRef.current) return;
      // Native declined (visibility changing, no monitor). Stay resident and
      // let the scheduler try again after the next quiet stretch.
      setWatchingState(false);
      commitVisibility(true);
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    }
  }, [clearHuntAlert, commitPhase, commitVisibility, restartAutonomousCycle, revealForAction, setWatchingState, stopMusicNote]);

  /** Bring the away cat home along the outing return path. */
  const returnFromWatch = useCallback(async () => {
    if (!watchingRef.current) return;
    const ticket = outingTicketRef.current;
    const token = ++actionTokenRef.current;
    setWatchingState(false);
    lastOnDutyAtMsRef.current = Date.now();
    dismissRequestedRef.current = false;
    restartAutonomousCycle();
    outingTicketRef.current = null;
    try {
      commitVisibility(true);
      commitPhase("walk");
      if (ticket !== null) {
        await returnNativePetFromOuting(ticket);
      } else {
        await setNativePetPresence(true);
      }
    } catch {
      // Fall through to the resident pose; native reconciles its own position.
    }
    if (token === actionTokenRef.current) {
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    }
  }, [commitPhase, commitVisibility, restartAutonomousCycle, setWatchingState]);

  const playLifeAction = useCallback(async (action: LifeAction, preview = true) => {
    if (action === "stop") {
      interruptForLabCommand();
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
      if (window.localStorage.getItem(DEV_MODE_STORAGE_KEY) !== "1") return;
      playMusicNote();
      await delay(PET_MODE_MUSIC_NOTE_DURATION_MS);
      return;
    }
    if (action === "stretch_with_note" || action === "tail_flick_with_note") {
      if (window.localStorage.getItem(DEV_MODE_STORAGE_KEY) !== "1") return;
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
      if (window.localStorage.getItem(DEV_MODE_STORAGE_KEY) !== "1") return;
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
    } else if (action === "drowsy") {
      commitPhase("drowsy");
      return;
    } else if (action === "sit") {
      commitPhase("sit");
      if (preview) return;
      await delay(randomBetween(PET_MODE_SIT_MIN_MS, PET_MODE_SIT_MAX_MS));
    } else if (action === "walk") {
      commitPhase("walk");
      await roamNativePet();
    } else {
      const phaseByAction: Record<Exclude<LifeAction, "outing" | "wake" | "sleep" | "drowsy" | "sit" | "walk" | "stop" | "life_loop" | "music_note" | "stretch_with_note" | "tail_flick_with_note" | "sleep_angry_wake">, PetModeCatPhase> = {
        blink: "blink",
        stretch: "stretch",
        tail_flick: "tail",
        dance: "dance",
        pet: "happy",
      };
      const durationByAction: Record<keyof typeof phaseByAction, number> = {
        blink: PET_MODE_BLINK_DURATION_MS,
        stretch: PET_MODE_LIFE_MOTION_DURATION_MS,
        tail_flick: PET_MODE_TAIL_FLICK_DURATION_MS,
        dance: PET_MODE_DANCE_DURATION_MS,
        pet: 1_200,
      };
      if (action === "dance") {
        await raiseDanceHeadroom();
        if (token !== actionTokenRef.current) return;
      }
      commitPhase(phaseByAction[action]);
      const guaranteedOutcomes = guaranteedOutcomesEnabled();
      if (
        (action === "stretch" || action === "tail_flick")
        && (guaranteedOutcomes
          || shouldShowPetModeMusicNote(action, Math.random()))
      ) playMusicNote();
      await delay(prefersReducedMotion() ? 40 : durationByAction[action]);
      if (action === "dance" && token === actionTokenRef.current) {
        await lowerDanceHeadroom();
      }
    }

    if (token === actionTokenRef.current) {
      commitPhase(focusRestingRef.current ? "sit" : "idle");
    }
  }, [commitPhase, commitVisibility, interruptForLabCommand, lowerDanceHeadroom, playMusicNote, playOuting, raiseDanceHeadroom, revealForAction, setLifeLoopEnabled]);

  const wakeSleepingPet = useCallback(async () => {
    const token = ++actionTokenRef.current;
    sleepTouchRef.current = 0;
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
    options: {
      allowWhileResting?: boolean;
      outingTicket?: PetModeOutingTicket | null;
    } = {},
  ) => {
    if (timedPauseRef.current !== null || sleepingDragRef.current) return;
    const focusBlocksHunt = () => !options.allowWhileResting && focusRestingRef.current;
    if (!huntSettings.enabled || focusBlocksHunt()) return;
    const cursorHuntRevision = ++cursorHuntRevisionRef.current;
    cursorHuntActiveRef.current = true;
    try {
      const outingTicket = options.outingTicket ?? null;
      const startedAsleep = outingTicket === null && phaseRef.current === "sleep";
      const token = ++actionTokenRef.current;
      restartAutonomousCycle();
      await cancelNativePetMotion().catch(() => undefined);
      const armHuntAlert = () => showTimedHuntAlert(
        huntSettings.showAlertCue,
        huntSettings.alertDurationMs,
      );

      if (outingTicket !== null) {
        // A natural outing is already hidden. Paint the committed stalk pose and
        // red alert before native reveals the panel at the cursor display edge;
        // never travel through the remembered home as an intermediate frame.
        commitFacing(outingTicket.side === "left" ? "right" : "left");
        setPreserveEntryLanding(false);
        const stalkCommitted = await commitPhase("stalk", armHuntAlert);
        if (!stalkCommitted || token !== actionTokenRef.current || focusBlocksHunt()) return;
        commitVisibility(true);
        await delay(0);
        const entry = await prepareNativePetOutingHunt(outingTicket).catch(() => null);
        if (token !== actionTokenRef.current || focusBlocksHunt()) return;
        if (entry === null) {
          // Preparation can fail after the outing timer has already yielded
          // ownership to this hunt. Recover the resident panel at home instead
          // of leaving the pet permanently hidden with no timer left to return it.
          outingTicketRef.current = null;
          clearHuntAlert();
          await setNativePetPresence(true).catch(() => undefined);
          if (token === actionTokenRef.current) {
            commitPhase(focusRestingRef.current ? "sit" : "idle");
          }
          return;
        }
        outingTicketRef.current = null;
        commitFacing(entry.facing);
      } else {
        await revealForAction().catch(() => undefined);
        if (token !== actionTokenRef.current || focusBlocksHunt()) return;
        setPreserveEntryLanding(false);

        if (startedAsleep) {
          // First let the existing sleeping drawing notice the problem: stop the
          // Zs, squint both eyes, and hold a static orange crack. Then rise
          // directly into the red exclamation/stalk with no neutral standing beat.
          sleepTouchRef.current = 0;
          showDriftCue("sleep-wake", token);
          await delay(PET_MODE_DRIFT_SLEEP_WAKE_MS);
          if (token !== actionTokenRef.current || focusBlocksHunt()) {
            clearDriftCue(token);
            return;
          }
        }

        // Start the red cue in the same committed render as the upright gait;
        // native hit-region staging must not expose it over the previous pose.
        const stalkCommitted = await commitPhase("stalk", armHuntAlert);
        if (!stalkCommitted || token !== actionTokenRef.current || focusBlocksHunt()) return;
      }

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
    } finally {
      if (cursorHuntRevision === cursorHuntRevisionRef.current) {
        cursorHuntActiveRef.current = false;
      }
    }
  }, [clearDriftCue, clearHuntAlert, commitFacing, commitPhase, commitVisibility, restartAutonomousCycle, revealForAction, showDriftCue, showTimedHuntAlert]);

  const playPassiveDriftReaction = useCallback(async () => {
    if (focusRestingRef.current) return;
    const startedAsleep = phaseRef.current === "sleep";
    const token = ++actionTokenRef.current;
    restartAutonomousCycle();
    await cancelNativePetMotion().catch(() => undefined);
    if (token !== actionTokenRef.current || focusRestingRef.current) return;
    setPreserveEntryLanding(false);

    if (startedAsleep) {
      sleepTouchRef.current = 0;
      showDriftCue("sleep-wake", token);
      await delay(PET_MODE_DRIFT_SLEEP_WAKE_MS);
      if (token !== actionTokenRef.current || focusRestingRef.current) {
        clearDriftCue(token);
        return;
      }
    }

    const stalkCommitted = await commitPhase("stalk", () => {
      showTimedHuntAlert(true, PET_MODE_DRIFT_HUNT_ALERT_MS);
    });
    if (!stalkCommitted || token !== actionTokenRef.current || focusRestingRef.current) {
      clearDriftCue(token);
      return;
    }

    // The production reaction deliberately stops at the readable upright beat.
    // Native pointer pursuit and carrying belong exclusively to Cursor control.
    await delay(PET_MODE_DRIFT_STALK_SETTLE_MS);
    if (token === actionTokenRef.current && !focusRestingRef.current) {
      commitPhase("idle");
    }
  }, [clearDriftCue, commitPhase, restartAutonomousCycle, showDriftCue, showTimedHuntAlert]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetModeEvent((event) => {
      if (event.kind === "snapshot") {
        snapshotRef.current = event.snapshot;
        setSnapshot(event.snapshot);
        setSleepDriftAnnoyedContext((annoyedContext) => (
          annoyedContext !== null
          && event.snapshot.productivity === "drift"
          && event.snapshot.contextLabel === annoyedContext
          && event.snapshot.durationSeconds >= PET_MODE_DRIFT_NOTICE_SECONDS
            ? annoyedContext
            : null
        ));
        const nextSurfaceRevision = event.snapshot.surfaceRevision;
        if (typeof nextSurfaceRevision === "number") {
          const previousSurfaceRevision = lastSurfaceRevisionRef.current;
          lastSurfaceRevisionRef.current = nextSurfaceRevision;
          if (
            previousSurfaceRevision !== null
            && previousSurfaceRevision !== nextSurfaceRevision
          ) {
            requestSeatReconcile();
          }
        }
        return;
      }
      if (event.kind === "guides") {
        guidesEnabledRef.current = event.enabled;
        if (!event.enabled) {
          axSeatProbeRevisionRef.current += 1;
          setAxSeatProbe(null);
        }
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
        outingTicketRef.current = null;
        // An explicit Show also ends a drift-only watch: the user asked to
        // see the cat, so it visits now and the retreat timer restarts.
        endWatchForVisit();
        driftHuntRef.current = {
          ...driftHuntRef.current,
          noticed: true,
          stalked: true,
          pendingAction: null,
        };
        driftCueTokenRef.current = null;
        setDriftCue("none");
        setSleepDriftAnnoyedContext(null);
        setSleepDriftPreviewExpression(false);
        setHuntAlertVisible(false);
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
      if (event.kind === "fullscreen_beat") {
        const scene = interventionSceneRef.current;
        if (scene?.id === event.id
          && scene.token === actionTokenRef.current
          && activeLabActionRef.current === "intervention"
          && petModeEnabledRef.current
          && !manualDragRef.current) {
          commitPhase(event.phase === "pause" ? "idle" : "notice");
        }
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
        if (event.purpose === "drowsy_seat_correction") {
          // Native only sends this for a seat it was asked to hold, i.e. the
          // cat was asleep. A carried cat keeps sleeping in the user's hand.
          if (manualDragRef.current || sleepingDragRef.current) return;
          if (phaseRef.current !== "sleep" && !sleepwalkRef.current) return;
          beginSleepwalk();
          return;
        }
        if (timedPauseRef.current !== null || sleepingDragRef.current) return;
        const isSeatCorrection = event.purpose === "seat_correction";
        if (
          manualDragRef.current
          || phaseRef.current === "drag"
          || phaseRef.current === "release"
        ) return;
        // Focus mode blocks autonomous wandering, but an AX safety correction
        // still needs to look like the cat noticed the obstruction and walked
        // away. Native marks only that bounded move with `seat_correction`.
        if (focusRestingRef.current && !isSeatCorrection && !automaticInterventionRef.current) return;
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
        } else if (event.motion === "run") {
          setRunTravelDistance(event.travelDistance);
          setRunDurationMs(event.durationMs);
          setRunStartDelayMs(event.startDelayMs);
          setRunSequence((sequence) => sequence + 1);
          const pendingTiming = interventionRunTimingRef.current;
          if (
            pendingTiming
            && pendingTiming.token === actionTokenRef.current
            && typeof event.durationMs === "number"
            && Number.isFinite(event.durationMs)
            && event.durationMs > 0
            && typeof event.startDelayMs === "number"
            && Number.isFinite(event.startDelayMs)
          ) {
            interventionRunTimingRef.current = null;
            pendingTiming.resolve({
              durationMs: event.durationMs,
              startDelayMs: Math.max(0, event.startDelayMs),
            });
          }
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
          // Keep the walk SVG mounted after native lands. PetModeCat finishes
          // any late final step on planted paws without swapping body canvases.
          setPreserveEntryLanding(true);
          commitPhase("idle");
        }
        if (beganANewResidence) restartAutonomousCycle();
        return;
      }
      if (event.kind === "preview_action") {
        if (timedPauseRef.current !== null || sleepingDragRef.current) return;
        const previewAction = event.action;
        const isSleepDriftNoticePreview = previewAction === "sleep_drift_notice";
        const isSleepDriftFullPreview = previewAction === "sleep_drift_full_preview";
        const isCursorHuntPreview = previewAction === "cursor_hunt_single"
          || previewAction === "cursor_hunt_chase";
        const isAdditiveAction = previewAction === "music_note" || previewAction === "life_loop";
        // The user's own hand outranks a Lab command: a cat being dragged or
        // just released stays with the pointer until that gesture finishes.
        // Everything else the cat might be doing is preempted below.
        if (
          (phaseRef.current === "drag" || phaseRef.current === "release" || manualDragRef.current)
          && !isAdditiveAction
          && previewAction !== "stop"
        ) {
          reportLabState();
          return;
        }
        if (!isAdditiveAction && previewAction !== "stop") interruptForLabCommand();
        if (isSleepDriftNoticePreview) {
          void (async () => {
            const actionRevision = setActiveLabAction(previewAction);
            const token = ++actionTokenRef.current;
            try {
              await revealForAction();
              if (token !== actionTokenRef.current) return;
              sleepTouchRef.current = 0;
              const sleepCommitted = await commitPhase("sleep");
              if (!sleepCommitted || token !== actionTokenRef.current) return;
              await delay(PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS);
              if (token !== actionTokenRef.current) return;
              setSleepDriftPreviewExpression(true);
              showDriftCue("sleep-notice", token);
              await delay(PET_MODE_DRIFT_SLEEP_NOTICE_MS);
              clearDriftCue(token);
              await delay(Math.max(
                0,
                PET_MODE_DRIFT_SLEEP_EXPRESSION_PREVIEW_MS - PET_MODE_DRIFT_SLEEP_NOTICE_MS,
              ));
            } finally {
              clearDriftCue(token);
              setSleepDriftPreviewExpression(false);
              clearActiveLabAction(actionRevision);
            }
          })();
          return;
        }
        if (isSleepDriftFullPreview) {
          void (async () => {
            const actionRevision = setActiveLabAction(previewAction);
            const token = ++actionTokenRef.current;
            try {
              await revealForAction();
              if (token !== actionTokenRef.current) return;
              sleepTouchRef.current = 0;
              const sleepCommitted = await commitPhase("sleep");
              if (!sleepCommitted || token !== actionTokenRef.current) return;
              await delay(PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS);
              if (token !== actionTokenRef.current) return;

              // Compress the real 10 s notice and 24 s escalation into one
              // deterministic visual review. This path never invokes native
              // cursor stalking or carrying.
              setSleepDriftPreviewExpression(true);
              showDriftCue("sleep-notice", token);
              await delay(PET_MODE_DRIFT_SLEEP_NOTICE_MS);
              if (token !== actionTokenRef.current) return;
              clearDriftCue(token);
              await delay(PET_MODE_DRIFT_SLEEP_FULL_PREVIEW_HOLD_MS);
              if (token !== actionTokenRef.current) return;

              showDriftCue("sleep-wake", token);
              await delay(PET_MODE_DRIFT_SLEEP_WAKE_MS);
              if (token !== actionTokenRef.current) return;

              const stalkCommitted = await commitPhase("stalk", () => {
                setHuntAlertDurationMs(PET_MODE_DRIFT_HUNT_ALERT_MS);
                setHuntAlertVisible(true);
              });
              if (!stalkCommitted || token !== actionTokenRef.current) return;
              await delay(PET_MODE_DRIFT_HUNT_ALERT_MS);
              if (token !== actionTokenRef.current) return;
              setHuntAlertVisible(false);
              await delay(PET_MODE_DRIFT_STALK_SETTLE_MS - PET_MODE_DRIFT_HUNT_ALERT_MS);
              if (token === actionTokenRef.current) {
                commitPhase(focusRestingRef.current ? "sit" : "idle");
              }
            } finally {
              if (token === actionTokenRef.current) {
                clearDriftCue(token);
                setSleepDriftPreviewExpression(false);
                setHuntAlertVisible(false);
              }
              clearActiveLabAction(actionRevision);
            }
          })();
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
      if (timedPauseRef.current !== null || sleepingDragRef.current) {
        if (!event.target.preview) void reportNativePetContact(event.target.id, false, "renderer_timed_pause").catch(() => undefined);
        return;
      }
      const isLabTarget = event.target.labTarget === "browser_tab_x"
        || event.target.labTarget === "drifty_window_x";
      // A seated focus pose is deliberately NOT a rejection reason. The alarm
      // only sends an automatic target after its own AI gate and a fresh
      // current-activity re-check, and it runs the plain close anyway when the
      // renderer rejects — so a stale seated pose could only delete the cat
      // from a close that still happened. Observed 2026-08-30: the alarm
      // confirmed the live YouTube target, this window answered
      // "renderer_focus_resting elapsedMs=19", and the tab closed with the cat
      // still sitting. An approach that starts here stays interruptible: a
      // genuine focus change still cancels it via activity_context_changed.
      const rejectionReason = activeLabActionRef.current === "intervention"
        ? "renderer_busy_intervention"
        : manualDragRef.current
          ? "renderer_manual_drag"
          : isLabTarget && phaseRef.current === "entry"
            ? "renderer_entry_active"
            : phaseRef.current === "drag" || phaseRef.current === "release"
              ? "renderer_drag_phase"
              : null;
      if (rejectionReason !== null) {
        // This guard used to drop the event silently, which the main window
        // could only observe as an 8-second contact timeout — and it then
        // misread that timeout as the user catching the cat. Reject loudly so
        // the caller can fall through to the plain close instead.
        if (!event.target.preview) {
          void reportNativePetContact(event.target.id, false, rejectionReason).catch(() => undefined);
        }
        reportLabState();
        return;
      }
      void (async () => {
        automaticInterventionRef.current = !isLabTarget && !event.target.preview;
        if (seatReconcileInFlightRef.current) {
          seatReconcilePendingRef.current = true;
        }
        const actionRevision = setActiveLabAction("intervention");
        try {
          await playIntervention(event.target);
        } catch {
          commitPhase("idle");
          void returnNativePetHome().catch(() => undefined);
        } finally {
          automaticInterventionRef.current = false;
          clearActiveLabAction(actionRevision);
          if (seatReconcilePendingRef.current) requestSeatReconcile();
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
  }, [beginSleepwalk, clearActiveLabAction, clearDriftCue, commitFacing, commitPhase, commitVisibility, endWatchForVisit, interruptForLabCommand, playCursorHunt, playIntervention, playLifeAction, reportLabState, requestSeatReconcile, restartAutonomousCycle, revealForAction, setActiveLabAction, showDriftCue]);

  useEffect(() => {
    const resting = snapshot?.productivity === "focus";
    const wasResting = focusRestingRef.current;
    focusRestingRef.current = resting;
    if (timedPauseRef.current !== null || sleepingDragRef.current) return;

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
      // Sit only during the last landing frames. A focus boundary during the
      // airborne stretch must not fold the cat up in mid-air. A remembered
      // landing also remains standing until AX has ruled out a corrective walk.
      if (phaseRef.current === "release" && releaseLandingRef.current) {
        updateDragReleasePose(
          !manualReleaseSeatCheckPendingRef.current && resting && reaction === "stay"
            ? "sit"
            : "idle",
        );
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
      // An away drift-only cat is off duty during focus; do not resurrect it
      // at home just to sit.
      if (watchingRef.current) return;
      restartAutonomousCycle();
      gazeEngagedRef.current = false;
      setGazeOffset({ x: 0, y: 0 });

      // Direct manipulation and explicit Lab previews keep ownership until
      // their normal completion; every automatic action is interruptible.
      const explicitLabPreviewOwnsMotion = activeLabActionRef.current !== null
        && !automaticInterventionRef.current;
      if (manualDragRef.current || explicitLabPreviewOwnsMotion) return;
      focusRestAppliedRef.current = true;
      clearHuntAlert();
      if (automaticInterventionRef.current && activeLabActionRef.current === "intervention") {
        contextChangedInterventionTokenRef.current = actionTokenRef.current;
      }
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
  }, [clearHuntAlert, commitPhase, commitVisibility, petModeEnabled, restartAutonomousCycle, snapshot?.productivity, updateDragReleasePose]);

  useEffect(() => {
    if (timedPauseRef.current !== null || sleepingDragRef.current) {
      driftHuntRef.current = suppressPetModeDriftHunt(snapshot);
      return;
    }
    const next = advancePetModeDriftHunt(
      driftHuntRef.current,
      snapshot,
      prefersReducedMotion(),
    );
    driftHuntRef.current = next.state;
    if (!next.action) return;
    const huntSettings = resolvePetModeDriftHuntSettings();
    const watchingAway = watchingRef.current;
    const naturallyOuting = !visibleRef.current && outingTicketRef.current !== null;
    const explicitHidden = !visibleRef.current && !naturallyOuting && !watchingAway;
    if (!PET_MODE_DRIFT_REACTION_ENABLED || !petModeEnabled || explicitHidden) {
      driftHuntRef.current = suppressPetModeDriftHunt(snapshot);
      return;
    }
    const stablePhase = naturallyOuting
      || watchingAway
      || phaseRef.current === "idle"
      || phaseRef.current === "sit"
      || phaseRef.current === "sleep";
    // Menu, direct manipulation, previews, and transient action poses keep
    // ownership. The state machine leaves the action pending, so the next
    // snapshot (or explicit retry revision) can run it after the pet settles.
    if (
      menuOpenRef.current
      || manualDragRef.current
      || activeLabActionRef.current
      || !stablePhase
    ) return;

    const action: Exclude<PetModeDriftHuntAction, null> = next.action;
    // Reduced Motion never escalates to a stalk, so the away drift-only cat
    // uses the notice as its cue to come in; there is no other beat to wait for.
    const entersFromWatch = watchingAway
      && (action === "stalk" || (action === "notice" && prefersReducedMotion()));
    if (entersFromWatch) {
      driftHuntRef.current = commitPetModeDriftHuntAction(next.state, action);
      if (action === "stalk") {
        driftHuntRef.current = { ...driftHuntRef.current, noticed: true };
      }
      lastOnDutyAtMsRef.current = Date.now();
      if (huntSettings.enabled && action === "stalk") {
        const ticket = outingTicketRef.current;
        setWatchingState(false);
        dismissRequestedRef.current = false;
        void playCursorHunt(huntSettings, { outingTicket: ticket });
        return;
      }
      void returnFromWatch().then(() => {
        if (action === "stalk") void playPassiveDriftReaction();
      });
      return;
    }
    driftHuntRef.current = commitPetModeDriftHuntAction(next.state, action);
    if (action === "stalk") {
      lastOnDutyAtMsRef.current = Date.now();
      if (huntSettings.enabled) {
        void playCursorHunt(huntSettings, {
          outingTicket: visibleRef.current ? null : outingTicketRef.current,
        });
      } else if (visibleRef.current) {
        void playPassiveDriftReaction();
      }
      // A passive reaction never resurrects a cat during its natural outing.
      // Only the explicitly enabled Cursor control may enter from off-screen.
      return;
    }

    // The early notice is intentionally silent while the cat is naturally
    // away. It still consumes only the notice budget; the later stalk can
    // enter from the cursor display edge using the retained outing ticket.
    if (!visibleRef.current) return;
    const restingPhase = phaseRef.current;
    if (restingPhase === "sleep") {
      const token = actionTokenRef.current;
      setSleepDriftAnnoyedContext(snapshot?.contextLabel ?? null);
      showDriftCue("sleep-notice", token);
      void delay(PET_MODE_DRIFT_SLEEP_NOTICE_MS).then(() => clearDriftCue(token));
      return;
    }

    const token = ++actionTokenRef.current;
    restartAutonomousCycle();
    void cancelNativePetMotion().catch(() => undefined);
    void (async () => {
      if (token !== actionTokenRef.current || focusRestingRef.current) return;
      setPreserveEntryLanding(false);
      commitPhase("notice");
      await delay(PET_MODE_DRIFT_NOTICE_MS);
      if (token === actionTokenRef.current && !focusRestingRef.current) {
        commitPhase(restingPhase === "sit" ? "sit" : "idle");
      }
    })();
  }, [clearDriftCue, commitPhase, driftRetryRevision, petModeEnabled, playCursorHunt, playPassiveDriftReaction, restartAutonomousCycle, returnFromWatch, setWatchingState, showDriftCue, snapshot]);

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
    // Drift-only presence has no spontaneous outings; away is its default.
    if (!petModeEnabled || !petOutingsEnabled || presenceMode === "drift_only" || timedPauseUntil !== null || snapshot?.productivity === "focus") return;
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
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current || controlsHoldingRef.current
          || nativeQuickControlsHoldGenerationRef.current !== null) {
          retry();
          return;
        }
        runOuting();
      }, 1_000);
    };
    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (!isCurrentCycle()) return;
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current || controlsHoldingRef.current
          || nativeQuickControlsHoldGenerationRef.current !== null) {
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
  }, [autonomousCycle, timedPauseUntil, petModeEnabled, petOutingsEnabled, playOuting, presenceMode, snapshot?.productivity]);

  // Drift-only presence, leaving the mode: an away cat comes home.
  useEffect(() => {
    if (presenceMode === "drift_only" || !watchingRef.current) return;
    void returnFromWatch();
  }, [presenceMode, returnFromWatch]);

  // Drift-only presence, the retreat scheduler. While a drift episode is
  // live the cat stays; once focus (or neutral) has held long enough after
  // its last reason to be on screen, it walks back off screen. A pat while
  // it is visiting and off duty shortens that wait.
  useEffect(() => {
    if (
      presenceMode !== "drift_only"
      || !petModeEnabled
      || watching
      || timedPauseUntil !== null
    ) return;
    if (snapshot?.productivity === "drift") {
      // The visiting cat is on duty for the whole episode. Count the retreat
      // wait from the moment drift ends, not from when it walked in.
      return () => {
        lastOnDutyAtMsRef.current = Date.now();
        dismissRequestedRef.current = false;
      };
    }
    let disposed = false;
    let timerId = 0;
    const cycle = autonomousCycle;
    const isCurrentCycle = () => (
      !disposed
      && petModeEnabledRef.current
      && presenceModeRef.current === "drift_only"
      && !watchingRef.current
      && autonomousCycleRef.current === cycle
    );
    const interruptible = () => (
      (phaseRef.current === "idle" || phaseRef.current === "sit" || phaseRef.current === "sleep")
      && !menuOpenRef.current
      && !manualDragRef.current
      && manualReleaseTokenRef.current === null
      && !controlsHoldingRef.current
      && nativeQuickControlsHoldGenerationRef.current === null
      && activeLabActionRef.current === null
      && !cursorHuntActiveRef.current
    );
    // Anchor the wait when this evaluation starts; a pat re-arms through
    // `retreatRevision`, so "now" here is the moment of the request.
    const armedAt = Date.now();
    if (lastOnDutyAtMsRef.current === null) {
      // First evaluation in this mode: leave after a short settle. Pin the
      // anchor so productivity flips cannot keep restarting that short wait.
      lastOnDutyAtMsRef.current = armedAt + PET_PRESENCE_INITIAL_RETREAT_MS - PET_PRESENCE_RETREAT_AFTER_FOCUS_MS;
    }
    const dueAt = () => {
      if (dismissRequestedRef.current) return armedAt + PET_PRESENCE_DISMISS_RETREAT_MS;
      return (lastOnDutyAtMsRef.current ?? armedAt) + PET_PRESENCE_RETREAT_AFTER_FOCUS_MS;
    };
    const arm = (delayMs: number) => {
      timerId = window.setTimeout(() => {
        if (!isCurrentCycle()) return;
        if (Date.now() < dueAt() - 250) {
          arm(Math.max(250, dueAt() - Date.now()));
          return;
        }
        if (!interruptible()) {
          arm(1_000);
          return;
        }
        void retreatToWatch();
      }, delayMs);
    };
    arm(Math.max(0, dueAt() - Date.now()));
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [autonomousCycle, petModeEnabled, presenceMode, retreatRevision, retreatToWatch, snapshot?.productivity, timedPauseUntil, watching]);

  useEffect(() => {
    if (!petModeEnabled || !petVisible || timedPauseUntil !== null || snapshot?.productivity === "focus") return;
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
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current || controlsHoldingRef.current
          || nativeQuickControlsHoldGenerationRef.current !== null) {
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
      );
      timerId = window.setTimeout(() => {
        if (!isCurrentCycle()) return;
        if (phaseRef.current !== "idle" || !visibleRef.current || menuOpenRef.current || controlsHoldingRef.current
          || nativeQuickControlsHoldGenerationRef.current !== null) {
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
  }, [autonomousCycle, timedPauseUntil, petModeEnabled, petVisible, playLifeAction, snapshot?.productivity]);

  useEffect(() => {
    if (!petModeEnabled || !petVisible || snapshot?.productivity === "focus") return undefined;
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
  }, [commitPhase, petModeEnabled, petVisible, snapshot?.productivity]);

  useEffect(() => {
    if (!petModeEnabled || !petVisible || snapshot?.productivity === "focus") return undefined;
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
  }, [commitPhase, petModeEnabled, petVisible, snapshot?.productivity]);

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
            sitGazeAnchor: pose === "sit" ? resolvePetModeSitGazeAnchor() : undefined,
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

  useEffect(() => {
    // Focus controls the cat's pose, not whether its user-facing controls are
    // reachable. Keep the seated cat hoverable while focus is active.
    if (!petModeEnabled || !petVisible) {
      quickControlsResumeAfterInteractionRef.current = false;
      controlsHoldingRef.current = false;
      void setNativePetQuickControlsVisible(false).catch(() => undefined);
      return undefined;
    }
    let disposed = false;
    let timerId = 0;
    let previousPointer: PetQuickControlsPoint | null = null;
    let intent = EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
    let publishedOpen = false;
    let closingUntilMs = 0;
    let observedDeniedRevision = quickControlsOpenDeniedRevisionRef.current;
    const blockedNow = () => manualDragRef.current
      || menuOpenRef.current
      || watchingRef.current
      || isPetQuickControlsInteractionCoolingDown(
        quickControlsInteractionCooldownUntilRef.current,
        Date.now(),
      )
      || !isPetQuickControlsHoverablePhase(phaseRef.current)
      || activeLabActionRef.current === "intervention";
    const publishVisibility = async (requestedOpen: boolean) => {
      try {
        const visible = await setNativePetQuickControlsVisible(requestedOpen);
        if (requestedOpen && !visible) quickControlsOpenDeniedRevisionRef.current += 1;
        if (!disposed) {
          const wasPublishedOpen = publishedOpen;
          publishedOpen = visible;
          closingUntilMs = !visible && !requestedOpen && wasPublishedOpen
            ? performance.now() + PET_QUICK_CONTROLS_EXIT_MS
            : 0;
          if (requestedOpen && !visible) {
            observedDeniedRevision = quickControlsOpenDeniedRevisionRef.current;
            previousPointer = null;
            intent = EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
            controlsHoldingRef.current = false;
          }
        }
      } catch {
        // Leave the published state unchanged so a transient native-window
        // failure is retried on the next poll.
        if (requestedOpen) controlsHoldingRef.current = false;
      }
    };
    const resetBlockedIntent = async () => {
      closingUntilMs = 0;
      previousPointer = null;
      intent = advancePetQuickControlsHoverIntent(intent, {
        pointerOverPet: false,
        pointerOverControls: false,
        pointerMoved: false,
        blocked: true,
      }, PET_QUICK_CONTROLS_POLL_MS);
      if (publishedOpen) await publishVisibility(false);
      closingUntilMs = 0;
      controlsHoldingRef.current = false;
    };
    const poll = async () => {
      if (disposed) return;
      if (observedDeniedRevision !== quickControlsOpenDeniedRevisionRef.current) {
        observedDeniedRevision = quickControlsOpenDeniedRevisionRef.current;
        previousPointer = null;
        intent = EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
        publishedOpen = false;
        controlsHoldingRef.current = false;
      }
      // The native menu lives outside the quick-control WebView, so cursor
      // geometry cannot tell us that the user is still interacting with it.
      // Keep both windows anchored until AppKit dismisses the menu.
      if (quickControlsMenuOpenRef.current) {
        // Native menu ownership settles/reopens a fading HUD. Keep the local
        // intent in sync so leaving after menu dismissal still closes it.
        intent = { open: true, openElapsedMs: 0, closeElapsedMs: 0 };
        publishedOpen = true;
        closingUntilMs = 0;
        controlsHoldingRef.current = true;
        timerId = window.setTimeout(() => { void poll(); }, PET_QUICK_CONTROLS_POLL_MS);
        return;
      }
      if (blockedNow()) {
        await resetBlockedIntent();
        if (!disposed) timerId = window.setTimeout(() => { void poll(); }, PET_QUICK_CONTROLS_POLL_MS);
        return;
      }
      // Preserve when the sample was requested: a native response delivered
      // after the deadline must not turn an in-flight reentry into a new dwell.
      const samplingDuringExit = performance.now() < closingUntilMs;
      const [sample, pointerOverPet, pointerOverControls] = await Promise.all([
        sampleNativePetCursor(),
        isNativePetCursorInside(),
        (intent.open || publishedOpen || samplingDuringExit)
          ? isNativePetQuickControlsCursorInside()
          : Promise.resolve(false),
      ]);
      if (disposed) return;
      // A press or autonomous phase change may start while the native samples
      // are in flight. Re-check before publishing so play can never reopen the
      // bar after it synchronously suppressed it.
      if (blockedNow()) {
        await resetBlockedIntent();
        if (!disposed) timerId = window.setTimeout(() => { void poll(); }, PET_QUICK_CONTROLS_POLL_MS);
        return;
      }
      const pointer = sample ? { x: sample.cursorX, y: sample.cursorY } : null;
      const moved = pointer ? pointerMovedEnough(previousPointer, pointer) : false;
      if (pointer) previousPointer = pointer;
      // A direct click or drag already proves that this overlap came from the
      // user, not from the roaming cat walking underneath a parked cursor.
      // Consume that provenance on the first eligible sample after cooldown so
      // a still hover can resume, while ordinary autonomous overlap continues
      // to require real pointer movement.
      const resumeAfterInteraction = quickControlsResumeAfterInteractionRef.current;
      quickControlsResumeAfterInteractionRef.current = false;
      intent = advancePetQuickControlsHoverIntent(intent, {
        pointerOverPet: Boolean(pointerOverPet),
        pointerOverControls,
        pointerMoved: moved,
        resumeAfterInteraction: resumeAfterInteraction && Boolean(pointerOverPet),
        resumeDuringExit: samplingDuringExit,
        blocked: false,
      }, PET_QUICK_CONTROLS_POLL_MS);
      // Arm before the native call and retain the hold throughout its exit so
      // the cat cannot walk away while the user is returning to the controls.
      controlsHoldingRef.current = intent.open || intent.openElapsedMs > 0 || publishedOpen || performance.now() < closingUntilMs;
      if (intent.open !== publishedOpen) {
        const requestedOpen = intent.open;
        await publishVisibility(requestedOpen);
      }
      if (disposed) return;
      controlsHoldingRef.current = intent.open || intent.openElapsedMs > 0 || performance.now() < closingUntilMs;
      const nextPollMs = performance.now() < closingUntilMs
        ? PET_QUICK_CONTROLS_EXIT_POLL_MS
        : PET_QUICK_CONTROLS_POLL_MS;
      if (!disposed) timerId = window.setTimeout(() => { void poll(); }, nextPollMs);
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      controlsHoldingRef.current = false;
      void setNativePetQuickControlsVisible(false).catch(() => undefined);
    };
  }, [petModeEnabled, petVisible]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    // The overlay is a separate, non-focusable window. It must still consume
    // every press on its hit rectangle, including while an animation is busy;
    // otherwise macOS may forward that down-event to the dashboard below it.
    event.preventDefault();
    event.stopPropagation();
    void reportNativePetPointer().catch(() => undefined);
    if (typeof event.button === "number" && event.button > 0) return;
    suppressQuickControlsAfterInteraction();
    // The annoyed wake-up is one complete relationship beat. A rapid follow-up
    // press must still be consumed by this overlay, but it cannot claim action
    // ownership: incrementing the token here would cancel the anger timer, and
    // the resolved tap would immediately replace the mark with a happy heart.
    if (phaseRef.current === "anger") return;
    if (manualDragRef.current || sleepingDragRef.current) return;
    if (automaticInterventionRef.current && activeLabActionRef.current === "intervention") {
      userInterceptedInterventionTokenRef.current = actionTokenRef.current;
    }
    const dragToken = ++actionTokenRef.current;
    manualDragRef.current = true;
    sleepingDragRef.current = timedPauseRef.current !== null;
    // Grabbing a sleepwalking cat ends the walk. Under a pause the drag
    // handler deliberately leaves the pose alone, so restore the sleeping
    // silhouette here: the carried cat looks exactly like one picked up mid-nap.
    if (sleepwalkRef.current) {
      cancelSleepwalk();
      if (sleepingDragRef.current) commitPhase("sleep");
    }
    axSeatProbeLastStartedAtRef.current = Number.NEGATIVE_INFINITY;
    strokeHoldRef.current = false;
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
          sleepingDragRef.current || prefersReducedMotion() ? 0 : PET_MODE_DRAG_PICKUP_MS,
        );
        suppressQuickControlsAfterInteraction();
        // A real pointer drag owns the pet until release. Automatic/lab actions
        // may invalidate their own token while AppKit runs its native tracking
        // loop, but they must never strand manualDragRef at true or suppress the
        // user's release transition.
        if (result.moved && !result.strokeDetected) {
          finishManualDrag(result);
          return;
        }
        manualDragRef.current = false;
        const wasSleepingDrag = sleepingDragRef.current;
        sleepingDragRef.current = false;
        axSeatProbeRevisionRef.current += 1;
        setAxSeatProbe(null);
        // Native movement never crossed the drag threshold, so this entire
        // gesture is a normal petting tap. Cancel any interrupted life pose
        // before playing the existing happy reaction, while preserving the
        // deliberate two-touch wake behavior for a sleeping cat.
        // A recognized stroke is the same relationship: the cat stayed put
        // while the pointer moved back and forth on it.
        if (wasSleepingDrag && timedPauseRef.current === null) {
          commitPhase(focusRestingRef.current ? "sit" : "idle");
          return;
        }
        if (phaseRef.current !== "sleep") {
          commitPhase(focusRestingRef.current ? "sit" : "idle");
        }
        handlePet();
      } catch (error) {
        void reportNativePetDragError(error).catch(() => undefined);
        suppressQuickControlsAfterInteraction();
        manualDragRef.current = false;
        const wasSleepingDrag = sleepingDragRef.current;
        sleepingDragRef.current = false;
        axSeatProbeRevisionRef.current += 1;
        setAxSeatProbe(null);
        if (wasSleepingDrag || dragToken === actionTokenRef.current) {
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
    suppressQuickControlsAfterInteraction(false);
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
        void triggerNativePetQuickControlsAction("openDashboard").catch(() => undefined);
      },
      onOpenSettings: () => {
        void triggerNativePetQuickControlsAction("openSettings").catch(() => undefined);
      },
      onHideForOneHour: () => {
        void triggerNativePetVisibilityAction("hideOneHour").catch(() => undefined);
      },
      onPresenceModeChange: (mode) => {
        persistPetPresenceMode(mode);
      },
      onTurnOffPet: () => {
        // Once, before the cat disappears for good, offer the quieter middle
        // step. The follow-up opens after this menu has fully closed.
        if (presenceModeRef.current === "always" && !hasSeenPetTurnOffSuggestion()) {
          pendingTurnOffSuggestionRef.current = true;
          return;
        }
        void triggerNativePetVisibilityAction("turnOff").catch(() => undefined);
      },
    }, {
      language: resolveInitialDisplayLanguage(),
      presenceMode: presenceModeRef.current,
    }).catch(() => undefined).finally(() => {
      if (pendingTurnOffSuggestionRef.current) {
        pendingTurnOffSuggestionRef.current = false;
        markPetTurnOffSuggestionSeen();
        void openNativePetTurnOffSuggestionMenu({
          onChooseDriftOnly: () => {
            persistPetPresenceMode("drift_only");
          },
          onConfirmTurnOff: () => {
            void triggerNativePetVisibilityAction("turnOff").catch(() => undefined);
          },
        }, {
          language: resolveInitialDisplayLanguage(),
        }).catch(() => undefined).finally(() => {
          menuOpenRef.current = false;
          setMenuHolding(false);
          setDriftRetryRevision((revision) => revision + 1);
        });
        return;
      }
      menuOpenRef.current = false;
      setMenuHolding(false);
      setDriftRetryRevision((revision) => revision + 1);
    });
  };

  const handlePet = () => {
    if (manualDragRef.current || timedPauseRef.current !== null || sleepingDragRef.current) return;
    if (watchingRef.current) return;
    // A pat on a visiting cat that is already off duty asks it to head back
    // out once this reaction finishes.
    if (presenceModeRef.current === "drift_only" && snapshotRef.current?.productivity !== "drift") {
      dismissRequestedRef.current = true;
      setRetreatRevision((revision) => revision + 1);
    }
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
      && phaseRef.current !== "happy"
      && phaseRef.current !== "drowsy"
    ) return;

    // Continued attention moves through a small relationship: three happy
    // hearts, drowsy lids, then sleep. Native gesture classification must not
    // change the pace: a resolved tap or stroke is one interaction either way.
    const now = Date.now();
    const continuing = now - lastPetAtRef.current <= PET_MODE_PET_STREAK_WINDOW_MS;
    petStreakRef.current = continuing ? petStreakRef.current + 1 : 1;
    lastPetAtRef.current = now;

    if (petStreakRef.current >= PET_MODE_PET_STREAK_TO_SLEEP) {
      petStreakRef.current = 0;
      void playLifeAction("sleep", false);
      return;
    }
    if (petStreakRef.current >= PET_MODE_PET_STREAK_TO_DROWSY) {
      void playLifeAction("drowsy");
      return;
    }
    void playLifeAction("pet");
  };

  const entering = phase === "entry";
  const persistentSleepDriftExpression = sleepDriftAnnoyedContext !== null
    && snapshot?.productivity === "drift"
    && snapshot.contextLabel === sleepDriftAnnoyedContext
    && snapshot.durationSeconds >= PET_MODE_DRIFT_NOTICE_SECONDS;
  const activeSleepDriftExpression = sleepDriftPreviewExpression || persistentSleepDriftExpression;
  // Once the sleeping cat notices drift, keep the orange crack and suppress
  // the normal Z until the episode clears or the upright stalk replaces it.
  // A transient wake cue still wins so the final committed beat keeps its
  // dedicated state without inserting a neutral sleeping frame.
  const renderedDriftCue: PetModeDriftCue = timedPauseUntil !== null ? "none" : driftCue !== "none"
    ? driftCue
    : phase === "sleep" && activeSleepDriftExpression
      ? "sleep-notice"
      : "none";

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
            suspended={!petModeEnabled || !petVisible}
            phase={phase}
            facing={facing}
            pawFrame={pawFrame}
            fastRunBetaEnabled={fastRunBetaEnabled}
            fastRunPawArrival={phase === "paw"
              && interventionSceneRef.current?.token === actionTokenRef.current}
            runSequence={runSequence}
            runTravelDistance={runTravelDistance}
            runDurationMs={runDurationMs}
            runStartDelayMs={runStartDelayMs}
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
            driftCue={renderedDriftCue}
            sleepDriftExpression={timedPauseUntil === null && activeSleepDriftExpression}
            dragPickupPose={dragPickupPose}
            dragReleasePose={dragReleasePose}
            proudWalk={proudWalk}
            drowsyWalk={sleepwalking}
            musicNoteVisible={musicNoteVisible}
            quietNotice={phase === "notice" && manualGazeActive}
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
          {guidesEnabled && (phase === "drag" || manualDragRef.current) && axSeatProbe ? (
            <div
              className={`pet-mode-ax-probe pet-mode-ax-probe--${axSeatProbe.kind}`}
              data-ax-status={axSeatProbe.kind}
              aria-hidden="true"
            >
              <span className="pet-mode-ax-probe-badge">{axSeatProbe.label}</span>
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

/**
 * The alarm classifies every non-contact reason that is not a user catch or
 * a context change as a technical rejection, so the base token must stay
 * `target_unavailable`. The native diagnostic rides behind a colon purely for
 * the Dev debug log; it never carries page titles, URLs, or window names.
 */
export function formatTargetUnavailableReason(diagnostic: string | null | undefined): string {
  const trimmed = diagnostic?.trim() ?? "";
  if (trimmed === "" || !/^[a-z0-9_]+$/i.test(trimmed)) return "target_unavailable";
  return `target_unavailable:${trimmed}`;
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

function getAxProbeDisplay(resolution: PetModeSeatResolution): PetModeAxProbeDisplay {
  switch (resolution.reason) {
    case "no_control_overlap":
    case "no_candidate_window":
      return { kind: "free", label: "AX FREE" };
    case "control_overlap":
      return { kind: "overlap", label: "BUTTON OVERLAP" };
    case "dense_control_strip":
    case "no_horizontal_gap":
      return { kind: "blocked", label: "NO SAFE GAP" };
    case "pet_disabled":
    case "pet_hidden":
      return { kind: "off", label: "AX OFF" };
    case "anchor_clear_pending":
    case "accessibility_unavailable":
    case "window_list_unavailable":
    case "scan_truncated":
    case "unsupported_platform":
    default:
      return { kind: "unknown", label: "AX UNKNOWN" };
  }
}
