import type { SettingsSection } from "./SettingsSidebar";

type SettingsAttentionInput = {
  readonly desktopRuntime: boolean;
  readonly accessibilityRequired: boolean;
  readonly accessibilityGranted: boolean;
  /** Mode of the latest tracker status, or null before the first status arrives. */
  readonly trackerMode: string | null;
};

// These statuses are synthesized after a failed tracker call and always carry
// accessibilityGranted: false. They describe a tracker problem, not a revoked
// permission, so they must not raise the permission warning.
const UNREADABLE_TRACKER_MODES = new Set(["unavailable", "degraded"]);

/**
 * Settings sections that hold a required item the user must act on. Today that
 * is only a missing macOS Accessibility grant, shown in General's permissions
 * block. Without a desktop runtime or a real tracker reading the grant is
 * unknown, so nothing is flagged.
 */
export function settingsSectionsNeedingAttention({
  desktopRuntime,
  accessibilityRequired,
  accessibilityGranted,
  trackerMode,
}: SettingsAttentionInput): ReadonlyArray<SettingsSection> {
  if (!desktopRuntime || !accessibilityRequired || accessibilityGranted) return [];
  if (trackerMode === null || UNREADABLE_TRACKER_MODES.has(trackerMode)) return [];
  return ["general"];
}
