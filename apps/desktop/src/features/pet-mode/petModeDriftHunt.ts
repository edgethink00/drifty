import type { PetModeSnapshot } from "./petModeData";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";

export const PET_MODE_DRIFT_NOTICE_SECONDS = 10;
export const PET_MODE_DRIFT_STALK_SECONDS = 24;
export const PET_MODE_DRIFT_NOTICE_MS = 1_400;
/** First reaction beat before the sustained orange crack enters its hold. */
export const PET_MODE_DRIFT_SLEEP_NOTICE_MS = 820;
/** Bounded Dev preview so the sustained crack and eyelids are easy to inspect. */
export const PET_MODE_DRIFT_SLEEP_EXPRESSION_PREVIEW_MS = 2_400;
/** Establish the sleeping pose before the compressed notice begins. */
export const PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS = 650;
/** Compressed stand-in for the real 14 s between notice and escalation. */
export const PET_MODE_DRIFT_SLEEP_FULL_PREVIEW_HOLD_MS = 1_500;
/** Readable sleeping recoil before the cat rises directly into its stalk. */
export const PET_MODE_DRIFT_SLEEP_WAKE_MS = 440;
export const PET_MODE_DRIFT_STALK_SETTLE_MS = 1_200;
export const PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS = 120;
export const PET_MODE_DRIFT_HUNT_ALERT_MS = 480;
export const PET_MODE_DRIFT_CURSOR_RETURN_DISTANCE = 128;
export const PET_MODE_DRIFT_STALK_SPEED = 220;
export const PET_MODE_DRIFT_CURSOR_CAPTURE_RADIUS = 18;
export const PET_MODE_DRIFT_CURSOR_SLACK = 7;
export const PET_MODE_DRIFT_CURSOR_YANK_DISTANCE = 34;
export const PET_MODE_DRIFT_CURSOR_GRIP_MS = 420;
export const PET_MODE_DRIFT_CURSOR_LAG_MS = 0;
/**
 * The cat may spend up to this long reaching the cursor position that began a
 * chase. This is a hidden safety bound, not part of the visible chase budget.
 */
export const PET_MODE_DRIFT_APPROACH_TIMEOUT_MS = 8_000;
/** Time available only after the cursor escapes the cat's initial approach. */
export const PET_MODE_DRIFT_CHASE_DURATION_MS = 2_500;
/**
 * Carry time selected by how much the pointer resisted during the approach.
 * The defaults preserve the reviewed 6s/2s/1s behavior, while Dev tuning may
 * replace each duration without changing the resistance thresholds.
 *
 * The ordering is deliberate: a pointer left alone is carried longest, while
 * one that is already reacting is released sooner.
 */
