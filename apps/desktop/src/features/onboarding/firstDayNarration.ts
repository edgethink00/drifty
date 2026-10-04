import { useEffect, useRef, useState } from "react";
import { firstDayVerdictSplit, type FirstDayDiscoveryItem, type FirstDaySource } from "./firstDayPreparationStory";

/**
 * The first-day screen's line under the title names the work that is actually happening: which
 * sources the current batch is reading, plus a moment for each new fact about the day. Nothing here is
 * invented or timed for effect; every line comes from a stored result or a batch in flight, and the
 * screen falls back to its generic copy when there is nothing specific to say.
 */

/** How long a new fact holds the line, so a fast batch still reads as a sentence, not a flicker. */
export const FIRST_DAY_FACT_HOLD_MS = 2600;

/** The sources being read, as the lead name and how many others share the batch. */
export function firstDayReadingSummary(reading: readonly FirstDaySource[]): { readonly lead: string; readonly others: number } | null {
  const [lead, ...others] = reading;
  return lead ? { lead: lead.label, others: others.length } : null;
}

export type FirstDaySplitNews = { readonly key: string; readonly label: string };

/**
 * Of the sources context has just started sorting more than one way, the largest. A source's time can
 * arrive across several batches, so this compares split state, not the moment a source first landed.
 */
export function pickFirstDaySplit(previouslySplit: ReadonlySet<string>, items: readonly FirstDayDiscoveryItem[]): FirstDaySplitNews | null {
  let best: FirstDayDiscoveryItem | null = null;
  for (const item of items) {
    if (previouslySplit.has(item.key) || !firstDayVerdictSplit(item)) continue;
    if (!best || item.seconds > best.seconds) best = item;
  }
  return best ? { key: best.key, label: best.label } : null;
}

/**
 * The newest split worth naming, held for FIRST_DAY_FACT_HOLD_MS. One that arrives while another is
 * held waits for it (only the newest waits). Splits already present when the screen opened are not
 * news and are never named.
 */
export function useFirstDaySplit(items: readonly FirstDayDiscoveryItem[], active: boolean): FirstDaySplitNews | null {
  const previousRef = useRef<Set<string> | null>(null);
  const queuedRef = useRef<FirstDaySplitNews | null>(null);
  const timerRef = useRef<number | null>(null);
  const [shown, setShown] = useState<FirstDaySplitNews | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = new Set(items.filter((item) => firstDayVerdictSplit(item)).map((item) => item.key));
    if (!previous || !active) return;
    const news = pickFirstDaySplit(previous, items);
    if (!news) return;
    if (timerRef.current !== null) {
      queuedRef.current = news;
      return;
    }
    const release = () => {
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) {
        setShown(queued);
        timerRef.current = window.setTimeout(release, FIRST_DAY_FACT_HOLD_MS);
        return;
      }
      timerRef.current = null;
      setShown(null);
    };
    setShown(news);
    timerRef.current = window.setTimeout(release, FIRST_DAY_FACT_HOLD_MS);
  }, [active, items]);

  return active ? shown : null;
}

/**
 * True for FIRST_DAY_FACT_HOLD_MS after key changes to a new non-null value while active. The value the
 * screen opens with is not news, so the first render never counts as fresh.
 */
export function useFirstDayFreshKey(key: string | null, active: boolean): boolean {
  const previousRef = useRef<string | null | undefined>(undefined);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = key;
    if (previous === undefined || !active || key === null || key === previous) return undefined;
    setFreshKey(key);
    const timer = window.setTimeout(() => setFreshKey((current) => (current === key ? null : current)), FIRST_DAY_FACT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [active, key]);
  return active && freshKey !== null && freshKey === key;
}
