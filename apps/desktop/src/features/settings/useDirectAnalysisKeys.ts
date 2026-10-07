import { useCallback, useEffect, useRef, useState } from "react";
import { loadAnalysisProviderKey, saveAnalysisProviderKey, type DirectAnalysisProvider } from "./analysisProviderKeyStore";
import type { AnalysisCredentialState } from "./intelligenceRouting";

const providers = ["openai", "anthropic"] as const;
export function useDirectAnalysisKeys() {
  const [keys, setKeys] = useState({ openai: "", anthropic: "" });
  const [states, setStates] = useState<Record<DirectAnalysisProvider, AnalysisCredentialState>>({ openai: "idle", anthropic: "idle" });
  const stateRef = useRef(states);
  stateRef.current = states;
  const revisions = useRef({ openai: 0, anthropic: 0 });
  const mounted = useRef(true);
  const timers = useRef<Partial<Record<DirectAnalysisProvider, ReturnType<typeof setTimeout>>>>({});
  const pending = useRef<Partial<Record<DirectAnalysisProvider, string>>>({});
  const writes = useRef<Record<DirectAnalysisProvider, Promise<void>>>({ openai: Promise.resolve(), anthropic: Promise.resolve() });
  const persist = useCallback((provider: DirectAnalysisProvider, value: string) => {
    // Keep rapid edits in order so an older native write cannot restore a key
    // after a later clear. A failed write never logs the key or native detail.
    writes.current[provider] = writes.current[provider].catch(() => {}).then(() => saveAnalysisProviderKey(provider, value));
    void writes.current[provider].catch(() => { console.warn("Unable to save Intelligence credentials."); });
  }, []);
  useEffect(() => {
    mounted.current = true;
    const taskTimers = timers.current;
    const taskPending = pending.current;
    return () => {
      mounted.current = false;
      for (const provider of providers) {
        clearTimeout(taskTimers[provider]);
        if (taskPending[provider] !== undefined) {
          persist(provider, taskPending[provider]!);
          delete taskPending[provider];
        }
      }
    };
  }, [persist]);
  const load = useCallback(async (provider: DirectAnalysisProvider, retry = false) => {
    if (stateRef.current[provider] !== "idle" && !(retry && stateRef.current[provider] === "error")) return;
    stateRef.current = { ...stateRef.current, [provider]: "loading" };
    setStates(stateRef.current);
    const revision = revisions.current[provider];
    try {
      const key = (await loadAnalysisProviderKey(provider)) ?? "";
      if (!mounted.current || revisions.current[provider] !== revision) return;
      setKeys(current => ({ ...current, [provider]: key }));
      setStates(current => ({ ...current, [provider]: key ? "ready" : "missing" }));
    } catch {
      if (mounted.current && revisions.current[provider] === revision) setStates(current => ({ ...current, [provider]: "error" }));
    }
  }, []);
  const change = useCallback((provider: DirectAnalysisProvider, key: string) => {
    revisions.current[provider] += 1;
    setKeys(current => ({ ...current, [provider]: key }));
    setStates(current => ({ ...current, [provider]: key.trim() ? "ready" : "missing" }));
    pending.current[provider] = key;
    clearTimeout(timers.current[provider]);
    timers.current[provider] = setTimeout(() => {
      delete pending.current[provider];
      persist(provider, key);
    }, 250);
  }, [persist]);
  return { keys, states, load, change };
}