export const PET_MODE_DRIFT_CURSOR_RETURN_TIERS = [
  { label: "무저항", maxMovementDistance: 7, durationMs: 6_000 },
  { label: "약한 저항", maxMovementDistance: 12, durationMs: 2_000 },
  { label: "강한 저항", maxMovementDistance: 18, durationMs: 1_000 },
] as const;
export const PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY = "drifty.pet.driftHuntEnabled.v1";
export const PET_MODE_DRIFT_HUNT_MODE_STORAGE_KEY = "drifty.pet.driftHuntMode.v1";
export const PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY = "drifty.pet.driftHuntChaseDuration.v1";
export const PET_MODE_DRIFT_CHASE_DURATION_REVISION_STORAGE_KEY = "drifty.pet.driftHuntChaseDurationRevision.v1";
export const PET_MODE_DRIFT_CHASE_SOFT_TURNS_STORAGE_KEY = "drifty.pet.driftHuntSoftTurns.v1";
export const PET_MODE_DRIFT_HUNT_ALERT_STORAGE_KEY = "drifty.pet.driftHuntAlertCue.v1";
export const PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY = "drifty.pet.driftHuntTuning.v1";
export const PET_MODE_DRIFT_HUNT_TUNING_REVISION_STORAGE_KEY = "drifty.pet.driftHuntTuningRevision.v1";
const PET_MODE_DRIFT_HUNT_TUNING_REVISION = "carry-6-2-1";
const PET_MODE_DRIFT_CHASE_DURATION_REVISION = "post-approach-2.5";
export const PET_MODE_DRIFT_CHASE_TURN_HYSTERESIS = 48;
export const PET_MODE_DRIFT_CHASE_TURN_COOLDOWN_MS = 500;
export const PET_MODE_DRIFT_HUNT_TUNING_RANGES = {
  chaseDurationMs: { min: 1_000, max: 8_000, step: 500 },
  stalkSpeed: { min: 80, max: 360, step: 10 },
  alertDurationMs: { min: 200, max: 1_200, step: 40 },
  biteHoldMs: { min: 0, max: 600, step: 20 },
  captureRadius: { min: 8, max: 32, step: 1 },
  carryDistance: { min: 48, max: 128, step: 8 },
  carryStillDurationMs: { min: 1_000, max: 8_000, step: 250 },
  carryNudgeDurationMs: { min: 600, max: 6_000, step: 200 },
  carryYankDurationMs: { min: 400, max: 4_000, step: 200 },
  cursorLagMs: { min: 0, max: 240, step: 20 },
  cursorSlack: { min: 2, max: 16, step: 1 },
  cursorYankDistance: { min: 20, max: 64, step: 2 },
  cursorGripMs: { min: 80, max: 1_500, step: 20 },
} as const;
// The walk SVG is fitted into the 121.2 x 92.4 cat viewport, then shifted by
// the reviewed gait registration. These are the resulting mouth-centre points
// in the 144 x 99 native panel. Cursor stalking and the review surface both use
// this one geometry instead of aiming at the panel edge or a front paw.
export const PET_MODE_CURSOR_MOUTH_X_RIGHT = 109.2;
export const PET_MODE_CURSOR_MOUTH_X_LEFT = 34.8;
export const PET_MODE_CURSOR_MOUTH_Y = 47.8;

export type PetModeDriftHuntMode = "single" | "chase";

export type PetModeDriftHuntSettings = {
  readonly enabled: boolean;
  readonly mode: PetModeDriftHuntMode;
  readonly chaseDurationMs: number;
  readonly softTurns: boolean;
  readonly showAlertCue: boolean;
  readonly stalkSpeed: number;
  readonly alertDurationMs: number;
  readonly biteHoldMs: number;
  readonly captureRadius: number;
  readonly carryDistance: number;
  readonly carryStillDurationMs: number;
  readonly carryNudgeDurationMs: number;
  readonly carryYankDurationMs: number;
  readonly cursorLagMs: number;
  readonly cursorSlack: number;
  readonly cursorYankDistance: number;
  readonly cursorGripMs: number;
};

export const DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS: PetModeDriftHuntSettings = {
  enabled: false,
  mode: "single",
  chaseDurationMs: PET_MODE_DRIFT_CHASE_DURATION_MS,
  softTurns: true,
  showAlertCue: true,
  stalkSpeed: PET_MODE_DRIFT_STALK_SPEED,
  alertDurationMs: PET_MODE_DRIFT_HUNT_ALERT_MS,
  biteHoldMs: PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS,
  captureRadius: PET_MODE_DRIFT_CURSOR_CAPTURE_RADIUS,
  carryDistance: PET_MODE_DRIFT_CURSOR_RETURN_DISTANCE,
  carryStillDurationMs: PET_MODE_DRIFT_CURSOR_RETURN_TIERS[0].durationMs,
  carryNudgeDurationMs: PET_MODE_DRIFT_CURSOR_RETURN_TIERS[1].durationMs,
  carryYankDurationMs: PET_MODE_DRIFT_CURSOR_RETURN_TIERS[2].durationMs,
  cursorLagMs: PET_MODE_DRIFT_CURSOR_LAG_MS,
  cursorSlack: PET_MODE_DRIFT_CURSOR_SLACK,
  cursorYankDistance: PET_MODE_DRIFT_CURSOR_YANK_DISTANCE,
  cursorGripMs: PET_MODE_DRIFT_CURSOR_GRIP_MS,
};

