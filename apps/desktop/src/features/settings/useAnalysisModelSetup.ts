import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LocalAiProvider } from "./localAiSetup";
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

import { useDirectAnalysisKeys } from "./useDirectAnalysisKeys";
import { analysisConnectionFingerprint, resolveIntelligenceRoute, type AnalysisCredentialState, type AnalysisUnavailableReason } from "./intelligenceRouting";

export interface UseAnalysisModelSetupResult {
  readonly analysisSetup: AnalysisAiSetupState;
  readonly effectiveAnalysisSetup: AnalysisAiSetupState;
  readonly usingCloudRecovery: boolean;
  readonly requestScopeKey: string;
  readonly markUnavailable: (reason: AnalysisUnavailableReason) => void;
  readonly canFallbackNow: () => boolean;
  readonly onProviderVisible: (provider: AnalysisAiSetupState["provider"]) => void;
  readonly setAnalysisSetup: (next: AnalysisAiSetupState) => void;
  readonly resolveOpenRouterKey: () => Promise<string | null>;
  readonly openRouterConnected: boolean;
  readonly analysisConnected: boolean;
  /** The user picked a model other than Drifty Cloud and set it up (whether or not it answers right now). */
  readonly analysisConfigured: boolean;
  readonly refreshOpenRouterKey: () => Promise<void>;
}

