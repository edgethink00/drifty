import { useCallback, useEffect, useMemo, useState } from "react";
import { loadOpenRouterApiKey } from "./openRouterApiKeyStore";
import {
  ANALYSIS_AI_SETUP_STORAGE_KEY,
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
export function useAnalysisModelSetup(supabaseConfigured: boolean): UseAnalysisModelSetupResult {
  const [analysisSetup, setAnalysisSetupState] = useState<AnalysisAiSetupState>(resolveInitialAnalysisAiSetup);
  const [openRouterKeyPresent, setOpenRouterKeyPresent] = useState(false);

  const refreshOpenRouterKey = useCallback(async () => {
    setOpenRouterKeyPresent(Boolean(await loadOpenRouterApiKey()));
  }, []);

  useEffect(() => {
    void refreshOpenRouterKey();
  }, [refreshOpenRouterKey]);

  const setAnalysisSetup = useCallback((next: AnalysisAiSetupState) => {
    setAnalysisSetupState(next);
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