export function resolvePetModeDriftCursorReturnTiers(settings: PetModeDriftHuntSettings) {
  return PET_MODE_DRIFT_CURSOR_RETURN_TIERS.map((tier, index) => ({
    ...tier,
    durationMs: index === 0
      ? settings.carryStillDurationMs
      : index === 1
        ? settings.carryNudgeDurationMs
        : settings.carryYankDurationMs,
  }));
}

export function resolvePetModeDriftCursorReturnDuration(
  cursorMovementDistance: number,
  settings: PetModeDriftHuntSettings = DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
): number {
  const normalizedDistance = Number.isFinite(cursorMovementDistance)
    ? Math.max(0, cursorMovementDistance)
    : Number.POSITIVE_INFINITY;
  const tiers = resolvePetModeDriftCursorReturnTiers(settings);
  const largestMovementTier = tiers[tiers.length - 1];
  return tiers.find(({ maxMovementDistance }) => (
    normalizedDistance <= maxMovementDistance
  ))?.durationMs ?? largestMovementTier.durationMs;
}

function readStorage(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

type PetModeDriftHuntTuningKey = keyof typeof PET_MODE_DRIFT_HUNT_TUNING_RANGES;

function normalizeTuningValue(key: PetModeDriftHuntTuningKey, value: unknown): number {
  const range = PET_MODE_DRIFT_HUNT_TUNING_RANGES[key];
  const fallback = DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS[key];
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.min(range.max, Math.max(range.min, numeric));
  return Math.round(clamped / range.step) * range.step;
}

function readStoredTuning(): Partial<Record<PetModeDriftHuntTuningKey, number>> {
  try {
    const stored = readStorage(PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : {};
    const tuning = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Partial<Record<PetModeDriftHuntTuningKey, number>>
      : {};
    const carriesLegacyDefaults = tuning.carryStillDurationMs === 6_000
      && tuning.carryNudgeDurationMs === 3_000
      && tuning.carryYankDurationMs === 2_000;
    if (
      readStorage(PET_MODE_DRIFT_HUNT_TUNING_REVISION_STORAGE_KEY) !== PET_MODE_DRIFT_HUNT_TUNING_REVISION
      && carriesLegacyDefaults
    ) {
      const migrated = {
        ...tuning,
        carryNudgeDurationMs: PET_MODE_DRIFT_CURSOR_RETURN_TIERS[1].durationMs,
        carryYankDurationMs: PET_MODE_DRIFT_CURSOR_RETURN_TIERS[2].durationMs,
      };
      try {
        window.localStorage.setItem(PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY, JSON.stringify(migrated));
        window.localStorage.setItem(
          PET_MODE_DRIFT_HUNT_TUNING_REVISION_STORAGE_KEY,
          PET_MODE_DRIFT_HUNT_TUNING_REVISION,
        );
      } catch {
        // Use the migrated values for this session even when storage is read-only.
      }
      return migrated;
    }
    return tuning;
  } catch {
    return {};
  }
}

export function resolvePetModeDriftHuntSettings(): PetModeDriftHuntSettings {
  const devModeEnabled = readStorage(DEV_MODE_STORAGE_KEY) === "1";
  const storedEnabled = readStorage(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY);
  const storedMode = readStorage(PET_MODE_DRIFT_HUNT_MODE_STORAGE_KEY);
  const storedDuration = Number(readStorage(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY));
  const storedDurationRevision = readStorage(PET_MODE_DRIFT_CHASE_DURATION_REVISION_STORAGE_KEY);
  const storedSoftTurns = readStorage(PET_MODE_DRIFT_CHASE_SOFT_TURNS_STORAGE_KEY);
  const storedAlertCue = readStorage(PET_MODE_DRIFT_HUNT_ALERT_STORAGE_KEY);
  const tuning = readStoredTuning();
  const candidateChaseDuration = Number.isFinite(storedDuration) && storedDuration > 0
    ? storedDuration
    : tuning.chaseDurationMs;
  const carriesLegacyChaseDefault = storedDurationRevision !== PET_MODE_DRIFT_CHASE_DURATION_REVISION
    && candidateChaseDuration === 8_000;
  const chaseDurationRange = PET_MODE_DRIFT_HUNT_TUNING_RANGES.chaseDurationMs;
  const boundedChaseDuration = typeof candidateChaseDuration === "number"
    && candidateChaseDuration >= chaseDurationRange.min
    && candidateChaseDuration <= chaseDurationRange.max
    ? candidateChaseDuration
    : undefined;
  const chaseDurationMs = normalizeTuningValue(
    "chaseDurationMs",
    carriesLegacyChaseDefault ? PET_MODE_DRIFT_CHASE_DURATION_MS : boundedChaseDuration,
  );
  if (carriesLegacyChaseDefault) {
    try {
      window.localStorage.setItem(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY, String(chaseDurationMs));
      window.localStorage.setItem(
        PET_MODE_DRIFT_CHASE_DURATION_REVISION_STORAGE_KEY,
        PET_MODE_DRIFT_CHASE_DURATION_REVISION,
      );
    } catch {
      // Use the migrated value for this session even when storage is read-only.
    }
  }
  return {
    // Cursor mutation is a Dev-only experiment. Keep a second gate here in
    // the pet webview so a stale feature flag cannot escape after Dev mode is
    // hidden or disabled in the main window.
    enabled: devModeEnabled && storedEnabled === "true",
    mode: storedMode === "chase" ? "chase" : "single",
    chaseDurationMs,
    softTurns: storedSoftTurns === null
      ? DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS.softTurns
      : storedSoftTurns === "true",
    showAlertCue: storedAlertCue === null
      ? DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS.showAlertCue
      : storedAlertCue === "true",
    stalkSpeed: normalizeTuningValue("stalkSpeed", tuning.stalkSpeed),
    alertDurationMs: normalizeTuningValue("alertDurationMs", tuning.alertDurationMs),
    biteHoldMs: normalizeTuningValue("biteHoldMs", tuning.biteHoldMs),
    captureRadius: normalizeTuningValue("captureRadius", tuning.captureRadius),
    carryDistance: normalizeTuningValue("carryDistance", tuning.carryDistance),
    carryStillDurationMs: normalizeTuningValue("carryStillDurationMs", tuning.carryStillDurationMs),
    carryNudgeDurationMs: normalizeTuningValue("carryNudgeDurationMs", tuning.carryNudgeDurationMs),
    carryYankDurationMs: normalizeTuningValue("carryYankDurationMs", tuning.carryYankDurationMs),
    cursorLagMs: normalizeTuningValue("cursorLagMs", tuning.cursorLagMs),
    cursorSlack: normalizeTuningValue("cursorSlack", tuning.cursorSlack),
    cursorYankDistance: normalizeTuningValue("cursorYankDistance", tuning.cursorYankDistance),
    cursorGripMs: normalizeTuningValue("cursorGripMs", tuning.cursorGripMs),
  };
}

export function persistPetModeDriftHuntSettings(settings: PetModeDriftHuntSettings): void {
  try {
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, String(settings.enabled));
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_MODE_STORAGE_KEY, settings.mode);
    window.localStorage.setItem(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY, String(settings.chaseDurationMs));
    window.localStorage.setItem(
      PET_MODE_DRIFT_CHASE_DURATION_REVISION_STORAGE_KEY,
      PET_MODE_DRIFT_CHASE_DURATION_REVISION,
    );
    window.localStorage.setItem(PET_MODE_DRIFT_CHASE_SOFT_TURNS_STORAGE_KEY, String(settings.softTurns));
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ALERT_STORAGE_KEY, String(settings.showAlertCue));
    const tuning = Object.fromEntries(
      (Object.keys(PET_MODE_DRIFT_HUNT_TUNING_RANGES) as PetModeDriftHuntTuningKey[])
        .map((key) => [key, normalizeTuningValue(key, settings[key])]),
    );
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY, JSON.stringify(tuning));
    window.localStorage.setItem(
      PET_MODE_DRIFT_HUNT_TUNING_REVISION_STORAGE_KEY,
      PET_MODE_DRIFT_HUNT_TUNING_REVISION,
    );
  } catch {
    // The pet keeps safe defaults when storage is unavailable.
  }
}

