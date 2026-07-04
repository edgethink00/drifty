import { invoke } from "@tauri-apps/api/core";

function handleOpenRouterKeyStoreError(operation: string, error: unknown): null {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error.trim()
      : "Unknown native key store error.";
  console.warn(`Unable to ${operation} OpenRouter API key in Keychain.`, message);
  return null;
}

export async function loadOpenRouterApiKey(): Promise<string | null> {
  try {
    const value = await invoke<string | null>("openrouter_load_api_key");
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch (error) {
    return handleOpenRouterKeyStoreError("load", error);
  }
}

export async function saveOpenRouterApiKey(value: string): Promise<void> {
  const trimmedValue = value.trim();
  try {
    if (trimmedValue) {
      await invoke<void>("openrouter_save_api_key", { value: trimmedValue });
      return;
    }
    await invoke<void>("openrouter_clear_api_key");
  } catch (error) {
    handleOpenRouterKeyStoreError(trimmedValue ? "save" : "clear", error);
  }
}

export async function clearOpenRouterApiKey(): Promise<void> {
  await saveOpenRouterApiKey("");
}