export type SharedCustomEndpointConnection = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly credentialState?: AnalysisCredentialState;
  readonly retryCredentialRead?: () => void;
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
  routing?: { readonly ownerKey: string; readonly cloudFallbackAllowed: boolean; readonly cloudReady: boolean },
): UseAnalysisModelSetupResult {
  const [storedSetup, setStoredSetup] = useState<AnalysisAiSetupState>(resolveInitialAnalysisAiSetup);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Until the user explicitly saves an analysis setup, the slot follows the live
  // classification provider: OpenRouter stays on OpenRouter (same Keychain key),
  // everything else defaults to Drifty Cloud.
  const [hasExplicitSetup, setHasExplicitSetup] = useState<boolean>(
    () => {
      const initial = resolveInitialAnalysisAiSetup();
      return hasStoredAnalysisAiSetup() && (initial.selectionSource === "manual"
        || (initial.selectionSource !== "automatic" && !isLegacyDefaultAnalysisSetup(initial)));
    },
  );
  const { keys: directKeyValues, states: directKeyStates, load: loadDirectKey, change: changeDirectKey } = useDirectAnalysisKeys();
  const [restoredOpenRouterKey, setRestoredOpenRouterKey] = useState("");
  const analysisSetup = useMemo<AnalysisAiSetupState>(() => {
    const taskSetup = hasExplicitSetup
      ? storedSetup
      : { ...storedSetup, provider: liveProvider === "openrouter_byok" ? "openrouter" as const : "cloud" as const };
    return {
      ...taskSetup,
      ...(!hasExplicitSetup ? { selectionSource: "automatic" as const } : {}),
      openRouterApiKey: restoredOpenRouterKey,
      openaiApiKey: directKeyValues.openai,
      anthropicApiKey: directKeyValues.anthropic,
      ...(sharedCustomEndpoint ? { selfHostedBaseUrl: sharedCustomEndpoint.baseUrl, selfHostedApiKey: sharedCustomEndpoint.apiKey } : {}),
    };
  }, [hasExplicitSetup, storedSetup, liveProvider, sharedCustomEndpoint, directKeyValues, restoredOpenRouterKey]);
  const [openRouterKeyPresent, setOpenRouterKeyPresent] = useState(false);
  const [openRouterCredentialState, setOpenRouterCredentialState] = useState<AnalysisCredentialState>("idle");
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
  const refreshOpenRouterKey = useCallback(async () => {
    const revision = keyPresenceRevisionRef.current;
    setOpenRouterCredentialState("loading");
    try {
      const key = (await loadOpenRouterApiKey({ throwOnError: true })) ?? "";
      const present = Boolean(key);
      if (revision === keyPresenceRevisionRef.current) {
        setOpenRouterKeyPresent(present);
        setRestoredOpenRouterKey(key);
        setOpenRouterCredentialState(present ? "ready" : "missing");
      }
    } catch {
      if (revision === keyPresenceRevisionRef.current) setOpenRouterCredentialState("error");
    }
  }, []);

  useEffect(() => subscribeOpenRouterKeyPresence((present) => {
    keyPresenceRevisionRef.current += 1;
    if (present) void refreshOpenRouterKey();
    else {
      setOpenRouterKeyPresent(false);
      setRestoredOpenRouterKey("");
      setOpenRouterCredentialState("missing");
    }
  }), [refreshOpenRouterKey]);

  // Only read the Keychain to compute the OpenRouter "connected" badge when the
  // analysis slot actually targets OpenRouter. Reading it on every launch (even in
  // local/cloud mode) makes macOS re-prompt for Keychain access after each app
  // update, because the updated binary is not yet on the item's ACL. Switching the
  // provider to "openrouter" re-runs this and refreshes the badge on demand.
  useEffect(() => {
    if (analysisSetup.provider !== "openrouter") return;
    void refreshOpenRouterKey();
  }, [analysisSetup.provider, refreshOpenRouterKey]);

  useEffect(() => {
    if (analysisSetup.provider === "openai" || analysisSetup.provider === "anthropic") void loadDirectKey(analysisSetup.provider);
  }, [analysisSetup.provider, loadDirectKey]);

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
    if (next.openaiApiKey !== directKeyValues.openai) changeDirectKey("openai", next.openaiApiKey);
    if (next.anthropicApiKey !== directKeyValues.anthropic) changeDirectKey("anthropic", next.anthropicApiKey);
    const selectionSource = next.provider !== analysisSetup.provider || next.selectionSource === "manual"
      ? "manual" as const : analysisSetup.selectionSource ?? "manual" as const;
    next = { ...next, selectionSource };
    setStoredSetup(next);
    setHasExplicitSetup(selectionSource !== "automatic");
    try {
      window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedAnalysisAiSetup(next)));
    } catch {
      /* ignore persistence errors (private mode, etc.) */
    }
  }, [sharedCustomEndpoint, analysisSetup, directKeyValues, changeDirectKey]);

  const resolveOpenRouterKey = useCallback(() => loadOpenRouterApiKey({ throwOnError: true }), []);

  const requestScopeKey = JSON.stringify([routing?.ownerKey ?? "local", analysisConnectionFingerprint(analysisSetup)]);
  const [unavailable, setUnavailable] = useState<{ scope: string; reason: AnalysisUnavailableReason } | null>(null);
  // Retry the preferred route after a bounded cooldown, including when the
  // user fixes permissions/model access at the provider without editing here.
  useEffect(() => {
    if (!unavailable) return;
    const timer = setTimeout(() => setUnavailable(null), 5 * 60_000);
    return () => clearTimeout(timer);
  }, [unavailable]);
  const credentialState = analysisSetup.provider === "openrouter" ? openRouterCredentialState
    : analysisSetup.provider === "openai" || analysisSetup.provider === "anthropic" ? directKeyStates[analysisSetup.provider]
    : sharedCustomEndpoint?.credentialState ?? "ready";
  const route = useMemo(() => resolveIntelligenceRoute({
    setup: analysisSetup,
    credentialState,
    cloudReady: routing?.cloudReady ?? supabaseConfigured,
    cloudFallbackAllowed: routing?.cloudFallbackAllowed ?? false,
    confirmedUnavailable: unavailable?.scope === requestScopeKey ? unavailable.reason : null,
  }), [analysisSetup, credentialState, routing?.cloudReady, routing?.cloudFallbackAllowed, supabaseConfigured, unavailable, requestScopeKey]);
  const current = useRef({ requestScopeKey, fallback: false });
  current.current = { requestScopeKey, fallback: Boolean(routing?.cloudFallbackAllowed && routing?.cloudReady) };
  const markUnavailable = useCallback((reason: AnalysisUnavailableReason) => {
    if (mounted.current && current.current.requestScopeKey === requestScopeKey) setUnavailable({ scope: requestScopeKey, reason });
  }, [requestScopeKey]);
  const canFallbackNow = useCallback(() => mounted.current && current.current.requestScopeKey === requestScopeKey && current.current.fallback, [requestScopeKey]);
  const onProviderVisible = useCallback((provider: AnalysisAiSetupState["provider"]) => {
    setUnavailable(null);
    if (provider === "openai" || provider === "anthropic") void loadDirectKey(provider, true);
    if (provider === "openrouter" && openRouterCredentialState === "error") void refreshOpenRouterKey();
    if (provider === "self_hosted" && sharedCustomEndpoint?.credentialState === "error") sharedCustomEndpoint.retryCredentialRead?.();
  }, [loadDirectKey, openRouterCredentialState, refreshOpenRouterKey, sharedCustomEndpoint]);

  return { analysisSetup, effectiveAnalysisSetup: route.setup, usingCloudRecovery: route.fallback, requestScopeKey, markUnavailable, canFallbackNow, onProviderVisible,
    setAnalysisSetup, resolveOpenRouterKey, openRouterConnected: openRouterKeyPresent, analysisConnected: route.ready,
    analysisConfigured: analysisSetup.provider !== "cloud" && route.reason !== "configuration", refreshOpenRouterKey };
}
