import type { TrayDisplayMode } from "@drifty/domain";
import type { CompanionDayReviewLayout } from "./companionPillLayout";

/** Persistent visibility for the resident Companion. */
export const COMPANION_PILL_STORAGE_KEY = "drifty.companion.enabled.v1";
export const LEGACY_COMPANION_PILL_STORAGE_KEY = "drifty.dev.companionPillEnabled";
export const COMPANION_SURFACE_POLICY_STORAGE_KEY = "drifty.companion.surfacePolicy.v1";
export const COMPANION_MENU_BAR_DISPLAY_STORAGE_KEY = "drifty.companion.menuBarDisplay.v1";
export const COMPANION_DAY_REVIEW_LAYOUT_STORAGE_KEY = "drifty.dev.companion.dayReviewLayout.v1";

/** The menu bar is the calm default; the desktop pill remains an alternative. */
export type CompanionSurfacePolicy = "floating" | "menuBar" | "off";

export const COMPANION_SURFACE_POLICY_DEFAULT: CompanionSurfacePolicy = "menuBar";
export const COMPANION_MENU_BAR_DISPLAY_DEFAULT: TrayDisplayMode = "focusTime";
export const COMPANION_DAY_REVIEW_LAYOUT_DEFAULT: CompanionDayReviewLayout = "minimal";
export const COMPANION_PILL_DEFAULT_ENABLED = true;

export const COMPANION_SURFACE_POLICY_OPTIONS: ReadonlyArray<{
  readonly value: CompanionSurfacePolicy;
  readonly label: string;
}> = [
  { value: "floating", label: "Floating" },
  { value: "menuBar", label: "Menu bar" },
  { value: "off", label: "Off" },
];

export const COMPANION_MENU_BAR_DISPLAY_OPTIONS: ReadonlyArray<{
  readonly value: TrayDisplayMode;
  readonly label: string;
}> = [
  { value: "donut", label: "Donut" },
  { value: "focusTime", label: "Focus time" },
  { value: "donutFocusTime", label: "Donut + focus time" },
];

/** A timestamp keeps a temporary hide reliable across an app restart. */
export const COMPANION_HIDDEN_UNTIL_STORAGE_KEY = "drifty.companion.hiddenUntil.v1";
export const COMPANION_HIDE_ONE_HOUR_MS = 60 * 60 * 1000;

export function resolveInitialCompanionSurfacePolicy(): CompanionSurfacePolicy {
  if (typeof window === "undefined") return COMPANION_SURFACE_POLICY_DEFAULT;
  try {
    const storedPolicy = window.localStorage.getItem(COMPANION_SURFACE_POLICY_STORAGE_KEY);
    if (isCompanionSurfacePolicy(storedPolicy)) return storedPolicy;

    const legacyEnabled = window.localStorage.getItem(COMPANION_PILL_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_COMPANION_PILL_STORAGE_KEY);
    return legacyEnabled === "false" ? "off" : COMPANION_SURFACE_POLICY_DEFAULT;
  } catch {
    return COMPANION_SURFACE_POLICY_DEFAULT;
  }
}

export function persistCompanionSurfacePolicy(policy: CompanionSurfacePolicy): CompanionSurfacePolicy {
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
 * A disabled beta must be indistinguishable from the released legacy path at
 * the native bridge. Passing `off` closes the Companion panel and makes watcher
 * events use their legacy windows instead.
 */
export function resolveEffectiveCompanionSurfacePolicy(
  betaActive: boolean,
  policy: CompanionSurfacePolicy,
  temporarilyHidden: boolean,
): CompanionSurfacePolicy {
  return !betaActive || temporarilyHidden ? "off" : policy;
}

export function resolveInitialCompanionMenuBarDisplayMode(): TrayDisplayMode {
  if (typeof window === "undefined") return COMPANION_MENU_BAR_DISPLAY_DEFAULT;
  try {
    const stored = window.localStorage.getItem(COMPANION_MENU_BAR_DISPLAY_STORAGE_KEY);
    return stored === "donut" || stored === "focusTime" || stored === "donutFocusTime"
      ? stored
      : COMPANION_MENU_BAR_DISPLAY_DEFAULT;
  } catch {
    return COMPANION_MENU_BAR_DISPLAY_DEFAULT;
  }
}

export function persistCompanionMenuBarDisplayMode(mode: TrayDisplayMode): TrayDisplayMode {
  if (typeof window === "undefined") return mode;
  try {
    window.localStorage.setItem(COMPANION_MENU_BAR_DISPLAY_STORAGE_KEY, mode);
  } catch {
    // Runtime state still changes when storage is unavailable.
  }
  return mode;
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

function isCompanionSurfacePolicy(value: string | null): value is CompanionSurfacePolicy {
  return value === "floating" || value === "menuBar" || value === "off";
}