export type PetModeDriftHuntAction = "notice" | "stalk" | null;

export type PetModeDriftHuntState = {
  readonly contextLabel: string | null;
  readonly lastDurationSeconds: number;
  readonly noticed: boolean;
  readonly stalked: boolean;
  readonly pendingAction: PetModeDriftHuntAction;
};

export const EMPTY_PET_MODE_DRIFT_HUNT_STATE: PetModeDriftHuntState = {
  contextLabel: null,
  lastDurationSeconds: 0,
  noticed: false,
  stalked: false,
  pendingAction: null,
};

export function commitPetModeDriftHuntAction(
  state: PetModeDriftHuntState,
  action: Exclude<PetModeDriftHuntAction, null>,
): PetModeDriftHuntState {
  return {
    ...state,
    noticed: true,
    stalked: action === "stalk" ? true : state.stalked,
    pendingAction: null,
  };
}

/**
 * Records the current episode as intentionally ignored. This is used for an
 * explicit hide/off so enabling the pet again does not replay stale anger.
 */
export function suppressPetModeDriftHunt(
  snapshot: PetModeSnapshot | null,
): PetModeDriftHuntState {
  if (!snapshot || snapshot.productivity !== "drift") {
    return EMPTY_PET_MODE_DRIFT_HUNT_STATE;
  }
  return {
    contextLabel: snapshot.contextLabel,
    lastDurationSeconds: Math.max(0, snapshot.durationSeconds),
    noticed: true,
    stalked: true,
    pendingAction: null,
  };
}

