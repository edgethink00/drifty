import { useCallback, useEffect, useRef } from "react";
import type { MemorySuggestionProvider } from "../classification/memorySuggestionJob";

/** One generation per owner/provider selection, including A → B → A. */
export function useMemorySuggestionScope(ownerId: string, provider: MemorySuggestionProvider | null, enabled = true): () => boolean {
  // Config values stay in memory; this identity is never stored or reported.
  const identity = JSON.stringify([ownerId, provider, enabled]);
  const current = useRef({ identity });
  if (current.current.identity !== identity) current.current = { identity };
  const scope = current.current;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback(() => enabled && mounted.current && current.current === scope, [enabled, scope]);
}
