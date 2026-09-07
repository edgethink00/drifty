import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeOpenAiCompatibleBaseUrl, type LocalAiProvider } from "./localAiSetup";
import { loadOpenRouterApiKey, subscribeOpenRouterKeyPresence } from "./openRouterApiKeyStore";
import {
  ANALYSIS_AI_SETUP_STORAGE_KEY,
  hasStoredAnalysisAiSetup,
  isLegacyDefaultAnalysisSetup,
  resolveLegacyAnalysisCustomEndpointConnection,
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

export type SharedCustomEndpointConnection = {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Prefer a legacy Intelligence endpoint only when Classification's custom slot is untouched. */
  readonly preferStoredConnection?: boolean;
  readonly onChange: (next: { readonly baseUrl: string; readonly apiKey: string }) => void;
};

/**
 * Owns the analysis-slot config. The OpenRouter provisioned/BYOK key is shared
 * with the classification slot (same Keychain entry) so connecting once covers
 * both. Custom endpoints reuse the Classification-owned URL/key while this hook
 * keeps the Intelligence provider and model independent.
 */
export function useAnalysisModelSetup(
  supabaseConfigured: boolean,
  liveProvider?: LocalAiProvider,
  sharedCustomEndpoint?: SharedCustomEndpointConnection,
): UseAnalysisModelSetupResult {
  const [storedSetup, setStoredSetup] = useState<AnalysisAiSetupState>(resolveInitialAnalysisAiSetup);
  // Until the user explicitly saves an analysis setup, the slot follows the live
  // classification provider: OpenRouter stays on OpenRouter (same Keychain key),
  // everything else defaults to Drifty Cloud.
  const [hasExplicitSetup, setHasExplicitSetup] = useState<boolean>(
    () => hasStoredAnalysisAiSetup() && !isLegacyDefaultAnalysisSetup(resolveInitialAnalysisAiSetup()),
  );
  const analysisSetup = useMemo<AnalysisAiSetupState>(() => {
    const taskSetup = hasExplicitSetup
      ? storedSetup
      : { ...storedSetup, provider: liveProvider === "openrouter_byok" ? "openrouter" as const : "cloud" as const };
    if (!sharedCustomEndpoint) return taskSetup;
    return {
      ...taskSetup,
      selfHostedBaseUrl: sharedCustomEndpoint.baseUrl,
      selfHostedApiKey: sharedCustomEndpoint.apiKey,
    };
  }, [hasExplicitSetup, storedSetup, liveProvider, sharedCustomEndpoint?.apiKey, sharedCustomEndpoint?.baseUrl]);
  const [openRouterKeyPresent, setOpenRouterKeyPresent] = useState(false);
  const [legacyCustomEndpointConnection] = useState(resolveLegacyAnalysisCustomEndpointConnection);
  const migratedLegacyCustomEndpointRef = useRef(false);

  useEffect(() => {
    if (
      migratedLegacyCustomEndpointRef.current
      || !sharedCustomEndpoint
      || !legacyCustomEndpointConnection
    ) return;
    migratedLegacyCustomEndpointRef.current = true;
    if (
      sharedCustomEndpoint.preferStoredConnection
      && legacyCustomEndpointConnection.baseUrl
      && legacyCustomEndpointConnection.baseUrl !== sharedCustomEndpoint.baseUrl
    ) {
      sharedCustomEndpoint.onChange({
        baseUrl: legacyCustomEndpointConnection.baseUrl,
        apiKey: sharedCustomEndpoint.apiKey,
      });
    }
    try {
      window.localStorage.setItem(
        ANALYSIS_AI_SETUP_STORAGE_KEY,
        JSON.stringify(toPersistedAnalysisAiSetup(storedSetup)),
      );
    } catch {
      /* ignore persistence errors (private mode, etc.) */
    }
  }, [legacyCustomEndpointConnection, sharedCustomEndpoint, storedSetup]);

  const keyPresenceRevisionRef = useRef(0);
  useEffect(() => subscribeOpenRouterKeyPresence((present) => {
    keyPresenceRevisionRef.current += 1;
    setOpenRouterKeyPresent(present);
  }), []);
  const refreshOpenRouterKey = useCallback(async () => {
    const revision = keyPresenceRevisionRef.current;
    const present = Boolean(await loadOpenRouterApiKey());
    if (revision === keyPresenceRevisionRef.current) setOpenRouterKeyPresent(present);
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
    if (sharedCustomEndpoint && (
      next.selfHostedBaseUrl !== sharedCustomEndpoint.baseUrl
      || next.selfHostedApiKey !== sharedCustomEndpoint.apiKey
    )) {
      sharedCustomEndpoint.onChange({
        baseUrl: next.selfHostedBaseUrl,
        apiKey: next.selfHostedApiKey,
      });
    }
    setStoredSetup(next);
    setHasExplicitSetup(true);
    try {
      window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedAnalysisAiSetup(next)));
    } catch {
      /* ignore persistence errors (private mode, etc.) */
    }
  }, [sharedCustomEndpoint]);

  const resolveOpenRouterKey = useCallback(() => loadOpenRouterApiKey(), []);

  const analysisConnected = useMemo(() => {
    if (analysisSetup.provider === "cloud") return supabaseConfigured;
    if (analysisSetup.provider === "openrouter") return openRouterKeyPresent;
    if (analysisSetup.provider === "openai") return Boolean(analysisSetup.openaiApiKey.trim() && analysisSetup.openaiModel.trim());
    if (analysisSetup.provider === "anthropic") return Boolean(analysisSetup.anthropicApiKey.trim() && analysisSetup.anthropicModel.trim());
    return Boolean(normalizeOpenAiCompatibleBaseUrl(analysisSetup.selfHostedBaseUrl) && analysisSetup.selfHostedModel.trim());
  }, [analysisSetup, supabaseConfigured, openRouterKeyPresent]);

  return { analysisSetup, setAnalysisSetup, resolveOpenRouterKey, openRouterConnected: openRouterKeyPresent, analysisConnected, refreshOpenRouterKey };
}
