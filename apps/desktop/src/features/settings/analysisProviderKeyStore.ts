import { invoke } from "@tauri-apps/api/core";
import { createCredentialStoreQueue } from "./credentialStoreQueue";

export type DirectAnalysisProvider = "openai" | "anthropic";

const queues = { openai: createCredentialStoreQueue(), anthropic: createCredentialStoreQueue() };

export async function loadAnalysisProviderKey(provider: DirectAnalysisProvider): Promise<string | null> {
  const value = await queues[provider](() => invoke<string | null>("analysis_provider_load_api_key", { provider }));
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function saveAnalysisProviderKey(provider: DirectAnalysisProvider, value: string): Promise<void> {
  await queues[provider](() => invoke("analysis_provider_save_api_key", { provider, value: value.trim() }));
}

/** Only a person's recovery action may ask the OS for credential access. */
export async function recoverAnalysisProviderKey(provider: DirectAnalysisProvider, value?: string): Promise<string | null> {
  try {
    const result = await queues[provider](() => invoke<string | null>("analysis_provider_recover_api_key", { provider, value: value?.trim() ?? null }));
    if (result !== null && typeof result !== "string") throw new Error("Invalid credential response.");
    const normalized = typeof result === "string" && result.trim() ? result.trim() : null;
    if (value !== undefined && normalized !== (value.trim() || null)) throw new Error("Credential change was not confirmed.");
    return normalized;
  } catch {
    throw new Error("Unable to recover provider credentials.");
  }
}
