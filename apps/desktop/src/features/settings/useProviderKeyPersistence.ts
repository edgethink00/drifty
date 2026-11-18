import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisCredentialState } from "./intelligenceRouting";

export type ProviderCredentialRecovery = {
  readonly state: AnalysisCredentialState;
  readonly pending: boolean;
  readonly recovering: boolean;
  readonly recover: () => Promise<void>;
};
export type ProviderCredentialRecoveries = Readonly<Record<"openrouter_byok" | "self_hosted", ProviderCredentialRecovery>
  & Partial<Record<"openai" | "anthropic", ProviderCredentialRecovery>>>;

/** Keep the latest edit in memory until the native store accepts it. Automatic calls never show permission UI; recovery is an explicit action. */
export function useProviderKeyPersistence({ enabled, value, load, save, recoverNative, restore, debounceMs = 400 }: {
  readonly enabled: boolean;
  readonly value: string;
  readonly load: () => Promise<string | null>;
  readonly save: (value: string) => Promise<void>;
  readonly recoverNative: (value?: string) => Promise<string | null>;
  readonly restore: (value: string, previous: string) => void;
  readonly debounceMs?: number;
}) {
  const [state, setState] = useState<AnalysisCredentialState>("idle");
  const [loaded, setLoaded] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const observed = useRef(value);
  const revision = useRef(0);
  const mounted = useRef(false);
  const recoveryActive = useRef(false);
  const [recovering, setRecovering] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const edited = useRef(false);
  const persisted = useRef<string | null>(null);
  if (observed.current !== value) {
    observed.current = value;
    revision.current++;
    edited.current = true;
  }
  const retry = useCallback(() => setRetryRevision(current => current + 1), []);

  const recover = useCallback(async () => {
    if (recoveryActive.current) return;
    recoveryActive.current = true;
    const currentRevision = revision.current;
    const currentValue = observed.current;
    const writing = edited.current && persisted.current !== currentValue;
    // An older native write can still finish; a later edit must never skip its write.
    persisted.current = null;
    setRecovering(true);
    try {
      const saved = (await recoverNative(writing ? currentValue : undefined))?.trim() ?? "";
      if (!mounted.current || currentRevision !== revision.current) return;
      persisted.current = saved;
      if (!writing) restore(saved, currentValue);
      setLoaded(true);
      setState(saved ? "ready" : "missing");
    } catch {
      if (mounted.current && currentRevision === revision.current) setState("error");
    } finally {
      recoveryActive.current = false;
      if (mounted.current) setRecovering(false);
    }
  }, [recoverNative, restore]);

  useEffect(() => {
    if (recovering) return;
    const writing = edited.current;
    if (!writing && (!enabled || persisted.current !== null)) return;
    if (writing && persisted.current === value) {
      setLoaded(true);
      setState(value ? "ready" : "missing");
      return;
    }
    let cancelled = false;
    let running = false;
    let settled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function attempt() {
      if (cancelled || running || settled) return;
      clearTimeout(timer);
      running = true;
      if (writing) {
        // Even a cancelled write can finish natively. Invalidate before calling it,
        // so an edit back to an older value must queue a write behind it too.
        persisted.current = null;
        setLoaded(true);
      }
      if (failures === 0) setState("loading");
      try {
        if (writing) {
          await save(value);
          if (cancelled) return;
          settled = true;
          persisted.current = value;
          setState(value ? "ready" : "missing");
        } else {
          const saved = (await load())?.trim() ?? "";
          if (cancelled) return;
          settled = true;
          persisted.current = saved;
          restore(saved, value);
          setLoaded(true);
          setState(saved ? "ready" : "missing");
        }
      } catch {
        if (cancelled) return;
        setState("error");
        timer = setTimeout(() => void attempt(), Math.min(2_000 * 2 ** Math.min(failures++, 4), 30_000));
      } finally {
        running = false;
      }
    }
    const onFocus = () => { void attempt(); };
    window.addEventListener("focus", onFocus);
    if (writing) timer = setTimeout(() => void attempt(), debounceMs);
    else void attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, value, load, save, restore, retryRevision, recovering, debounceMs]);

  return { state, loaded, retry, recover, recovering, pending: edited.current && persisted.current !== value };
}
