import { invoke } from "@tauri-apps/api/core";

export type DirectAnalysisProvider = "openai" | "anthropic";

export async function loadAnalysisProviderKey(provider: DirectAnalysisProvider): Promise<string | null> {
  const value = await invoke<string | null>("analysis_provider_load_api_key", { provider });
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function saveAnalysisProviderKey(provider: DirectAnalysisProvider, value: string): Promise<void> {
  await invoke("analysis_provider_save_api_key", { provider, value: value.trim() });
}
