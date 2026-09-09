import type { DeveloperReleaseInstallResult } from "@drifty/domain";
import { useSyncExternalStore } from "react";
import { UPDATE_BACKGROUND_APPLY_STORAGE_KEY, UPDATE_AUTO_INSTALL_STORAGE_KEY } from "./updatePolicy";

// Shared with released clients so a downgrade keeps its next scheduled check.
export const UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY = "drifty.updates.nextAutomaticCheckAt.v1";
const PAUSE_KEY = "drifty.updates.versionTestPauseUntil.v1";
const listeners = new Set<() => void>();
let operating = false;
// A replaced bundle must be restarted before any installer can run again.
// Memory-only state intentionally resets with the new app process.
let replacement: DeveloperReleaseInstallResult | null = null;
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function acquireUpdateOperation(): (() => void) | null {
  if (operating || replacement) return null;
  operating = true;
  emit();
  return () => { operating = false; emit(); };
}
export function useUpdateOperationBusy(): boolean {
  return useSyncExternalStore(subscribe, () => operating || replacement !== null, () => false);
}
export function markVersionReplacementComplete(result: DeveloperReleaseInstallResult): void {
  replacement = result;
  emit();
}
export function useVersionReplacement(): DeveloperReleaseInstallResult | null {
  return useSyncExternalStore(subscribe, () => replacement, () => null);
}
export function readVersionTestPauseUntil(): number {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(PAUSE_KEY));
  return Number.isFinite(value) ? value : 0;
}
export function useVersionTestPauseUntil(): number {
  return useSyncExternalStore(subscribe, readVersionTestPauseUntil, () => 0);
}
export function pauseUpdatesForVersionTest(): void {
  const until = Date.now() + 7 * 24 * 60 * 60 * 1000;
  // Failure to persist must stop installation; do not pretend the pause worked.
  window.localStorage.setItem(UPDATE_BACKGROUND_APPLY_STORAGE_KEY, "0");
  window.localStorage.setItem(UPDATE_AUTO_INSTALL_STORAGE_KEY, "0");
  window.localStorage.setItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY, String(until));
  window.localStorage.setItem(PAUSE_KEY, String(until));
  emit();
}
export function resumeUpdatesAfterVersionTest(): void {
  window.localStorage.removeItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY);
  window.localStorage.removeItem(PAUSE_KEY);
  // Background installation stays off until explicitly enabled in update settings.
  emit();
}
