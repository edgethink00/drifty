import { invoke } from "@tauri-apps/api/core";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Open the native save panel for a share-card PNG. Returns the chosen absolute
 * path, or `null` when the user cancels the panel.
 */
export async function saveShareCardPng(fileName: string, pngBase64: string): Promise<string | null> {
  return await invoke<string | null>("share_card_save_png", { fileName, pngBase64 });
}
