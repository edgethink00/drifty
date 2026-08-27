import type { CompanionDayReviewLayout } from "./companionPillLayout";

/** Persistent visibility for the resident Companion. */
export const COMPANION_PILL_STORAGE_KEY = "drifty.companion.enabled.v1";
export const LEGACY_COMPANION_PILL_STORAGE_KEY = "drifty.dev.companionPillEnabled";
export const COMPANION_SURFACE_POLICY_STORAGE_KEY = "drifty.companion.surfacePolicy.v1";
export const COMPANION_DAY_REVIEW_LAYOUT_STORAGE_KEY = "drifty.dev.companion.dayReviewLayout.v1";

/** Stored user preference for the production resident Companion. */
export type CompanionResidentPreference = "menuBar" | "off";
/** Effective native surface after temporary and Dev-only overrides. */
export type CompanionSurfacePolicy = "floating" | "menuBar" | "momentsOnly";

export const COMPANION_SURFACE_POLICY_DEFAULT: CompanionResidentPreference = "menuBar";
export const COMPANION_DAY_REVIEW_LAYOUT_DEFAULT: CompanionDayReviewLayout = "minimal";
export const COMPANION_PILL_DEFAULT_ENABLED = true;

/** A timestamp keeps a temporary hide reliable across an app restart. */
export const COMPANION_HIDDEN_UNTIL_STORAGE_KEY = "drifty.companion.hiddenUntil.v1";
export const COMPANION_HIDE_ONE_HOUR_MS = 60 * 60 * 1000;

export function resolveInitialCompanionSurfacePolicy(): CompanionResidentPreference {
  if (typeof window === "undefined") return COMPANION_SURFACE_POLICY_DEFAULT;
  try {
    const storedPolicy = window.localStorage.getItem(COMPANION_SURFACE_POLICY_STORAGE_KEY);
    if (storedPolicy === "off") return "off";
    if (storedPolicy === "menuBar" || storedPolicy === "floating") return "menuBar";

    const legacyEnabled = window.localStorage.getItem(COMPANION_PILL_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_COMPANION_PILL_STORAGE_KEY);
    return legacyEnabled === "false" ? "off" : COMPANION_SURFACE_POLICY_DEFAULT;
  } catch {
    return COMPANION_SURFACE_POLICY_DEFAULT;
  }
}

export function persistCompanionSurfacePolicy(
  policy: CompanionResidentPreference,
): CompanionResidentPreference {
  if (typeof window === "undefined") return policy;
  try {
    window.localStorage.setItem(COMPANION_SURFACE_POLICY_STORAGE_KEY, policy);
    // Preserve the legacy boolean so downgrading cannot unexpectedly revive a
    // Companion the user explicitly turned off.
    window.localStorage.setItem(COMPANION_PILL_STORAGE_KEY, policy === "off" ? "false" : "true");
  } catch {
    // Runtime state still changes when storage is unavailable.
  }
  return policy;
}

export function resolveInitialCompanionPillEnabled(): boolean {
  return resolveInitialCompanionSurfacePolicy() !== "off";
}

export function persistCompanionPillEnabled(enabled: boolean): boolean {
  return persistCompanionSurfacePolicy(enabled ? "menuBar" : "off") !== "off";
}

/**
 * The public preference controls only the resident Companion. Drift decisions,
 * alerts, and celebrations still use the compact Companion card when the
 * resident surface is hidden, so disabling it never revives the retired
 * full-screen alarm.
 */
export function resolveEffectiveCompanionSurfacePolicy(
  preference: CompanionResidentPreference,
  floatingDevActive: boolean,
  temporarilyHidden: boolean,
): CompanionSurfacePolicy {
  if (temporarilyHidden) return "momentsOnly";
  if (floatingDevActive) return "floating";
  return preference === "off" ? "momentsOnly" : "menuBar";
}

export function resolveInitialCompanionDayReviewLayout(): CompanionDayReviewLayout {
  if (typeof window === "undefined") return COMPANION_DAY_REVIEW_LAYOUT_DEFAULT;
  try {
    const stored = window.localStorage.getItem(COMPANION_DAY_REVIEW_LAYOUT_STORAGE_KEY);
    return stored === "full" || stored === "compact" || stored === "minimal"
      ? stored
      : COMPANION_DAY_REVIEW_LAYOUT_DEFAULT;
  } catch {
    return COMPANION_DAY_REVIEW_LAYOUT_DEFAULT;
  }
}

export function persistCompanionDayReviewLayout(
  layout: CompanionDayReviewLayout,
): CompanionDayReviewLayout {
  if (typeof window === "undefined") return layout;
  try {
    window.localStorage.setItem(COMPANION_DAY_REVIEW_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Runtime state still changes when storage is unavailable.
  }
  return layout;
}

export function resolveInitialCompanionHiddenUntil(now = Date.now()): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(COMPANION_HIDDEN_UNTIL_STORAGE_KEY);
    if (stored === null) return null;
    const hiddenUntil = Number(stored);
    if (!Number.isFinite(hiddenUntil) || hiddenUntil <= now) {
      window.localStorage.removeItem(COMPANION_HIDDEN_UNTIL_STORAGE_KEY);
      return null;
    }
    return hiddenUntil;
  } catch {
    return null;
  }
}

export function persistCompanionHiddenUntil(hiddenUntil: number | null): number | null {
  if (typeof window === "undefined") return hiddenUntil;
  try {
    if (hiddenUntil === null) {
      window.localStorage.removeItem(COMPANION_HIDDEN_UNTIL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(COMPANION_HIDDEN_UNTIL_STORAGE_KEY, String(hiddenUntil));
    }
  } catch {
    // Runtime state still changes when storage is unavailable.
  }
  return hiddenUntil;
}
