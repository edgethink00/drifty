import { invoke } from "@tauri-apps/api/core";

// The custom (OpenAI-compatible) endpoint key is shared by Classification and
// Intelligence. It lives in the OS credential store, never in localStorage.

function handleKeyStoreError(operation: string, error: unknown): null {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error.trim()
      : "Unknown native key store error.";
  console.warn(`Unable to ${operation} custom endpoint API key in the credential store.`, message);
  return null;
}

export async function loadCustomEndpointApiKey(options?: { throwOnError?: boolean }): Promise<string | null> {
  try {
    const value = await invoke<string | null>("custom_endpoint_load_api_key");
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch (error) {
    if (options?.throwOnError) throw new Error("Unable to read provider credentials.");
    return handleKeyStoreError("load", error);
  }
}

export async function saveCustomEndpointApiKey(value: string): Promise<void> {
  const trimmedValue = value.trim();
  try {
    if (trimmedValue) {
      await invoke<void>("custom_endpoint_save_api_key", { value: trimmedValue });
    } else {
      await invoke<void>("custom_endpoint_clear_api_key");
    }
  } catch (error) {
    handleKeyStoreError(trimmedValue ? "save" : "clear", error);
  }
}
