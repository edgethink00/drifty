import type { ActivitySegment, ProductivityLabel } from "@drifty/domain";
import type { WatcherSnapshot } from "../companion/watcherData";

// The pet shipped as a Dev preview, so its settings lived under `drifty.dev.*`.
// Now that it is a production feature the keys drop that prefix, and the old
// ones are still read once so an existing preview user keeps their pet and
// their chosen coat instead of silently reverting to the defaults.
export const PET_MODE_STORAGE_KEY = "drifty.pet.enabled";
export const PET_MODE_COAT_STORAGE_KEY = "drifty.pet.coat";
export const PET_MODE_LEGACY_STORAGE_KEY = "drifty.dev.petMode";
export const PET_MODE_LEGACY_COAT_STORAGE_KEY = "drifty.dev.petModeCoat";
/** A timestamp keeps a temporary hide reliable across an app restart. */
export const PET_MODE_HIDDEN_UNTIL_STORAGE_KEY = "drifty.pet.hiddenUntil.v1";
export const PET_MODE_HIDE_ONE_HOUR_MS = 60 * 60 * 1000;
export const PET_MODE_PRESENCE_RATIO = 0.6;
export const PET_MODE_PRESENT_MS = 9 * 60 * 1000;
export const PET_MODE_AWAY_MS = 6 * 60 * 1000;
export const PET_MODE_LIFE_ACTION_INTERVAL_MS = 12 * 60 * 1000;
// Sitting and sleeping are long holds, so the scheduler cannot keep using one
// flat interval: after a settled pose the pet should consider its next move
// sooner than it would after standing around.
export const PET_MODE_SETTLED_ACTION_INTERVAL_MS = 100 * 1000;
export const PET_MODE_SIT_MIN_MS = 2.5 * 60 * 1000;
export const PET_MODE_SIT_MAX_MS = 7 * 60 * 1000;
export const PET_MODE_SLEEP_MIN_MS = 5 * 60 * 1000;
export const PET_MODE_SLEEP_MAX_MS = 14 * 60 * 1000;
// Petting in a streak reads as sustained attention rather than repeated taps.
// Four pets inside the window settle the cat; the window is short enough that
// coming back an hour later starts a new streak instead of resuming the old one.
export const PET_MODE_PET_STREAK_WINDOW_MS = 6 * 1000;
export const PET_MODE_PET_STREAK_TO_SLEEP = 4;
// The expressive interaction pack is intentionally Dev-gated while its
// product rules are being calibrated. A second key (rather than Dev mode by
// itself) lets reviewers compare the shipped cat and the experiment without
// leaving the diagnostics surface.
export const PET_MODE_EXPERIMENTS_STORAGE_KEY = "drifty.dev.petModeExperiments.v1";
// Dev-only override for repeatedly QAing the pack's visible probability
// outcomes. It affects only angry wake and music-note rolls, not life-action
// selection or timing. The renderer also checks Dev mode itself, so a
// persisted toggle cannot change production behavior after Dev mode is off.
export const PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY = "drifty.dev.petModeGuaranteedOutcomes.v1";
// Waking a sleeping cat can earn a brief annoyed beat. The roll happens only
// on the second sleep touch, never on ordinary petting or the touch that merely
// checks whether the cat wants to stay asleep.
export const PET_MODE_SLEEP_WAKE_ANGER_CHANCE = 0.25;
export const PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS = 1_200;
// A music note is a rare good-mood accent, not another default idle effect.
// It can accompany the two relaxed life motions and uses the same reviewed
// one-shot timing as the existing heart.
export const PET_MODE_MUSIC_NOTE_CHANCE = 0.05;
export const PET_MODE_MUSIC_NOTE_DURATION_MS = 760;
// The pet's approved geometry is 144x99 with the cat drawn at 121.2x92.4
// inside it. Size is expressed as a percentage of that reviewed layout so the
// cat, its hit target, and the native panel all scale by one factor instead of
// each carrying its own numbers.
export const PET_MODE_BASE_WIDTH = 144;
export const PET_MODE_BASE_HEIGHT = 99;
export const PET_MODE_WALK_SPEED = 20.8;
export const PET_MODE_WALK_STRIDE = 26;
export const PET_MODE_RUN_SPEED = 300;
export const PET_MODE_RUN_STRIDE = 72;
export const PET_MODE_STALK_SPEED = 220;
export const PET_MODE_STALK_STRIDE = 62;
export const PET_MODE_RETURN_SPEED = 96 / 0.92;
export const PET_MODE_RETURN_STRIDE = 48;
export const PET_MODE_GAIT_CADENCE = 0.9;
export const PET_MODE_GAIT_FRAME_COUNT = 30;
export const PET_MODE_HOME_EDGE_INSET = 24;
// Native translation duration only. The hidden pre-paint hold and renderer
// handoff happen before this clock starts. Default-home travel at 100% size is
// one short run at PET_MODE_RUN_SPEED; farther remembered homes still finish
// inside the max so Show Pet never turns into a cross-screen walk.
export const PET_MODE_ENTRY_MIN_DURATION_MS = 180;
export const PET_MODE_ENTRY_MAX_DURATION_MS = 700;
export const PET_MODE_ENTRY_DURATION_MS = 482;
// Reach running speed quickly, hold it for most of the entrance, then reserve
// a slightly longer slowdown for an exact, quiet landing.
export const PET_MODE_ENTRY_ACCELERATION_RATIO = 0.1;
export const PET_MODE_ENTRY_DECELERATION_RATIO = 0.18;
// In the 144-point base panel, all idle and registered gait silhouettes leave
// at least this much transparent leading-edge gutter. Native scales it with
// the selected pet size and keeps one extra base point outside the display to
// prevent antialiasing from flashing a stationary face before movement.
export const PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX = 24.329;
export const PET_MODE_ENTRY_HIDDEN_SAFETY_PX = 1;
// Native completion is authoritative. This grace only recovers a renderer that
// missed the native completion event during cold start or HMR.
export const PET_MODE_ENTRY_FALLBACK_GRACE_MS = 500;
// The traced walk vector and the canonical idle raster use different source
// canvases. In the fixed 121.2×92.4 cat box, the last walk-frames-v2 frame sits
// 3.76px above paw/f001.png. Align those measured visible foot lines so
// completing a walk never drops the cat toward the desktop.
export const PET_MODE_GAIT_BASELINE_SHIFT_PX = 3.76;
// Alpha-bound measurement in the fixed cat box puts the final walk silhouette
// at x=60.292px and the canonical idle silhouette at x=53.909px. Shift the
// vector in its local coordinate space; the root facing mirror then reverses
// this offset automatically without a direction-specific branch.
export const PET_MODE_GAIT_CENTER_SHIFT_PX = -6.383;
// One complete upper-lid pass: close, a very short contact, then reopen.
// Keeping the phase and CSS animation on one shared duration prevents the
// overlay from being removed before the opening frame has finished.
export const PET_MODE_BLINK_DURATION_MS = 228;
export const PET_MODE_BLINK_INTERVAL_MIN_MS = 4_420;
export const PET_MODE_BLINK_INTERVAL_MAX_MS = 7_280;
export type PetModeDragTransitionFrame = {
  readonly pose: "idle" | "held";
  readonly y: number;
  readonly opacity: number;
  readonly durationMs: number;
};

