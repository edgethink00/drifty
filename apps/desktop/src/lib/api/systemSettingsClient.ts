import { invoke } from "@tauri-apps/api/core";

export type SystemSettingsPane = "accessibility" | "calendars" | "notifications" | "screenRecording" | "storage";

export type OpenSystemSettingsOptions = {
  /**
   * Ask for the drag-to-grant panel beside System Settings (macOS installs that
   * carry it). Pass it only when the permission is still off; a shortcut to a
   * granted permission opens the pane alone.
   */
  readonly guide?: boolean;
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function paneArgs(pane: SystemSettingsPane | "fullDiskAccess", options: OpenSystemSettingsOptions) {
  return options.guide ? { pane, guide: true } : { pane };
}

export async function openSystemSettingsPane(pane: SystemSettingsPane, options: OpenSystemSettingsOptions = {}): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("system_open_settings_pane", paneArgs(pane, options));
  return true;
}

// Full Disk Access is only reachable through a manual toggle in System Settings; this
// deep-links to that pane (backed by the Rust FullDiskAccess variant → Privacy_AllFiles).
export async function openFullDiskAccessSettingsPane(options: OpenSystemSettingsOptions = {}): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("system_open_settings_pane", paneArgs("fullDiskAccess", options));
  return true;
}
