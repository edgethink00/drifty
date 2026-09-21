/**
 * Per-moment switches for the Companion. Each is a plain "1"/"0" flag so the
 * pet quick-controls window and other surfaces can read it without parsing.
 */
export const CELEBRATIONS_STORAGE_KEY = "drifty.companion.celebrations.v1";
export const DAY_REVIEW_ENABLED_STORAGE_KEY = "drifty.endOfDayReview.enabled.v1";
export const MACOS_NOTIFICATION_STORAGE_KEY = "drifty.notifications.macosNotification.v1";

export const CELEBRATIONS_DEFAULT_ENABLED = true;
export const DAY_REVIEW_DEFAULT_ENABLED = true;
/** Off by default: the Companion card is the primary drift surface (product decision 2026-09-18). */
export const MACOS_NOTIFICATION_DEFAULT_ENABLED = false;

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, enabled ? "1" : "0");
  } catch {
    // Runtime state still changes when storage is unavailable.
  }
}

export function resolveInitialCelebrationsEnabled(): boolean {
  return readFlag(CELEBRATIONS_STORAGE_KEY, CELEBRATIONS_DEFAULT_ENABLED);
}

export function persistCelebrationsEnabled(enabled: boolean): void {
  writeFlag(CELEBRATIONS_STORAGE_KEY, enabled);
}

export function resolveInitialDayReviewEnabled(): boolean {
  return readFlag(DAY_REVIEW_ENABLED_STORAGE_KEY, DAY_REVIEW_DEFAULT_ENABLED);
}

export function persistDayReviewEnabled(enabled: boolean): void {
  writeFlag(DAY_REVIEW_ENABLED_STORAGE_KEY, enabled);
}

export function resolveInitialMacosNotificationEnabled(): boolean {
  return readFlag(MACOS_NOTIFICATION_STORAGE_KEY, MACOS_NOTIFICATION_DEFAULT_ENABLED);
}

export function persistMacosNotificationEnabled(enabled: boolean): void {
  writeFlag(MACOS_NOTIFICATION_STORAGE_KEY, enabled);
}
