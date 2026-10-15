import { useCallback, useEffect, useRef, useState } from "react";

import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import {
  adoptLivingSoulSuggestion,
  type LivingSoulDocument,
} from "../classification/livingSoul";
import type { SuggestionLanguage } from "../classification/memorySuggestions";
import { AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT } from "./aiPrivacyRequestSettings";
import { useMemorySuggestionScope } from "./useMemorySuggestionScope";
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
  const isCurrent = useMemorySuggestionScope(ownerId, provider, provider !== null);
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
    window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MEMORY_SUGGESTIONS_CHANGED_EVENT, onChange);
      window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [ownerId]);

  const ready = document !== null;
  const providerKind = provider?.kind ?? null;
  useEffect(() => {
    const selected = providerRef.current;
    if (!ready || !selected) return;
    void runMemorySuggestionJobIfDue({ ownerId, provider: selected, language, isCurrent });
  }, [ready, providerKind, ownerId, language, isCurrent]);

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
      reportSuggestionAction("accepted", suggestion, "success");
      return { ok: true, document: result.document };
    } catch (error) {
      reportSuggestionAction("accepted", suggestion, "error");
      return { ok: false, code: error instanceof Error ? error.message : "memory_failed" };
    }
  }, [ownerId]);

  const decline = useCallback((id: string) => {
    const suggestion = readSuggestionStore(ownerId).suggestions.find((entry) => entry.id === id);
    writeSuggestionStore(ownerId, declineSuggestion(readSuggestionStore(ownerId), id));
    notifyMemorySuggestionsChanged(ownerId);
    if (suggestion) reportSuggestionAction("dismissed", suggestion, "success");
  }, [ownerId]);

  return { suggestions, running, accept, decline };
}

/** Counts only: what people do with a suggestion. The sentence, place and examples never leave the device. */
export function reportSuggestionAction(
  action: "accepted" | "dismissed" | "details_opened",
  suggestion: Pick<StoredSuggestion, "kind" | "examples">,
  result: "success" | "error",
): void {
  capturePostHogEvent("memory_suggestion_action", {
    action, kind: suggestion.kind, result, has_examples: (suggestion.examples?.length ?? 0) > 0,
  });
}