// Approved V10.1 drag hand-off. These are deliberately discrete reviewed
// frames rather than a CSS morph: the generated held pose must retain its
// contour while the native window changes ownership to and from AppKit.
// Opacity stays pinned at 1 on the visible layer for the same reason as the
// release timeline below: the pet renders inside a transparent native window,
// so any translucent committed frame lets the desktop bleed through the body
// and reads as a brightness flicker instead of a softening.
export const PET_MODE_DRAG_PICKUP_TIMELINE: readonly PetModeDragTransitionFrame[] = [
  { pose: "idle", y: 0, opacity: 1, durationMs: 0 },
  { pose: "idle", y: -1, opacity: 1, durationMs: 18 },
  { pose: "idle", y: -2, opacity: 1, durationMs: 18 },
  { pose: "held", y: -3, opacity: 1, durationMs: 16 },
  { pose: "held", y: -4, opacity: 1, durationMs: 18 },
  { pose: "held", y: -4, opacity: 1, durationMs: 18 },
  { pose: "held", y: -4, opacity: 1, durationMs: 18 },
  { pose: "held", y: -4, opacity: 1, durationMs: 20 },
  { pose: "held", y: -4, opacity: 1, durationMs: 22 },
] as const;

// The release is rendered as two stacked layers (held above, rest below), so
// `opacity` here is the composite silhouette floor, not a per-layer ramp. The
// earlier per-layer ramp (.72 → .55) let both layers be translucent at the
// same time; over a transparent native window the desktop showed through and
// the cat visibly darkened for ~40ms ("release brightness valley"). The rest
// layer now reaches full opacity beneath the still-opaque held layer before
// the held layer starts fading, so the overlapped silhouette never drops
// below 1 at any point of the drop.
export const PET_MODE_DRAG_RELEASE_TIMELINE: readonly PetModeDragTransitionFrame[] = [
  { pose: "held", y: -4, opacity: 1, durationMs: 0 },
  { pose: "held", y: -3, opacity: 1, durationMs: 16 },
  { pose: "held", y: -2, opacity: 1, durationMs: 16 },
  { pose: "held", y: -1, opacity: 1, durationMs: 18 },
  { pose: "held", y: 0, opacity: 1, durationMs: 18 },
  { pose: "idle", y: 0, opacity: 1, durationMs: 18 },
  { pose: "idle", y: 0, opacity: 1, durationMs: 20 },
  { pose: "idle", y: 0, opacity: 1, durationMs: 22 },
  { pose: "idle", y: 0, opacity: 1, durationMs: 28 },
] as const;

