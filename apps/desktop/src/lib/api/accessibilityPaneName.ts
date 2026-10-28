import { useSyncExternalStore } from "react";

// macOS 27 renamed the Accessibility privacy page in System Settings to "Device
// Control and Data Access". Drifty names the page the way the person's System
// Settings does, using the macOS version the native permission status reports.
// Until a status arrives (or outside macOS) the long-standing name stays.
let reportedMacosMajorVersion: number | null = null;
const listeners = new Set<() => void>();

export function rememberMacosMajorVersion(version: number | null | undefined): void {
  if (typeof version !== "number" || version === reportedMacosMajorVersion) return;
  reportedMacosMajorVersion = version;
  for (const listener of listeners) listener();
}

export function accessibilityPaneIsDeviceControl(version: number | null | undefined): boolean {
  return typeof version === "number" && version >= 27;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when System Settings calls the Accessibility page "Device Control and Data Access". */
export function useAccessibilityPaneIsDeviceControl(): boolean {
  const version = useSyncExternalStore(subscribe, () => reportedMacosMajorVersion, () => null);
  return accessibilityPaneIsDeviceControl(version);
}

/** Tests start from a status that has not arrived yet. */
export function resetReportedMacosMajorVersion(): void {
  reportedMacosMajorVersion = null;
  for (const listener of listeners) listener();
}
