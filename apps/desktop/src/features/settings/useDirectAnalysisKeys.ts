import { useCallback, useEffect, useRef, useState } from "react";
import { loadAnalysisProviderKey, recoverAnalysisProviderKey, saveAnalysisProviderKey, type DirectAnalysisProvider } from "./analysisProviderKeyStore";
import { useProviderKeyPersistence } from "./useProviderKeyPersistence";

// Stable adapters keep rerenders from resetting retry timing. Each store owns
// its native queue, so operations stay ordered across panel remounts.
const adapters = {
  openai: {
    load: () => loadAnalysisProviderKey("openai"),
    save: (value: string) => saveAnalysisProviderKey("openai", value),
    recoverNative: (value?: string) => recoverAnalysisProviderKey("openai", value),
  },
  anthropic: {
    load: () => loadAnalysisProviderKey("anthropic"),
    save: (value: string) => saveAnalysisProviderKey("anthropic", value),
    recoverNative: (value?: string) => recoverAnalysisProviderKey("anthropic", value),
  },
};

function useDirectProviderKey(provider: DirectAnalysisProvider) {
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const pendingEdit = useRef<string | undefined>(undefined);
  const change = useCallback((value: string) => {
    pendingEdit.current = value.trim();
    setKey(value);
  }, []);
  const restore = useCallback((saved: string, previous: string) => {
    setKey(current => current.trim() === previous ? saved : current);
  }, []);
  const credential = useProviderKeyPersistence({ enabled, value: key.trim(), restore, debounceMs: 250, ...adapters[provider] });
  useEffect(() => {
    if (!credential.pending && pendingEdit.current === key.trim()) pendingEdit.current = undefined;
  }, [credential.pending, key]);
  useEffect(() => () => {
    // Preserve the old final-edit flush, but never open OS UI while closing.
    // Only a human edit can be flushed; an unreadable empty field cannot clear a key.
    const value = pendingEdit.current;
    if (value !== undefined) void adapters[provider].save(value).catch(() => {
      console.warn("Unable to save Intelligence credentials.");
    });
  }, [provider]);
  const retryRead = credential.retry;
  const load = useCallback(async (retry = false) => {
    setEnabled(true);
    if (retry) retryRead();
  }, [retryRead]);
  return { key, change, load, credential };
}

export function useDirectAnalysisKeys() {
  const openai = useDirectProviderKey("openai");
  const anthropic = useDirectProviderKey("anthropic");
  const loadOpenAi = openai.load;
  const loadAnthropic = anthropic.load;
  const changeOpenAi = openai.change;
  const changeAnthropic = anthropic.change;
  const load = useCallback(async (provider: DirectAnalysisProvider, retry = false) => {
    await (provider === "openai" ? loadOpenAi(retry) : loadAnthropic(retry));
  }, [loadOpenAi, loadAnthropic]);
  const change = useCallback((provider: DirectAnalysisProvider, value: string) => {
    if (provider === "openai") changeOpenAi(value);
    else changeAnthropic(value);
  }, [changeOpenAi, changeAnthropic]);
  return {
    keys: { openai: openai.key, anthropic: anthropic.key },
    states: { openai: openai.credential.state, anthropic: anthropic.credential.state },
    recoveries: { openai: openai.credential, anthropic: anthropic.credential },
    load,
    change,
  };
}