export const PET_MODE_DRAG_PICKUP_MS = PET_MODE_DRAG_PICKUP_TIMELINE.reduce(
  (total, frame) => total + frame.durationMs,
  0,
);
export const PET_MODE_DRAG_SETTLE_MS = PET_MODE_DRAG_RELEASE_TIMELINE.reduce(
  (total, frame) => total + frame.durationMs,
  0,
);
// Tail and stretch use cleaned frames from selected Google Flow Omni Flash
// takes. Every active take starts and ends on the exact approved idle bitmap,
// preventing a full-silhouette snap at either hand-off.
export const PET_MODE_LIFE_MOTION_FPS = 12;
export const PET_MODE_LIFE_MOTION_FRAME_COUNT = 37;
export const PET_MODE_LIFE_MOTION_DURATION_MS = PET_MODE_LIFE_MOTION_FRAME_COUNT * 1000 / PET_MODE_LIFE_MOTION_FPS;
export const PET_MODE_TAIL_FLICK_DURATION_MS = PET_MODE_LIFE_MOTION_DURATION_MS;
// Locked to the approved prototype's F12 v1.6 action. The cat reaches on
// source frames 0…14, contacts on 14, then returns over the same clean arc.
// Keep this as data rather than a CSS tween so every rendered pose remains a
// reviewed source frame.
export const PET_MODE_PAW_FPS = 24;
export const PET_MODE_PAW_CONTACT_FRAME = 14;
export const PET_MODE_PAW_TIMELINE = [
  ...Array.from({ length: PET_MODE_PAW_CONTACT_FRAME + 1 }, (_, frame) => ({ frame, durationUnits: 1 })),
  ...Array.from({ length: PET_MODE_PAW_CONTACT_FRAME }, (_, offset) => ({
    frame: PET_MODE_PAW_CONTACT_FRAME - 1 - offset,
    durationUnits: 0.75,
  })),
] as const;

export type PetModeMotionKind = "entry" | "walk" | "run" | "stalk" | "return";

export type PetModePreviewAction =
  | "stop"
  | "life_loop"
  | "walk"
  | "blink"
  | "stretch"
  | "tail_flick"
  | "music_note"
  | "stretch_with_note"
  | "tail_flick_with_note"
  | "sleep_angry_wake"
  | "sleep"
  | "sit"
  | "wake"
  | "pet"
  | "outing"
  | "cursor_hunt_single"
  | "cursor_hunt_chase";

