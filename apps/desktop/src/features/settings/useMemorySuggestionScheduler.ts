import { useEffect, useRef } from "react";

import type { SuggestionLanguage } from "../classification/memorySuggestions";
import { runMemorySuggestionJobIfDue, type MemorySuggestionProvider } from "../classification/memorySuggestionJob";
import { installMemorySuggestionExamplePrivacySync } from "../classification/memorySuggestionStore";
import { useMemorySuggestionScope } from "./useMemorySuggestionScope";

export const SUGGESTION_SCHEDULER_FIRST_CHECK_MS = 90 * 1000;
export const SUGGESTION_SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Keeps Memory suggestions fresh without opening Settings: shortly after launch
 * and every 30 minutes it asks the job whether a run is due. The job itself
 * requires enough newly tracked activity since the previous run, enforces the
 * hourly retry after a failed run, and allows one run at a time.
 */
export function useMemorySuggestionScheduler(input: {
  readonly ownerId: string;
  readonly provider: MemorySuggestionProvider | null;
  readonly language: SuggestionLanguage;
  readonly enabled: boolean;
}): void {
  const latest = useRef(input);
  latest.current = input;
  const active = input.enabled && input.provider !== null;
  const isCurrent = useMemorySuggestionScope(input.ownerId, input.provider, active);
  useEffect(installMemorySuggestionExamplePrivacySync, []);
  useEffect(() => {
    if (!active) return;
    const check = () => {
      const { ownerId, provider, language, enabled } = latest.current;
      if (!enabled || !provider) return;
      void runMemorySuggestionJobIfDue({ ownerId, provider, language, isCurrent });
    };
    const first = window.setTimeout(check, SUGGESTION_SCHEDULER_FIRST_CHECK_MS);
    const interval = window.setInterval(check, SUGGESTION_SCHEDULER_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [active, input.ownerId, isCurrent]);
}

