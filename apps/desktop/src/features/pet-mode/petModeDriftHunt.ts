import type { PetModeSnapshot } from "./petModeData";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";

export const PET_MODE_DRIFT_NOTICE_SECONDS = 10;
export const PET_MODE_DRIFT_STALK_SECONDS = 24;
export const PET_MODE_DRIFT_NOTICE_MS = 1_400;
export const PET_MODE_DRIFT_STALK_SETTLE_MS = 1_200;
export const PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS = 120;
export const PET_MODE_DRIFT_CURSOR_RETURN_DISTANCE = 128;
export const PET_MODE_DRIFT_CURSOR_RETURN_TIERS = [
  { maxMovementDistance: 7, durationMs: 8_000 },
  { maxMovementDistance: 12, durationMs: 5_000 },
  { maxMovementDistance: 18, durationMs: 2_500 },
] as const;
export const PET_MODE_DRIFT_CURSOR_CAPTURE_RADIUS = 18;
export const PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY = "drifty.pet.driftHuntEnabled.v1";
export const PET_MODE_DRIFT_HUNT_MODE_STORAGE_KEY = "drifty.pet.driftHuntMode.v1";
export const PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY = "drifty.pet.driftHuntChaseDuration.v1";
export const PET_MODE_DRIFT_CHASE_SOFT_TURNS_STORAGE_KEY = "drifty.pet.driftHuntSoftTurns.v1";
export const PET_MODE_DRIFT_CHASE_DURATION_OPTIONS = [4_000, 6_000, 8_000] as const;
export const PET_MODE_DRIFT_CHASE_TURN_HYSTERESIS = 48;
export const PET_MODE_DRIFT_CHASE_TURN_COOLDOWN_MS = 500;
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
  readonly chaseDurationMs: (typeof PET_MODE_DRIFT_CHASE_DURATION_OPTIONS)[number];
  readonly softTurns: boolean;
};

export const DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS: PetModeDriftHuntSettings = {
  enabled: false,
  mode: "single",
  chaseDurationMs: 8_000,
  softTurns: true,
};

export function resolvePetModeDriftCursorReturnDuration(cursorMovementDistance: number): number {
  const normalizedDistance = Number.isFinite(cursorMovementDistance)
    ? Math.max(0, cursorMovementDistance)
    : Number.POSITIVE_INFINITY;
  const largestMovementTier = PET_MODE_DRIFT_CURSOR_RETURN_TIERS[
    PET_MODE_DRIFT_CURSOR_RETURN_TIERS.length - 1
  ];
  // Larger movement still uses the shortest tier; 2.5 seconds is the floor.
  return PET_MODE_DRIFT_CURSOR_RETURN_TIERS.find(({ maxMovementDistance }) => (
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

export function resolvePetModeDriftHuntSettings(): PetModeDriftHuntSettings {
  const devModeEnabled = readStorage(DEV_MODE_STORAGE_KEY) === "1";
  const storedEnabled = readStorage(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY);
  const storedMode = readStorage(PET_MODE_DRIFT_HUNT_MODE_STORAGE_KEY);
  const storedDuration = Number(readStorage(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY));
  const storedSoftTurns = readStorage(PET_MODE_DRIFT_CHASE_SOFT_TURNS_STORAGE_KEY);
  return {
    // Cursor mutation is a Dev-only experiment. Keep a second gate here in
    // the pet webview so a stale feature flag cannot escape after Dev mode is
    // hidden or disabled in the main window.
    enabled: devModeEnabled && storedEnabled === "true",
    mode: storedMode === "chase" ? "chase" : "single",
    chaseDurationMs: PET_MODE_DRIFT_CHASE_DURATION_OPTIONS.includes(storedDuration as 4_000 | 6_000 | 8_000)
      ? storedDuration as 4_000 | 6_000 | 8_000
      : DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS.chaseDurationMs,
    softTurns: storedSoftTurns === null
      ? DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS.softTurns
      : storedSoftTurns === "true",
  };
}

export function persistPetModeDriftHuntSettings(settings: PetModeDriftHuntSettings): void {
  try {
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, String(settings.enabled));
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_MODE_STORAGE_KEY, settings.mode);
    window.localStorage.setItem(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY, String(settings.chaseDurationMs));
    window.localStorage.setItem(PET_MODE_DRIFT_CHASE_SOFT_TURNS_STORAGE_KEY, String(settings.softTurns));
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
};

export const EMPTY_PET_MODE_DRIFT_HUNT_STATE: PetModeDriftHuntState = {
  contextLabel: null,
  lastDurationSeconds: 0,
  noticed: false,
  stalked: false,
};

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

  if (!episode.noticed && durationSeconds >= PET_MODE_DRIFT_NOTICE_SECONDS) {
    return {
      state: {
        contextLabel: snapshot.contextLabel,
        lastDurationSeconds: durationSeconds,
        noticed: true,
        stalked: episode.stalked,
      },
      action: "notice",
    };
  }

  if (
    !reducedMotion
    && episode.noticed
    && !episode.stalked
    && durationSeconds >= PET_MODE_DRIFT_STALK_SECONDS
  ) {
    return {
      state: {
        contextLabel: snapshot.contextLabel,
        lastDurationSeconds: durationSeconds,
        noticed: true,
        stalked: true,
      },
      action: "stalk",
    };
  }

  return {
    state: {
      ...episode,
      contextLabel: snapshot.contextLabel,
      lastDurationSeconds: durationSeconds,
    },
    action: null,
  };
}