export function shouldShowPetModeMusicNote(
  action: PetModePreviewAction,
  roll: number,
  expressiveInteractionsEnabled: boolean,
): boolean {
  return expressiveInteractionsEnabled
    && (action === "stretch" || action === "tail_flick")
    && roll >= 0
    && roll < PET_MODE_MUSIC_NOTE_CHANCE;
}

export type PetModeLabAction = PetModePreviewAction | "intervention";

export type PetModeLabState = {
  readonly phase: string;
  readonly activeAction: PetModeLabAction | null;
  readonly lifeLoopEnabled: boolean;
};

export type PetModeSnapshot = {
  readonly productivity: ProductivityLabel;
  readonly contextLabel: string;
  readonly durationSeconds: number;
};

export type PetModeInterventionTarget = {
  readonly id: string;
  readonly appName: string;
  readonly browserName: string | null;
  readonly preview: boolean;
  readonly labTarget?: "browser_tab_x" | "drifty_window_x" | null;
};

export type PetModeWindowEvent =
  | { readonly kind: "snapshot"; readonly snapshot: PetModeSnapshot }
  | { readonly kind: "facing"; readonly facing: "left" | "right" }
  | {
    readonly kind: "motion";
    readonly motion: PetModeMotionKind;
    readonly travelDistance?: number;
    readonly durationMs?: number;
  }
  | { readonly kind: "entry_complete" }
  | { readonly kind: "preview_action"; readonly action: PetModePreviewAction }
  | { readonly kind: "intervention"; readonly target: PetModeInterventionTarget }
  | { readonly kind: "guides"; readonly enabled: boolean };

export type PetModeResolvedTarget = {
  readonly facing: "left" | "right";
  readonly targetKind: "browser_tab_close" | "window_close" | "fallback";
  readonly confidence: "high" | "medium" | "low";
  readonly diagnostic: string;
  readonly targetX: number;
  readonly targetY: number;
};

export type PetModeContactAlignment = {
  readonly targetX: number;
  readonly targetY: number;
  readonly contactX: number;
  readonly contactY: number;
  readonly errorX: number;
  readonly errorY: number;
  readonly errorDistance: number;
  readonly attempts: number;
  readonly diagnostic: string;
};

export function getPetModeGaitStride(motion: PetModeMotionKind): number {
  const stride = motion === "walk"
    ? PET_MODE_WALK_STRIDE
    : motion === "return"
      ? PET_MODE_RETURN_STRIDE
    : motion === "stalk"
      ? PET_MODE_STALK_STRIDE
      : PET_MODE_RUN_STRIDE;
  return stride / PET_MODE_GAIT_CADENCE;
}

export function getPetModeGaitFramesPerSecond(motion: PetModeMotionKind): number {
  const speed = motion === "walk"
    ? PET_MODE_WALK_SPEED
    : motion === "return"
      ? PET_MODE_RETURN_SPEED
    : motion === "stalk"
      ? PET_MODE_STALK_SPEED
      : PET_MODE_RUN_SPEED;
  return PET_MODE_GAIT_FRAME_COUNT * speed / getPetModeGaitStride(motion);
}

export function getPetModeEntryVisibleWidth(petWidth = PET_MODE_BASE_WIDTH): number {
  return petWidth * (PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX - PET_MODE_ENTRY_HIDDEN_SAFETY_PX) / PET_MODE_BASE_WIDTH;
}

export function getPetModeDefaultEntryTravelDistance(petWidth = PET_MODE_BASE_WIDTH): number {
  return petWidth + PET_MODE_HOME_EDGE_INSET - getPetModeEntryVisibleWidth(petWidth);
}

export function getPetModeEntryMaxTravelDistance(petWidth = PET_MODE_BASE_WIDTH): number {
  return Math.max(
    getPetModeDefaultEntryTravelDistance(petWidth),
    PET_MODE_RUN_SPEED * PET_MODE_ENTRY_MAX_DURATION_MS / 1000,
  );
}

