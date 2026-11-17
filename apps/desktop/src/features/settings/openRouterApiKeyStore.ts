import { invoke } from "@tauri-apps/api/core";
import { createCredentialStoreQueue } from "./credentialStoreQueue";

const enqueue = createCredentialStoreQueue();

const keyPresenceListeners = new Set<(present: boolean) => void>();

/** Publish only presence, after native persistence succeeds; never key material. */
export function subscribeOpenRouterKeyPresence(listener: (present: boolean) => void): () => void {
  keyPresenceListeners.add(listener);
  return () => { keyPresenceListeners.delete(listener); };
}

function handleOpenRouterKeyStoreError(operation: string, error: unknown): null {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string" && error.trim()
      ? error.trim()
      : "Unknown native key store error.";
  console.warn(`Unable to ${operation} OpenRouter API key in Keychain.`, message);
  return null;
}

export async function loadOpenRouterApiKey(options?: { throwOnError?: boolean }): Promise<string | null> {
  try {
    const value = await enqueue(() => invoke<string | null>("openrouter_load_api_key"));
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch (error) {
    if (options?.throwOnError) throw new Error("Unable to read provider credentials.");
    return handleOpenRouterKeyStoreError("load", error);
  }
}

export async function saveOpenRouterApiKey(value: string): Promise<void> {
  const trimmedValue = value.trim();
  try {
    if (trimmedValue) {
      await enqueue(() => invoke<void>("openrouter_save_api_key", { value: trimmedValue }));
    } else {
      await enqueue(() => invoke<void>("openrouter_clear_api_key"));
    }
    for (const listener of keyPresenceListeners) listener(Boolean(trimmedValue));
  } catch {
    throw new Error("Unable to save provider credentials.");
  }
}

export async function clearOpenRouterApiKey(): Promise<void> {
  await saveOpenRouterApiKey("");
}

/** Called only by the person's recovery action, never by automatic retries. */
export async function recoverOpenRouterApiKey(value?: string): Promise<string | null> {
  try {
    const result = await enqueue(() => invoke<string | null>("openrouter_recover_api_key", { value: value?.trim() ?? null }));
    if (result !== null && typeof result !== "string") throw new Error("Invalid credential response.");
    const normalized = typeof result === "string" && result.trim() ? result.trim() : null;
    if (value !== undefined && normalized !== (value.trim() || null)) throw new Error("Credential change was not confirmed.");
    for (const listener of keyPresenceListeners) listener(Boolean(normalized));
    return normalized;
  } catch {
    throw new Error("Unable to recover provider credentials.");
  }
}
