import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalAiProvider } from "./localAiSetup";
import { loadOpenRouterApiKey } from "./openRouterApiKeyStore";
import {
  ANALYSIS_AI_SETUP_STORAGE_KEY,
  hasStoredAnalysisAiSetup,
  isLegacyDefaultAnalysisSetup,
  resolveInitialAnalysisAiSetup,
  toPersistedAnalysisAiSetup,
  type AnalysisAiSetupState,
} from "./analysisModelSetup";

export interface UseAnalysisModelSetupResult {
  readonly analysisSetup: AnalysisAiSetupState;
  readonly setAnalysisSetup: (next: AnalysisAiSetupState) => void;
  readonly resolveOpenRouterKey: () => Promise<string | null>;
  readonly openRouterConnected: boolean;
  readonly analysisConnected: boolean;
  readonly refreshOpenRouterKey: () => Promise<void>;
}

/**
 * Owns the analysis-slot config. The OpenRouter provisioned/BYOK key is shared
 * with the classification slot (same Keychain entry) so connecting once covers
 * both; cloud relies on the Supabase account, self-hosted on base URL + model.
 */
export function useAnalysisModelSetup(supabaseConfigured: boolean, liveProvider?: LocalAiProvider): UseAnalysisModelSetupResult {
  const [storedSetup, setStoredSetup] = useState<AnalysisAiSetupState>(resolveInitialAnalysisAiSetup);
  // Until the user explicitly saves an analysis setup, the slot follows the live
  // classification provider: OpenRouter stays on OpenRouter (same Keychain key),
  // everything else defaults to Drifty Cloud.
  const [hasExplicitSetup, setHasExplicitSetup] = useState<boolean>(
    () => hasStoredAnalysisAiSetup() && !isLegacyDefaultAnalysisSetup(resolveInitialAnalysisAiSetup()),
  );
  const analysisSetup = useMemo<AnalysisAiSetupState>(() => {
    if (hasExplicitSetup) return storedSetup;
    return { ...storedSetup, provider: liveProvider === "openrouter_byok" ? "openrouter" : "cloud" };
  }, [hasExplicitSetup, storedSetup, liveProvider]);
  const [openRouterKeyPresent, setOpenRouterKeyPresent] = useState(false);

  const refreshOpenRouterKey = useCallback(async () => {
    setOpenRouterKeyPresent(Boolean(await loadOpenRouterApiKey()));
  }, []);

  // Only read the Keychain to compute the OpenRouter "connected" badge when the
  // analysis slot actually targets OpenRouter. Reading it on every launch (even in
  // local/cloud mode) makes macOS re-prompt for Keychain access after each app
  // update, because the updated binary is not yet on the item's ACL. Switching the
  // provider to "openrouter" re-runs this and refreshes the badge on demand.
  useEffect(() => {
    if (analysisSetup.provider !== "openrouter") return;
    void refreshOpenRouterKey();
  }, [analysisSetup.provider, refreshOpenRouterKey]);

  const setAnalysisSetup = useCallback((next: AnalysisAiSetupState) => {
    setStoredSetup(next);
    setHasExplicitSetup(true);
    try {
      window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedAnalysisAiSetup(next)));
    } catch {
      /* ignore persistence errors (private mode, etc.) */
    }
  }, []);

  const resolveOpenRouterKey = useCallback(() => loadOpenRouterApiKey(), []);

  const analysisConnected = useMemo(() => {
    if (analysisSetup.provider === "cloud") return supabaseConfigured;
    if (analysisSetup.provider === "openrouter") return openRouterKeyPresent;
    if (analysisSetup.provider === "openai") return Boolean(analysisSetup.openaiApiKey.trim() && analysisSetup.openaiModel.trim());
    if (analysisSetup.provider === "anthropic") return Boolean(analysisSetup.anthropicApiKey.trim() && analysisSetup.anthropicModel.trim());
    return Boolean(analysisSetup.selfHostedBaseUrl.trim() && analysisSetup.selfHostedModel.trim());
  }, [analysisSetup, supabaseConfigured, openRouterKeyPresent]);

  return { analysisSetup, setAnalysisSetup, resolveOpenRouterKey, openRouterConnected: openRouterKeyPresent, analysisConnected, refreshOpenRouterKey };
}
