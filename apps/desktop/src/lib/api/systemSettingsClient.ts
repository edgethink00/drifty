import { invoke } from "@tauri-apps/api/core";

export type SystemSettingsPane = "accessibility" | "notifications" | "screenRecording" | "storage";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openSystemSettingsPane(pane: SystemSettingsPane): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("system_open_settings_pane", { pane });
  return true;
}

// Full Disk Access is only reachable through a manual toggle in System Settings; this
// deep-links to that pane (backed by the Rust FullDiskAccess variant → Privacy_AllFiles).
export async function openFullDiskAccessSettingsPane(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("system_open_settings_pane", { pane: "fullDiskAccess" });
  return true;
}