export function getPetModeEntryDurationMs(travelDistance: number): number {
  if (!Number.isFinite(travelDistance) || travelDistance <= 0) return PET_MODE_ENTRY_DURATION_MS;
  return Math.round(
    Math.min(
      PET_MODE_ENTRY_MAX_DURATION_MS,
      Math.max(PET_MODE_ENTRY_MIN_DURATION_MS, travelDistance / PET_MODE_RUN_SPEED * 1000),
    ),
  );
}

export function resolvePetModeEntryDurationMs(
  travelDistance?: number,
  durationMs?: number,
): number {
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.round(durationMs);
  }
  if (typeof travelDistance === "number" && Number.isFinite(travelDistance) && travelDistance > 0) {
    return getPetModeEntryDurationMs(travelDistance);
  }
  return PET_MODE_ENTRY_DURATION_MS;
}

export function getPetModeClampedEntryTravelDistance(
  travelDistance: number,
  petWidth = PET_MODE_BASE_WIDTH,
): number {
  if (!Number.isFinite(travelDistance) || travelDistance <= 0) {
    return getPetModeDefaultEntryTravelDistance(petWidth);
  }
  return Math.min(travelDistance, getPetModeEntryMaxTravelDistance(petWidth));
}

export function getPetModeEntryProgress(
  elapsedMilliseconds: number,
  durationMs = PET_MODE_ENTRY_DURATION_MS,
): number {
  const duration = durationMs > 0 ? durationMs : PET_MODE_ENTRY_DURATION_MS;
  const linearProgress = Math.min(
    1,
    Math.max(0, elapsedMilliseconds) / duration,
  );
  const accelerationDuration = PET_MODE_ENTRY_ACCELERATION_RATIO;
  const decelerationDuration = PET_MODE_ENTRY_DECELERATION_RATIO;
  const decelerationStart = 1 - decelerationDuration;
  const cruiseDuration = decelerationStart - accelerationDuration;
  // The unscaled area under the velocity profile: two triangular ramps plus
  // the constant-speed plateau. Dividing by it guarantees a final progress of 1.
  const travelArea = accelerationDuration / 2 + cruiseDuration + decelerationDuration / 2;

  if (linearProgress < accelerationDuration) {
    return linearProgress * linearProgress / (2 * accelerationDuration * travelArea);
  }
  if (linearProgress < decelerationStart) {
    const distance = accelerationDuration / 2 + linearProgress - accelerationDuration;
    return distance / travelArea;
  }

  const decelerationElapsed = linearProgress - decelerationStart;
  const distanceBeforeDeceleration = accelerationDuration / 2 + cruiseDuration;
  const decelerationDistance = decelerationElapsed
    - decelerationElapsed * decelerationElapsed / (2 * decelerationDuration);
  return (distanceBeforeDeceleration + decelerationDistance) / travelArea;
}

export function getPetModeGaitFrameIndex(
  motion: PetModeMotionKind,
  elapsedMilliseconds: number,
  frameCount = PET_MODE_GAIT_FRAME_COUNT,
  options?: {
    readonly travelDistance?: number;
    readonly durationMs?: number;
    readonly sizeScale?: number;
  },
): number {
  if (!Number.isInteger(frameCount) || frameCount < 1) return 0;
  if (motion === "entry") {
    // Native X uses this same travel profile. Advancing the gait from actual
    // distance, not a single 0-1 cycle, keeps the paws planted at run stride.
    const sizeScale = options?.sizeScale && options.sizeScale > 0 ? options.sizeScale : 1;
    const petWidth = PET_MODE_BASE_WIDTH * sizeScale;
    const travelDistance = getPetModeClampedEntryTravelDistance(
      options?.travelDistance ?? getPetModeDefaultEntryTravelDistance(petWidth),
      petWidth,
    );
    const durationMs = resolvePetModeEntryDurationMs(travelDistance, options?.durationMs);
    const distance = getPetModeEntryProgress(elapsedMilliseconds, durationMs) * travelDistance;
    const stride = getPetModeGaitStride("run") * sizeScale;
    return Math.floor(distance / stride * frameCount) % frameCount;
  }
  const rawFrame = Math.floor(
    Math.max(0, elapsedMilliseconds) * getPetModeGaitFramesPerSecond(motion) / 1000,
  );
  return rawFrame % frameCount;
}

