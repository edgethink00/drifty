import {
  automaticCloseOverrideIsExpired,
  buildAutomaticCloseOverride,
  type AutomaticCloseOverride,
} from "../companion/automaticCloseOverride";

/** Hiding the pet pauses closes for at least an hour without shortening a chosen break. */
export function buildPetModeHidePause(
  current: AutomaticCloseOverride | null,
  nowMs = Date.now(),
): AutomaticCloseOverride {
  const pause = buildAutomaticCloseOverride(false, "60", nowMs);
  if (
    current
    && !current.enabled
    && !automaticCloseOverrideIsExpired(current, nowMs)
    && (current.endsAtMs === null || current.endsAtMs >= pause.endsAtMs!)
  ) return current;
  return pause;
}