/**
 * Gives each continuous drift context one small escalation budget. A context
 * change or duration rewind starts a new episode; focus/neutral clears it.
 * Reduced Motion keeps the static notice but never translates the pet window.
 */
export function advancePetModeDriftHunt(
  previous: PetModeDriftHuntState,
  snapshot: PetModeSnapshot | null,
  reducedMotion: boolean,
): { readonly state: PetModeDriftHuntState; readonly action: PetModeDriftHuntAction } {
  if (!snapshot || snapshot.productivity !== "drift") {
    return { state: EMPTY_PET_MODE_DRIFT_HUNT_STATE, action: null };
  }

  const durationSeconds = Math.max(0, snapshot.durationSeconds);
  const newEpisode = previous.contextLabel !== snapshot.contextLabel
    || durationSeconds < previous.lastDurationSeconds;
  const episode = newEpisode
    ? { ...EMPTY_PET_MODE_DRIFT_HUNT_STATE, contextLabel: snapshot.contextLabel }
    : previous;

  // A snapshot can first observe an episode after both thresholds have passed.
  // The strongest due action must win or the notice consumes this refresh and
  // the stalk cannot run until another snapshot happens to arrive.
  if (
    !reducedMotion
    && !episode.stalked
    && durationSeconds >= PET_MODE_DRIFT_STALK_SECONDS
  ) {
    const state = {
      ...episode,
      contextLabel: snapshot.contextLabel,
      lastDurationSeconds: durationSeconds,
      pendingAction: "stalk" as const,
    };
    return {
      state,
      action: state.pendingAction,
    };
  }

  if (!episode.noticed && durationSeconds >= PET_MODE_DRIFT_NOTICE_SECONDS) {
    const state = {
      ...episode,
      contextLabel: snapshot.contextLabel,
      lastDurationSeconds: durationSeconds,
      pendingAction: "notice" as const,
    };
    return { state, action: state.pendingAction };
  }

  const pendingAction = reducedMotion && episode.pendingAction === "stalk"
    ? (!episode.noticed ? "notice" : null)
    : episode.pendingAction;
  return {
    state: {
      ...episode,
      contextLabel: snapshot.contextLabel,
      lastDurationSeconds: durationSeconds,
      pendingAction,
    },
    action: pendingAction,
  };
}