export function getPetModeLifeActionInterval(productivity: ProductivityLabel | null): number {
  // B3 stays intentionally subtle: focused work only makes autonomous actions
  // rarer. It never changes the pet's mood or creates a reward/punishment loop.
  return adjustPetModeIntervalForFocus(PET_MODE_LIFE_ACTION_INTERVAL_MS, productivity);
}

/**
 * How long to wait before rolling the next autonomous action.
 *
 * A pet that just stood back up should not wait another full cycle before it
 * does anything, or the settled poses read as isolated events instead of a
 * rhythm. Coming out of sit/sleep the pet reconsiders sooner.
 */
export function getPetModeNextActionInterval(
  productivity: ProductivityLabel | null,
  previousAction: PetModeLifeAction | null,
): number {
  const base = previousAction === "sit" || previousAction === "sleep"
    ? PET_MODE_SETTLED_ACTION_INTERVAL_MS
    : PET_MODE_LIFE_ACTION_INTERVAL_MS;
  return adjustPetModeIntervalForFocus(base, productivity);
}

function adjustPetModeIntervalForFocus(
  interval: number,
  productivity: ProductivityLabel | null,
): number {
  return productivity === "focus" ? interval * 1.65 : interval;
}

export type PetModeLifeAction = "walk" | "stretch" | "sit" | "sleep";

/**
 * Autonomous action weights, conditioned on the pose the pet is already in.
 *
 * The scheduler used to draw uniformly from a flat list, so the previous pose
 * had no influence and the cat spent most of its visible time standing. A cat
 * settles in stages instead: it sits first, and sleep is far more likely from
 * a sit than from standing. Weights are relative within each row.
 */
const PET_MODE_ACTION_WEIGHTS: Record<"standing" | "sitting", Record<PetModeLifeAction, number>> = {
  // From standing, sitting is the natural next step and sleep is unusual: a cat
  // settles in stages rather than dropping from four feet straight into a nap.
  standing: { walk: 3, stretch: 2, sit: 6, sleep: 1 },
  // Already settled. Dozing off is the likely continuation, but a sit that does
  // not become a nap should usually stay a sit instead of standing back up,
  // which is what keeps the settled pose on screen for a meaningful share.
  sitting: { walk: 2, stretch: 1, sit: 3, sleep: 6 },
};

export function pickPetModeLifeAction(
  posture: "standing" | "sitting",
  random: number,
): PetModeLifeAction {
  const weights = PET_MODE_ACTION_WEIGHTS[posture];
  const actions = Object.keys(weights) as PetModeLifeAction[];
  const total = actions.reduce((sum, action) => sum + weights[action], 0);
  let cursor = Math.min(Math.max(random, 0), 0.999_999) * total;
  for (const action of actions) {
    cursor -= weights[action];
    if (cursor < 0) return action;
  }
  return "sit";
}

export function resolveInitialPetModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(PET_MODE_STORAGE_KEY);
  if (stored !== null) return stored === "1";
  return window.localStorage.getItem(PET_MODE_LEGACY_STORAGE_KEY) === "1";
}

/**
 * A one-hour hide is deliberately separate from the on/off preference: the pet
 * stays enabled, so it returns on its own instead of being silently lost to a
 * user who only wanted it out of the way for a screen share.
 */
export function resolveInitialPetModeHiddenUntil(now = Date.now()): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY);
    if (stored === null) return null;
    const hiddenUntil = Number(stored);
    /* A hide is only ever one hour long. Anything further out came from a
       corrupted write or a clock that moved backwards, and honouring it would
       retire the pet for years with no visible way back: the account-menu
       toggle already reads on, so the user has nothing left to switch. Treat an
       impossible deadline as no hide at all. */
    if (
      !Number.isFinite(hiddenUntil)
      || hiddenUntil <= now
      || hiddenUntil > now + PET_MODE_HIDE_ONE_HOUR_MS
    ) {
      window.localStorage.removeItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY);
      return null;
    }
    return hiddenUntil;
  } catch {
    return null;
  }
}

