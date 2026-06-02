import { invoke } from "@tauri-apps/api/core";

export type SystemSettingsPane = "accessibility" | "notifications";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openSystemSettingsPane(pane: SystemSettingsPane): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("system_open_settings_pane", { pane });
  return true;
}
