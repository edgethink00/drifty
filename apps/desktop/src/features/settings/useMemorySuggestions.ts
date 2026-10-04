import { useCallback, useEffect, useRef, useState } from "react";

import {
  adoptLivingSoulSuggestion,
  type LivingSoulDocument,
} from "../classification/livingSoul";
import type { SuggestionLanguage } from "../classification/memorySuggestions";
import {
  MEMORY_SUGGESTIONS_CHANGED_EVENT,
  isMemorySuggestionJobRunning,
  notifyMemorySuggestionsChanged,
  runMemorySuggestionJobIfDue,
  type MemorySuggestionProvider,
} from "../classification/memorySuggestionJob";
import {
  declineSuggestion,
  readSuggestionStore,
  removeSuggestion,
  writeSuggestionStore,
  type StoredSuggestion,
} from "../classification/memorySuggestionStore";

export type { MemorySuggestionProvider } from "../classification/memorySuggestionJob";

export type SuggestionAcceptResult =
  | { readonly ok: true; readonly document: LivingSoulDocument }
  | { readonly ok: false; readonly code: string };

export type UseMemorySuggestionsInput = {
  readonly ownerId: string;
  readonly provider: MemorySuggestionProvider | null;
  readonly language: SuggestionLanguage;
  /** The loaded Soul; suggestions are only accepted against a readable one. */
  readonly document: LivingSoulDocument | null;
};

/**
 * Pending suggestions for the Memory screen. Suggestions are normally produced
 * in the background (useMemorySuggestionScheduler); opening Memory also starts a
 * run when one is due.
 */
export function useMemorySuggestions({ ownerId, provider, language, document }: UseMemorySuggestionsInput) {
  const [suggestions, setSuggestions] = useState<readonly StoredSuggestion[]>(() => readSuggestionStore(ownerId).suggestions);
  const [running, setRunning] = useState(() => isMemorySuggestionJobRunning(ownerId));
  const mounted = useRef(true);
  const documentRef = useRef(document);
  documentRef.current = document;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const refresh = () => {
      setSuggestions(readSuggestionStore(ownerId).suggestions);
      setRunning(isMemorySuggestionJobRunning(ownerId));
    };
    refresh();
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId?: string }>).detail;
      if (!detail?.ownerId || detail.ownerId === ownerId) refresh();
    };
    window.addEventListener(MEMORY_SUGGESTIONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(MEMORY_SUGGESTIONS_CHANGED_EVENT, onChange);
  }, [ownerId]);

  const ready = document !== null;
  const providerKind = provider?.kind ?? null;
  useEffect(() => {
    const selected = providerRef.current;
    if (!ready || !selected) return;
    void runMemorySuggestionJobIfDue({ ownerId, provider: selected, language });
  }, [ready, providerKind, ownerId, language]);

  const accept = useCallback(async (id: string): Promise<SuggestionAcceptResult> => {
    const suggestion = readSuggestionStore(ownerId).suggestions.find((entry) => entry.id === id);
    const current = documentRef.current;
    if (!suggestion || !current) return { ok: false, code: "memory_changed" };
    try {
      const result = await adoptLivingSoulSuggestion({
        ownerId, expectedRevision: current.revision,
        kind: suggestion.kind === "work" ? "workSupport" : suggestion.kind === "drift" ? "drift" : "ambiguities",
        summary: suggestion.summary, evidenceDays: Math.max(1, suggestion.days), observedAt: suggestion.windowEnd,
        activity: suggestion.domain ? suggestion.app + " / " + suggestion.domain : suggestion.app,
        ...(suggestion.kind === "work" ? { productivity: "focus" as const } : suggestion.kind === "drift" ? { productivity: "drift" as const } : {}),
      });
      writeSuggestionStore(ownerId, removeSuggestion(readSuggestionStore(ownerId), id));
      notifyMemorySuggestionsChanged(ownerId);
      return { ok: true, document: result.document };
    } catch (error) {
      return { ok: false, code: error instanceof Error ? error.message : "memory_failed" };
    }
  }, [ownerId]);

  const decline = useCallback((id: string) => {
    writeSuggestionStore(ownerId, declineSuggestion(readSuggestionStore(ownerId), id));
    notifyMemorySuggestionsChanged(ownerId);
  }, [ownerId]);

  return { suggestions, running, accept, decline };
}
