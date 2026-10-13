import { useCallback, useEffect, useState } from "react";
import { loadWhatsNewChangelog, type WhatsNewEntry, type WhatsNewLanguage } from "./whatsNewChangelog";

export type WhatsNewChangelogStatus = "idle" | "loading" | "ready" | "error";

export type WhatsNewChangelogState = {
  readonly status: WhatsNewChangelogStatus;
  /** All chapters on drifty.so (or the cached copy); null until loaded. */
  readonly entries: readonly WhatsNewEntry[] | null;
  readonly retry: () => void;
};

/** Loads the drifty.so changelog once per language after enabled turns on. */
export function useWhatsNewChangelog(language: WhatsNewLanguage, enabled: boolean): WhatsNewChangelogState {
  const [loaded, setLoaded] = useState<{ readonly language: WhatsNewLanguage; readonly entries: readonly WhatsNewEntry[] } | null>(null);
  const [status, setStatus] = useState<WhatsNewChangelogStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const current = loaded?.language === language ? loaded.entries : null;

  useEffect(() => {
    if (!enabled || current) return undefined;
    let cancelled = false;
    setStatus("loading");
    loadWhatsNewChangelog(language).then((entries) => {
      if (cancelled) return;
      setLoaded({ language, entries });
      setStatus("ready");
    }, () => {
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, current, enabled, language]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { status: current ? "ready" : status, entries: current, retry };
}