export function persistPetModeHiddenUntil(hiddenUntil: number | null): number | null {
  if (typeof window === "undefined") return hiddenUntil;
  try {
    if (hiddenUntil === null) {
      window.localStorage.removeItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(hiddenUntil));
    }
  } catch {
    // Runtime state still changes when storage is unavailable.
  }
  return hiddenUntil;
}

/**
 * The pet is present only when it is both enabled and not temporarily hidden.
 *
 * Both webviews must agree on this, and neither may read the raw `enabled` key
 * alone. The pet window mirrors the toggle so its autonomous timers stop aging
 * behind a hidden panel; a temporary hide has to enter that same path, or a
 * restart during the hidden hour would replay the entry walk for a cat the user
 * just put away.
 */
export function resolvePetModePresent(now = Date.now()): boolean {
  return resolveInitialPetModeEnabled() && resolveInitialPetModeHiddenUntil(now) === null;
}

// The prototype shipped the cat as a themed pair: its light theme used a
// charcoal coat with ivory facial detail, and its dark theme inverted both.
// The native pet lost that pairing when the silhouette moved to baked
// rasters, so the coat is an explicit user choice here instead of a theme
// side effect. `ivory` keeps the exact colors the current pet already ships.
export const PET_MODE_COATS = ["ivory", "charcoal", "grey", "apricot", "sage", "plum"] as const;
export type PetModeCoat = (typeof PET_MODE_COATS)[number];
export const PET_MODE_DEFAULT_COAT: PetModeCoat = "ivory";

export function isPetModeCoat(value: unknown): value is PetModeCoat {
  return typeof value === "string" && (PET_MODE_COATS as readonly string[]).includes(value);
}

// One definition per coat, shared by the pet window and the Settings picker.
// `fur` is the same value the CSS token carries, so the swatch always shows
// the color the pet will actually be instead of a hand-maintained copy.
export type PetModeCoatSpec = {
  readonly value: PetModeCoat;
  readonly fur: string;
  readonly ink: string;
};

export const PET_MODE_COAT_SPECS: readonly PetModeCoatSpec[] = [
  {
    value: "ivory",
    fur: "#e8e5da",
    ink: "#171916",
  },
  {
    value: "charcoal",
    fur: "#33332f",
    ink: "#f2f1ed",
  },
  {
    value: "grey",
    fur: "#a3a199",
    ink: "#1a1b18",
  },
  {
    value: "apricot",
    fur: "#d9b18c",
    ink: "#3c2b1c",
  },
  {
    value: "sage",
    fur: "#93a88e",
    ink: "#1c241a",
  },
  {
    value: "plum",
    fur: "#7a5f6b",
    ink: "#efe6ea",
  },
];

export function getPetModeCoatSpec(coat: PetModeCoat): PetModeCoatSpec {
  return PET_MODE_COAT_SPECS.find((spec) => spec.value === coat) ?? PET_MODE_COAT_SPECS[0];
}

export const PET_MODE_SIZES = [50, 75, 100, 125] as const;
export type PetModeSize = (typeof PET_MODE_SIZES)[number];
export const PET_MODE_DEFAULT_SIZE: PetModeSize = 100;
export const PET_MODE_SIZE_STORAGE_KEY = "drifty.pet.size";
export const PET_MODE_GUIDES_STORAGE_KEY = "drifty.pet.guides";

export function isPetModeSize(value: unknown): value is PetModeSize {
  return typeof value === "number" && (PET_MODE_SIZES as readonly number[]).includes(value);
}

export function resolveInitialPetModeSize(): PetModeSize {
  if (typeof window === "undefined") return PET_MODE_DEFAULT_SIZE;
  const stored = Number(window.localStorage.getItem(PET_MODE_SIZE_STORAGE_KEY));
  return isPetModeSize(stored) ? stored : PET_MODE_DEFAULT_SIZE;
}

