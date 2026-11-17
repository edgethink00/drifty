import { invoke } from "@tauri-apps/api/core";
import { createCredentialStoreQueue } from "./credentialStoreQueue";

const enqueue = createCredentialStoreQueue();

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
    const value = await enqueue(() => invoke<string | null>("custom_endpoint_load_api_key"));
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
      await enqueue(() => invoke<void>("custom_endpoint_save_api_key", { value: trimmedValue }));
    } else {
      await enqueue(() => invoke<void>("custom_endpoint_clear_api_key"));
    }
  } catch {
    throw new Error("Unable to save provider credentials.");
  }
}

/** Called only by the person's recovery action, never by automatic retries. */
export async function recoverCustomEndpointApiKey(value?: string): Promise<string | null> {
  try {
    const result = await enqueue(() => invoke<string | null>("custom_endpoint_recover_api_key", { value: value?.trim() ?? null }));
    if (result !== null && typeof result !== "string") throw new Error("Invalid credential response.");
    const normalized = typeof result === "string" && result.trim() ? result.trim() : null;
    if (value !== undefined && normalized !== (value.trim() || null)) throw new Error("Credential change was not confirmed.");
    return normalized;
  } catch {
    throw new Error("Unable to recover provider credentials.");
  }
}