export function getPetModeWindowSize(size: PetModeSize): { readonly width: number; readonly height: number } {
  // Rounded to whole points: the native panel cannot occupy a fraction of a
  // pixel, and letting the window round independently of the CSS scale would
  // clip the cat's outline at some sizes.
  return {
    width: Math.round(PET_MODE_BASE_WIDTH * size / 100),
    height: Math.round(PET_MODE_BASE_HEIGHT * size / 100),
  };
}

export function resolveInitialPetModeCoat(): PetModeCoat {
  if (typeof window === "undefined") return PET_MODE_DEFAULT_COAT;
  const stored = window.localStorage.getItem(PET_MODE_COAT_STORAGE_KEY);
  if (isPetModeCoat(stored)) return stored;
  const legacy = window.localStorage.getItem(PET_MODE_LEGACY_COAT_STORAGE_KEY);
  return isPetModeCoat(legacy) ? legacy : PET_MODE_DEFAULT_COAT;
}

export function buildPetModeSnapshot(snapshot: WatcherSnapshot): PetModeSnapshot {
  return {
    productivity: snapshot.productivity,
    contextLabel: snapshot.contextLabel,
    durationSeconds: snapshot.durationSeconds,
  };
}

export function buildPetModeInterventionTarget(input: {
  readonly id: string;
  readonly appName: string;
  readonly browserName?: string | null;
  readonly preview?: boolean;
  readonly labTarget?: "browser_tab_x" | "drifty_window_x" | null;
}): PetModeInterventionTarget {
  return {
    id: input.id,
    appName: input.appName.trim() || "Unknown app",
    browserName: input.browserName?.trim() || null,
    preview: input.preview ?? false,
    labTarget: input.labTarget ?? null,
  };
}

type PetModePreviewSegment = Pick<
  ActivitySegment,
  "id" | "endedAt" | "appName" | "browserName" | "deviceId" | "source"
>;

export function buildPetModePreviewInterventionTarget(
  segments: readonly PetModePreviewSegment[],
): PetModeInterventionTarget | null {
  let latestBrowser: PetModePreviewSegment | null = null;
  let latestEndedAt = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    if (segment.deviceId) continue;
    if (segment.source === "browser-history-import") continue;
    if (!segment.browserName?.trim()) continue;
    if (segment.appName.trim().toLowerCase().includes("drifty")) continue;

    const endedAt = Date.parse(segment.endedAt);
    if (!Number.isFinite(endedAt) || endedAt <= latestEndedAt) continue;
    latestBrowser = segment;
    latestEndedAt = endedAt;
  }

  if (!latestBrowser) return null;
  return buildPetModeInterventionTarget({
    id: `pet-preview:${latestBrowser.id}:${Date.now()}`,
    appName: latestBrowser.appName,
    browserName: latestBrowser.browserName,
    preview: true,
  });
}

/**
 * Dev settings bring Drifty to the foreground, so the Lab deliberately uses
 * the last locally observed browser as the target it can return to and test.
 */
export function buildPetModeLabBrowserTabTarget(
  segments: readonly PetModePreviewSegment[],
): PetModeInterventionTarget | null {
  let latestBrowser: PetModePreviewSegment | null = null;
  let latestEndedAt = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    if (segment.deviceId) continue;
    if (segment.source === "browser-history-import") continue;
    if (!segment.browserName?.trim()) continue;
    if (segment.appName.trim().toLowerCase().includes("drifty")) continue;

    const endedAt = Date.parse(segment.endedAt);
    if (!Number.isFinite(endedAt) || endedAt <= latestEndedAt) continue;
    latestBrowser = segment;
    latestEndedAt = endedAt;
  }

  if (!latestBrowser) return null;
  return buildPetModeInterventionTarget({
    id: `pet-lab-browser-x:${latestBrowser.id}:${Date.now()}`,
    appName: latestBrowser.appName,
    browserName: latestBrowser.browserName,
    labTarget: "browser_tab_x",
  });
}

export function buildPetModeLabDriftyWindowTarget(): PetModeInterventionTarget {
  return buildPetModeInterventionTarget({
    id: `pet-lab-drifty-x:${Date.now()}`,
    appName: "Drifty",
    labTarget: "drifty_window_x",
  });
}
